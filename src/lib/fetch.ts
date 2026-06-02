/**
 * Page fetching — Playwright (browser rendering) → markitdown fallback chain.
 *
 * Strategy:
 * 1. Quick HEAD probe to detect content type and JS signals
 * 2. If browser available and page needs JS → render with Playwright
 * 3. Otherwise → markitdown (handles HTML, PDF, DOCX, etc.)
 */

import { fetchPage } from "./searxng.js";
import type { FetchOutput } from "./searxng.js";
import * as browser from "./browser.js";

export interface FetchOptions {
	maxChars?: number;
	offset?: number;
	forceBrowser?: boolean;   // --browser flag: skip detection, always use browser
	noBrowser?: boolean;       // --no-browser: skip browser, go straight to markitdown
}

/**
 * Fetch a URL, choosing the best rendering strategy.
 */
export async function fetchUrl(
	url: string,
	opts: FetchOptions = {},
): Promise<FetchOutput & { rendered: boolean }> {
	const maxChars = Number(opts.maxChars) || 5000;
	const offset = Number(opts.offset) || 0;

	// Force browser mode
	if (opts.forceBrowser) {
		return browserFetch(url, maxChars, offset);
	}

	// Force markitdown mode
	if (opts.noBrowser) {
		const result = await fetchPage(url, maxChars, offset);
		return { ...result, rendered: false };
	}

	// Auto-detect: try browser if available, fall back to markitdown
	if (await browser.isAvailable()) {
		// Quick probe: fetch a small sample to check for JS
		try {
			const probe = await fetch(url, {
				headers: { "User-Agent": "searx-cli/2.0" },
				signal: AbortSignal.timeout(8000),
				redirect: "follow",
			});

			const contentType = probe.headers.get("content-type") || "";
			// Non-HTML content types: always use markitdown
			if (
				contentType.includes("pdf") ||
				contentType.includes("officedocument") ||
				contentType.includes("spreadsheet") ||
				contentType.includes("presentation")
			) {
				const result = await fetchPage(url, maxChars, offset);
				return { ...result, rendered: false };
			}

			// For HTML: sample the first chunk to detect JS
			if (contentType.includes("html") || contentType.includes("text/")) {
				const sample = await probe.text();
				if (browser.needsBrowser(sample)) {
					return browserFetch(url, maxChars, offset);
				}
			}
		} catch {
			// Probe failed — fall through to markitdown
		}

		// Static HTML (or probe failed) — markitdown is faster
		const result = await fetchPage(url, maxChars, offset);
		return { ...result, rendered: false };
	}

	// No browser available — markitdown only
	const result = await fetchPage(url, maxChars, offset);
	return { ...result, rendered: false };
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