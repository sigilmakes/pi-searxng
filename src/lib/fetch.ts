/**
 * Page fetching — fetch-once with smart fallback chain.
 *
 * Strategy:
 * 1. Fetch HTML with Node (real browser UA) — single HTTP request
 * 2. Detect content type → PDF/office docs go direct to markitdown URL pass-through
 * 3. Check needsBrowser(HTML) → Playwright rendering
 * 4. Pipe HTML to markitdown via stdin (avoids Python requests UA issues)
 * 5. If markitdown output looks like paywall shell → browser fallback
 * 6. If markitdown fails → browser fallback
 * 7. Return result with method diagnostics
 */

import { execFileSync, execFile as execFileCb } from "node:child_process";
import { fetchPage } from "./searxng.js";
import type { FetchOutput } from "./searxng.js";
import * as browser from "./browser.js";
import { resolveBrowserPath } from "./config.js";

export interface FetchOptions {
	maxChars?: number;
	offset?: number;
	forceBrowser?: boolean;   // --browser flag: skip detection, always use browser
	noBrowser?: boolean;       // --no-browser: skip browser, use markitdown only
}

export interface FetchResult extends FetchOutput {
	rendered: boolean;
	method?: string;           // How content was obtained: "browser", "markitdown-url", "markitdown-stdin", "markitdown-fallback"
}

/**
 * Resolve a browser-matching User-Agent string.
 * Falls back to a generic Chrome UA if Chromium isn't found.
 */
