/**
 * Browser rendering via Playwright Node API.
 *
 * Uses playwright-core directly. Browser auth uses a persistent profile so
 * CAPTCHA/login state survives beyond cookies/localStorage.
 */

import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, BrowserContextOptions, LaunchOptions } from "playwright-core";
import { chromium } from "playwright-core";
import { browserProfilePath, browserStatePath, resolveBrowserPath } from "./config.js";

export interface BrowserResult {
    url: string;
    title: string;
    html: string;
    text: string;
    rendered: boolean;
    duration_ms: number;
}


export function getBrowserStatePath(): string {
    return browserStatePath();
}

export function getBrowserProfilePath(): string {
    return browserProfilePath();
}

export function getBrowserPath(): string | undefined {
    return resolveBrowserPath();
}

function launchOptions(headless = true): LaunchOptions {
    const opts: LaunchOptions = {
        headless,
        args: [
            "--disable-blink-features=AutomationControlled",
        ],
    };
    const browserPath = resolveBrowserPath();
    if (browserPath) opts.executablePath = browserPath;
    return opts;
}

function baseContextOptions(): BrowserContextOptions {
    return {
        viewport: { width: 1280, height: 720 },
    };
}

function stateContextOptions(): BrowserContextOptions {
    const opts = baseContextOptions();
    const state = browserStatePath();
    if (fs.existsSync(state)) opts.storageState = state;
    return opts;
}

function hasProfile(): boolean {
    const profile = browserProfilePath();
    return fs.existsSync(profile) && fs.readdirSync(profile).length > 0;
}

let _browser: Browser | null = null;
let _renderQueue: Promise<unknown> = Promise.resolve();

async function getBrowser(): Promise<Browser> {
    if (_browser && _browser.isConnected()) return _browser;
    const headless = process.env.SEARX_BROWSER_HEADLESS === "false" ? false : true;
    _browser = await chromium.launch(launchOptions(headless));
    return _browser;
}

async function withSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = _renderQueue.then(fn, fn);
    _renderQueue = run.catch(() => undefined);
    return run;
}

async function withContext<T>(headless: boolean, fn: (context: BrowserContext) => Promise<T>): Promise<T> {
    return withSerialized(async () => {
        if (hasProfile()) {
            const context = await chromium.launchPersistentContext(browserProfilePath(), {
                ...launchOptions(headless),
                ...baseContextOptions(),
            });
            try {
                return await fn(context);
            } finally {
                await context.close();
            }
        }

        const browser = await getBrowser();
        const context = await browser.newContext(stateContextOptions());
        try {
            return await fn(context);
        } finally {
            await context.close();
        }
    });
}

export async function close(): Promise<void> {
    if (_browser) {
        await _browser.close();
        _browser = null;
    }
}

let _available: boolean | null = null;

export async function isAvailable(): Promise<boolean> {
    if (_available !== null) return _available;
    try {
        await withContext(true, async () => undefined);
        await close();
        _available = true;
    } catch {
        _available = false;
    }
    return _available;
}

export function resetAvailability(): void {
    _available = null;
}

function challengeText(text: string): boolean {
    const lower = text.toLowerCase();
    return lower.includes("unusual traffic")
        || lower.includes("about this page")
        || lower.includes("captcha")
        || lower.includes("enable javascript on your web browser");
}

async function looksAuthed(page: any): Promise<boolean> {
    const text = await page.evaluate(() => document.body?.innerText || "");
    if (challengeText(text)) return false;

    const host = new URL(page.url()).hostname;
    if (host.includes("google.")) {
        return await page.evaluate(() => {
            const resultLinks = [...document.querySelectorAll('a[href]')]
                .filter((a) => (a as HTMLAnchorElement).href.startsWith('http'));
            const hasSearchChrome = /All|Images|Videos|News/.test(document.body?.innerText || "");
            return hasSearchChrome && resultLinks.length >= 5;
        });
    }

    return text.trim().length > 200;
}

/**
 * Open a headed persistent browser, wait until auth/challenge appears cleared,
 * save storage state, then close. No enter key ceremony.
 */
export async function authenticate(
    url: string,
    opts: {
        state?: string;
        profile?: string;
        timeout?: number;
    } = {},
): Promise<{ state: string; profile: string; detected: boolean }> {
    const savePath = opts.state || browserStatePath();
    const profile = opts.profile || browserProfilePath();
    const timeoutMs = (opts.timeout ?? 300) * 1000;
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.mkdirSync(profile, { recursive: true });

    const context = await chromium.launchPersistentContext(profile, {
        ...launchOptions(false),
        ...baseContextOptions(),
    });
    const page = context.pages()[0] || await context.newPage();

    let detected = false;
    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 60_000) });
        console.log("Browser opened. Complete the challenge/login; I will auto-save when the page looks authenticated.");
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            try {
                if (await looksAuthed(page)) {
                    detected = true;
                    break;
                }
            } catch {
                // page may be navigating
            }
            await page.waitForTimeout(1000);
        }
        await context.storageState({ path: savePath, indexedDB: true });
        return { state: savePath, profile, detected };
    } finally {
        await context.close();
    }
}

export async function render(
    url: string,
    opts: { wait?: number; timeout?: number } = {},
): Promise<BrowserResult> {
    const start = Date.now();
    const wait = opts.wait ?? 2;
    const timeout = (opts.timeout ?? 30) * 1000;

    return withContext(true, async (context) => {
        const page = context.pages()[0] || await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        if (wait > 0) await page.waitForTimeout(wait * 1000);

        const title = await page.title();
        const html = await page.content();
        const text = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            const parts: string[] = [];
            while (walker.nextNode()) {
                const t = walker.currentNode.textContent?.trim();
                if (t) parts.push(t);
            }
            return parts.join("\n");
        });

        return { url, title, html, text, rendered: true, duration_ms: Date.now() - start };
    });
}

export async function extract(
    url: string,
    selectors: string[],
    opts: { wait?: number; timeout?: number } = {},
): Promise<Array<{ selector: string; items: string[] }>> {
    return withContext(true, async (context) => {
        const page = context.pages()[0] || await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: (opts.timeout ?? 30) * 1000 });
        if ((opts.wait ?? 2) > 0) await page.waitForTimeout((opts.wait ?? 2) * 1000);

        const results: Array<{ selector: string; items: string[] }> = [];
        for (const sel of selectors) {
            const elements = await page.$$(sel);
            const items = await Promise.all(elements.map((el) => el.textContent().then((t) => t?.trim() || "")));
            results.push({ selector: sel, items: items.filter(Boolean) });
        }
        return results;
    });
}

export function needsBrowser(html: string): boolean {
    const lower = html.toLowerCase();
    const spaMarkers = ["__next", "__nuxt", 'id="app"', 'id="root"', "ng-app", "data-reactroot", "data-server-rendered"];
    if (spaMarkers.some((m) => lower.includes(m))) return true;
    const scriptMatches = lower.match(/<script[\s>]/g);
    const scriptCount = scriptMatches ? scriptMatches.length : 0;
    const textLength = html.replace(/<[^>]+>/g, "").trim().length;
    if (scriptCount > 5 && textLength < scriptCount * 200) return true;
    return lower.includes("window.location") && textLength < 500;
}
