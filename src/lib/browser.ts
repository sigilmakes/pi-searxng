/**
 * Browser rendering via Playwright Node API.
 *
 * Uses playwright-core directly — no CLI subprocess juggling.
 * The browser binary is found via:
 *   1. SEARX_BROWSER_PATH env var (user override)
 *   2. Playwright's built-in browser discovery
 *
 * Optional human-auth state:
 *   SEARX_BROWSER_STATE=/path/state.json
 * If a state file exists, render/extract contexts load it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Browser, BrowserContextOptions, LaunchOptions } from "playwright-core";
import { chromium } from "playwright-core";

// ── Types ──────────────────────────────────────────────────

export interface BrowserResult {
    url: string;
    title: string;
    html: string;
    text: string;
    rendered: boolean;
    duration_ms: number;
}

const DEFAULT_STATE = path.join(os.homedir(), ".pi", "agent", "searx-browser-state.json");
const DEFAULT_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function statePath(): string {
    return process.env.SEARX_BROWSER_STATE || DEFAULT_STATE;
}

function launchOptions(headless = true): LaunchOptions {
    const opts: LaunchOptions = {
        headless,
    };

    const browserPath = process.env.SEARX_BROWSER_PATH;
    if (browserPath) {
        opts.executablePath = browserPath;
    }

    return opts;
}

function contextOptions(): BrowserContextOptions {
    const opts: BrowserContextOptions = {
        userAgent: DEFAULT_UA,
        viewport: { width: 1280, height: 720 },
    };

    const state = statePath();
    if (fs.existsSync(state)) {
        opts.storageState = state;
    }

    return opts;
}

// ── Browser lifecycle ─────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
    if (_browser && _browser.isConnected()) return _browser;

    const headless = process.env.SEARX_BROWSER_HEADLESS === "false" ? false : true;
    _browser = await chromium.launch(launchOptions(headless));
    return _browser;
}

/** Close the shared browser instance. */
export async function close(): Promise<void> {
    if (_browser) {
        await _browser.close();
        _browser = null;
    }
}

/** Check if a browser is available (can we launch one?). */
let _available: boolean | null = null;

export async function isAvailable(): Promise<boolean> {
    if (_available !== null) return _available;
    try {
        const browser = await getBrowser();
        await browser.close();
        _browser = null;
        _available = true;
    } catch {
        _available = false;
    }
    return _available;
}

/** Reset cached availability. */
export function resetAvailability(): void {
    _available = null;
}

// ── Human-auth state ──────────────────────────────────────

/**
 * Open a headed browser for human login/CAPTCHA completion, then save storage state.
 */
export async function authenticate(
    url: string,
    opts: {
        state?: string;
        timeout?: number;
    } = {},
): Promise<string> {
    const savePath = opts.state || statePath();
    fs.mkdirSync(path.dirname(savePath), { recursive: true });

    const browser = await chromium.launch(launchOptions(false));
    const context = await browser.newContext({
        userAgent: DEFAULT_UA,
        viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    try {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: (opts.timeout ?? 60) * 1000,
        });

        console.log("Browser opened. Solve/login manually, then press Enter here to save browser state.");
        const rl = createInterface({ input, output });
        await rl.question("");
        rl.close();

        await context.storageState({ path: savePath });
        return savePath;
    } finally {
        await context.close();
        await browser.close();
    }
}

// ── Rendering ─────────────────────────────────────────────

/** Render a URL in a browser and extract content. */
export async function render(
    url: string,
    opts: {
        wait?: number;
        timeout?: number;
    } = {},
): Promise<BrowserResult> {
    const start = Date.now();
    const wait = opts.wait ?? 2;
    const timeout = (opts.timeout ?? 30) * 1000;

    const browser = await getBrowser();
    const context = await browser.newContext(contextOptions());
    const page = await context.newPage();

    try {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout,
        });

        if (wait > 0) {
            await page.waitForTimeout(wait * 1000);
        }

        const title = await page.title();
        const html = await page.content();
        const text = await page.evaluate(() => {
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null,
            );
            const parts: string[] = [];
            while (walker.nextNode()) {
                const t = walker.currentNode.textContent?.trim();
                if (t) parts.push(t);
            }
            return parts.join("\n");
        });

        return {
            url,
            title,
            html,
            text,
            rendered: true,
            duration_ms: Date.now() - start,
        };
    } finally {
        await context.close();
    }
}

/** Extract content matching CSS selectors from a rendered page. */
export async function extract(
    url: string,
    selectors: string[],
    opts: {
        wait?: number;
        timeout?: number;
    } = {},
): Promise<Array<{ selector: string; items: string[] }>> {
    const browser = await getBrowser();
    const context = await browser.newContext(contextOptions());
    const page = await context.newPage();

    try {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: (opts.timeout ?? 30) * 1000,
        });

        if ((opts.wait ?? 2) > 0) {
            await page.waitForTimeout((opts.wait ?? 2) * 1000);
        }

        const results: Array<{ selector: string; items: string[] }> = [];
        for (const sel of selectors) {
            const elements = await page.$$(sel);
            const items = await Promise.all(
                elements.map((el) => el.textContent().then((t) => t?.trim() || "")),
            );
            results.push({ selector: sel, items: items.filter(Boolean) });
        }

        return results;
    } finally {
        await context.close();
    }
}

// ── JS detection ───────────────────────────────────────────

export function needsBrowser(html: string): boolean {
    const lower = html.toLowerCase();

    const spaMarkers = [
        "__next", "__nuxt", 'id="app"', 'id="root"',
        "ng-app", "data-reactroot", "data-server-rendered",
    ];
    if (spaMarkers.some((m) => lower.includes(m))) return true;

    const scriptMatches = lower.match(/<script[\s>]/g);
    const scriptCount = scriptMatches ? scriptMatches.length : 0;
    const textLength = html.replace(/<[^>]+>/g, "").trim().length;
    if (scriptCount > 5 && textLength < scriptCount * 200) return true;

    if (lower.includes("window.location") && textLength < 500) return true;

    return false;
}