function resolveFetchUA(): string {
	const browserPath = resolveBrowserPath();
	if (browserPath) {
		try {
			const version = execFileSync(browserPath, ["--version"], { timeout: 5000 }).toString().trim();
			const match = version.match(/(\d+\.\d+\.\d+\.\d+)/);
			if (match) {
				return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${match[1]} Safari/537.36`;
			}
		} catch {
			// Fall through to default
		}
	}
	return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
}

/** Cache the UA so we only resolve it once per process. */
let _cachedUA: string | undefined;

function getFetchUA(): string {
	if (!_cachedUA) _cachedUA = resolveFetchUA();
	return _cachedUA;
}

/**
 * Convert HTML string to Markdown by piping to markitdown via stdin.
 * This avoids markitdown making its own HTTP request (which uses python-requests UA
 * and gets 403'd by sites like Wikipedia, PMC, etc.).
 *
 * Uses callback-style execFile + proc.stdin.write/end instead of execFileAsync
 * with `input` option, to avoid deadlocks on large HTML payloads where the
 * child's stdout buffer fills before the parent finishes writing stdin.
 */
function convertHtmlViaStdin(
	html: string,
	url: string,
	maxChars: number,
	offset: number,
): Promise<FetchOutput & { method: string }> {
	return new Promise((resolve, reject) => {
		const proc = execFileCb("uvx", [
			"--from", "markitdown[pdf]", "markitdown",
		], {
			timeout: 45_000,
			maxBuffer: 50 * 1024 * 1024,
		}, (err, stdout, stderr) => {
				if (err) {
					if ("code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
						reject(new Error("uvx not found. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh"));
					} else {
						reject(new Error(
							`markitdown stdin conversion failed: ${err.message}`,
						));
					}
					return;
				}

				const text = (stdout || "").trim();
				if (!text) {
					reject(new Error("markitdown returned empty output from stdin"));
					return;
				}

				const total = text.length;
				const sliced = text.slice(offset, offset + maxChars);
				const remaining = total - (offset + sliced.length);

				const output: FetchOutput & { method: string } = {
					url,
					total_length: total,
					offset,
					shown_length: sliced.length,
					has_more: remaining > 0,
					content: sliced,
					method: "markitdown-stdin",
				};

				if (remaining > 0) {
					output.next_offset = offset + maxChars;
				}

				resolve(output);
			});

			// Write HTML to stdin and close it so markitdown knows input is complete
			proc.stdin!.write(html);
			proc.stdin!.end();
	});
}

/**
 * Heuristic check: does the converted content look like a paywall shell
 * or consent banner rather than real article content?
 */
function looksLikePaywallOrShell(text: string): boolean {
	const lower = text.toLowerCase();
	const paywallSignals = [
		"subscribe to access",
		"register to read",
		"create an account to continue",
		"sign in to read",
		"purchase this article",
		"access full text",
	];
	// Only flag as paywall if the content is suspiciously short AND contains paywall language
	return text.length < 2000 && paywallSignals.some(s => lower.includes(s));
}

/**
 * Parse an HTTP error from markitdown stderr to produce an actionable message.
 */
function classifyFetchError(err: unknown): { status?: number; message: string } {
	const msg = err instanceof Error ? err.message : String(err);
	const statusMatch = msg.match(/(\d{3})\s+(?:Client|Server)\s+Error/);
	const status = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

	if (status === 403) {
		return { status: 403, message: `403 Forbidden — site blocks automated requests. Try: searx fetch --browser <url>` };
	}
	if (status === 404) {
		return { status: 404, message: `404 Not Found — page does not exist` };
	}
	if (status === 400) {
		return { status: 400, message: `400 Bad Request — may need browser rendering. Try: searx fetch --browser <url>` };
	}
	if (msg.includes("timed out") || msg.includes("ETIMEDOUT")) {
		return { message: `Request timed out. Try: searx fetch --browser <url>` };
	}
	return { status, message: `Fetch failed: ${msg}` };
}

/**
 * Fetch a URL, choosing the best rendering strategy.
 */
export async function fetchUrl(
	url: string,
	opts: FetchOptions = {},
): Promise<FetchResult> {
	const maxChars = Number(opts.maxChars) || 15000;
	const offset = Number(opts.offset) || 0;

	// Force browser mode
	if (opts.forceBrowser) {
		const result = await browserFetch(url, maxChars, offset);
		return { ...result, method: "browser" };
	}

	// Force markitdown mode (legacy path: passes URL to markitdown directly)
	if (opts.noBrowser) {
		try {
			const result = await fetchPage(url, maxChars, offset);
			return { ...result, rendered: false, method: "markitdown-url" };
		} catch (err: unknown) {
			const classified = classifyFetchError(err);
			throw new Error(classified.message);
		}
	}

	// ── Auto-detect path ──────────────────────────────────────

	// Fetch HTML ourselves with a real browser UA (single HTTP request)
	let html: string;
	let contentType: string;

	try {
		const probe = await fetch(url, {
			headers: { "User-Agent": getFetchUA() },
			signal: AbortSignal.timeout(15000),
			redirect: "follow",
		});

		if (!probe.ok) {
			// HTTP error from probe — try browser if available
			if (await browser.isAvailable()) {
				const result = await browserFetch(url, maxChars, offset);
				return { ...result, method: "browser-fallback-probe-error" };
			}
			throw new Error(`HTTP ${probe.status} from ${url}. Try: searx fetch --browser <url>`);
		}

		contentType = probe.headers.get("content-type") || "";
		html = await probe.text();
	} catch (err: unknown) {
		// Probe failed entirely — try browser, then markitdown as last resort
		if (await browser.isAvailable()) {
			try {
				const result = await browserFetch(url, maxChars, offset);
				return { ...result, method: "browser-fallback-probe-failed" };
			} catch {
				// Browser also failed, fall through to markitdown
			}
		}
		try {
			const result = await fetchPage(url, maxChars, offset);
			return { ...result, rendered: false, method: "markitdown-url" };
		} catch (mdErr: unknown) {
			const classified = classifyFetchError(mdErr);
			throw new Error(classified.message);
		}
	}

	// Non-HTML binary content types: pass URL directly to markitdown
	// (markitdown handles PDF, DOCX, etc. natively)
	if (
		contentType.includes("pdf") ||
		contentType.includes("officedocument") ||
		contentType.includes("spreadsheet") ||
		contentType.includes("presentation")
	) {
		try {
			const result = await fetchPage(url, maxChars, offset);
			return { ...result, rendered: false, method: "markitdown-url" };
		} catch (err: unknown) {
			// markitdown failed on binary — try browser as last resort
			if (await browser.isAvailable()) {
				try {
					const result = await browserFetch(url, maxChars, offset);
					return { ...result, method: "browser-fallback-binary" };
				} catch {
					// Both failed
				}
			}
			const classified = classifyFetchError(err);
			throw new Error(classified.message);
		}
	}

	// HTML content path
	if (contentType.includes("html") || contentType.includes("text/")) {
		// Check if page needs JS rendering
		if (browser.needsBrowser(html) && (await browser.isAvailable())) {
			const result = await browserFetch(url, maxChars, offset);
			return { ...result, method: "browser" };
		}

		// Convert HTML we already have via markitdown stdin
		try {
			const result = await convertHtmlViaStdin(html, url, maxChars, offset);

			// Check for paywall shell content
			if (looksLikePaywallOrShell(result.content) && (await browser.isAvailable())) {
				const browserResult = await browserFetch(url, maxChars, offset);
				return { ...browserResult, method: "browser-fallback-paywall" };
			}

			return { ...result, rendered: false };
		} catch (err: unknown) {
			// markitdown stdin conversion failed — try browser fallback
			if (await browser.isAvailable()) {
				try {
					const result = await browserFetch(url, maxChars, offset);
					return { ...result, method: "browser-fallback-markitdown-failed" };
				} catch {
					// Browser also failed — throw the original markitdown error
				}
			}
			throw err;
		}
	}

	// Fallback for unknown content types — try markitdown URL pass-through
	try {
		const result = await fetchPage(url, maxChars, offset);
		return { ...result, rendered: false, method: "markitdown-url" };
	} catch (err: unknown) {
		if (await browser.isAvailable()) {
			try {
				const result = await browserFetch(url, maxChars, offset);
				return { ...result, method: "browser-fallback-unknown" };
			} catch {
				// Both failed
			}
		}
		const classified = classifyFetchError(err);
		throw new Error(classified.message);
	}
}

async function browserFetch(
	url: string,
	maxChars: number,
	offset: number,
): Promise<FetchOutput & { rendered: boolean }> {
	const rendered = await browser.render(url);
	await browser.close();

	const total = rendered.text.length;
	const sliced = rendered.text.slice(offset, offset + maxChars);
	const remaining = total - (offset + sliced.length);

	return {
		url,
		total_length: total,
		offset,
		shown_length: sliced.length,
		has_more: remaining > 0,
		next_offset: remaining > 0 ? offset + maxChars : undefined,
		content: sliced,
		rendered: true,
	};
}