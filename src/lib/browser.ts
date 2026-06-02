/**
 * Browser rendering via Playwright Node API.
 *
 * Uses playwright-core directly — no CLI subprocess juggling.
 * The browser binary is found via:
 *   1. SEARX_BROWSER_PATH env var (user override)
 *   2. Playwright's built-in browser discovery
 *
 * For SearXNG custom engines (Phase 3), a thin HTTP service can wrap
 * the same rendering logic so Python engines can reach it.
 */

import type { Browser, Page } from "playwright-core";
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

// ── Browser lifecycle ─────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
	if (_browser && _browser.isConnected()) return _browser;

	const launchOptions: Record<string, unknown> = {
		headless: true,
	};

	// User override for browser binary (NixOS, custom paths, etc.)
	const browserPath = process.env.SEARX_BROWSER_PATH;
	if (browserPath) {
		launchOptions.executablePath = browserPath;
	}

	_browser = await chromium.launch(launchOptions);
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

// ── Rendering ─────────────────────────────────────────────

/**
 * Render a URL in a headless browser and extract content.
 */
export async function render(
	url: string,
	opts: {
		wait?: number; // seconds to wait after load (default: 2)
		timeout?: number; // navigation timeout in seconds (default: 30)
	} = {},
): Promise<BrowserResult> {
	const start = Date.now();
	const wait = opts.wait ?? 2;
	const timeout = (opts.timeout ?? 30) * 1000;

	const browser = await getBrowser();
	const context = await browser.newContext({
		userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		viewport: { width: 1280, height: 720 },
	});
	const page = await context.newPage();

	try {
		await page.goto(url, {
			waitUntil: "networkidle",
			timeout,
		});

		// Extra wait for JS frameworks to hydrate
		if (wait > 0) {
			await page.waitForTimeout(wait * 1000);
		}

		const title = await page.title();
		const html = await page.content();

		// Extract visible text — cleaner than raw HTML
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

/**
 * Extract content matching CSS selectors from a rendered page.
 */
export async function extract(
	url: string,
	selectors: string[],
	opts: {
		wait?: number;
		timeout?: number;
	} = {},
): Promise<Array<{ selector: string; items: string[] }>> {
	const browser = await getBrowser();
	const context = await browser.newContext({
		userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		viewport: { width: 1280, height: 720 },
	});
	const page = await context.newPage();

	try {
		await page.goto(url, {
			waitUntil: "networkidle",
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

/**
 * Detect if raw HTML likely needs browser rendering.
 *
 * Heuristic: check for SPA markers, high script-to-text ratio,
 * and known JS framework signals.
 */
export function needsBrowser(html: string): boolean {
	const lower = html.toLowerCase();

	// SPA root markers
	const spaMarkers = [
		"__next", "__nuxt", 'id="app"', 'id="root"',
		"ng-app", "data-reactroot", "data-server-rendered",
	];
	if (spaMarkers.some((m) => lower.includes(m))) return true;

	// Heavy script presence vs visible text
	const scriptMatches = lower.match(/<script[\s>]/g);
	const scriptCount = scriptMatches ? scriptMatches.length : 0;
	const textLength = html.replace(/<[^>]+>/g, "").trim().length;
	if (scriptCount > 5 && textLength < scriptCount * 200) return true;

	// Meta redirect or JS-only content
	if (lower.includes("window.location") && textLength < 500) return true;

	return false;
}