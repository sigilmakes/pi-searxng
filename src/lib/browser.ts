/**
 * Browser rendering via playwright-cli.
 *
 * Uses @playwright/cli as a composable CLI tool — the shade calls it from
 * bash like any other command. No sidecar containers needed. The browser
 * launches on demand, renders the page, closes when done.
 *
 * For SearXNG custom engines (Phase 3), a thin HTTP service wraps the same
 * playwright-cli calls so SearXNG Python modules can reach it.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PLAYWRIGHT_CLI = process.env.PLAYWRIGHT_CLI || "playwright-cli";

// ── Types ──────────────────────────────────────────────────

export interface BrowserResult {
	url: string;
	title: string;
	html: string;
	text: string;
	rendered: boolean;
	duration_ms: number;
}

// ── Availability ───────────────────────────────────────────

let _available: boolean | null = null;

/** Check if playwright-cli is installed and a browser is available. */
export async function isAvailable(): Promise<boolean> {
	if (_available !== null) return _available;
	try {
		await execFileAsync(PLAYWRIGHT_CLI, ["--version"], { timeout: 10_000 });
		_available = true;
	} catch {
		_available = false;
	}
	return _available;
}

/** Reset cached availability (e.g. after install). */
export function resetAvailability(): void {
	_available = null;
}

// ── Rendering ─────────────────────────────────────────────

/**
 * Render a URL in a headless browser and extract content.
 *
 * Uses playwright-cli sessions so the browser stays alive across calls
 * within a session, but closes cleanly on process exit.
 */
export async function render(
	url: string,
	opts: {
		wait?: number;       // seconds to wait after load (default: 2)
		session?: string;    // playwright-cli session name
		timeout?: number;    // total timeout in seconds (default: 30)
	} = {},
): Promise<BrowserResult> {
	const start = Date.now();
	const session = opts.session || "searx";
	const wait = opts.wait ?? 2;
	const timeout = (opts.timeout ?? 30) * 1000;

	// Open or navigate to URL in session
	try {
		// Try goto first (session may already exist)
		try {
			await execFileAsync(
				PLAYWRIGHT_CLI,
				["-s", session, "goto", url],
				{ timeout: timeout },
			);
		} catch {
			// Session doesn't exist — open a new one
			await execFileAsync(
				PLAYWRIGHT_CLI,
				["-s", session, "open", url],
				{ timeout: timeout },
			);
		}

		// Wait for JS to render
		if (wait > 0) {
			await new Promise((r) => setTimeout(r, wait * 1000));
		}

		// Extract page title
		const { stdout: titleOut } = await execFileAsync(
			PLAYWRIGHT_CLI,
			["-s", session, "--raw", "eval", "document.title"],
			{ timeout: 10_000 },
		);

		// Extract full HTML
		const { stdout: htmlOut } = await execFileAsync(
			PLAYWRIGHT_CLI,
			["-s", session, "--raw", "eval", "document.documentElement.outerHTML"],
			{ timeout: 15_000 },
		);

		// Extract visible text (cleaner than HTML for content extraction)
		const { stdout: textOut } = await execFileAsync(
			PLAYWRIGHT_CLI,
			[
				"-s", session, "--raw", "eval",
				`(() => {
					const walker = document.createTreeWalker(
						document.body,
						NodeFilter.SHOW_TEXT,
						null
					);
					const parts = [];
					while (walker.nextNode()) {
						const t = walker.currentNode.textContent.trim();
						if (t) parts.push(t);
					}
					return parts.join('\\n');
				})()`,
			],
			{ timeout: 15_000 },
		);

		return {
			url,
			title: titleOut.trim(),
			html: htmlOut.trim(),
			text: textOut.trim(),
			rendered: true,
			duration_ms: Date.now() - start,
		};
	} catch (err) {
		throw new Error(
			`Browser render failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Close the browser session.
 */
export async function close(session = "searx"): Promise<void> {
	try {
		await execFileAsync(PLAYWRIGHT_CLI, ["-s", session, "close"], {
			timeout: 10_000,
		});
	} catch {
		// Session may not exist — ignore
	}
}

/**
 * Close all browser sessions.
 */
export async function closeAll(): Promise<void> {
	try {
		await execFileAsync(PLAYWRIGHT_CLI, ["close-all"], { timeout: 10_000 });
	} catch {
		// ignore
	}
}

// ── JS detection ───────────────────────────────────────────

/**
 * Detect if a URL likely needs browser rendering.
 *
 * Heuristic approach inspired by ketch: check for SPA markers,
 * high script-to-text ratio, and known JS framework signals.
 */
export function needsBrowser(html: string): boolean {
	const lower = html.toLowerCase();

	// SPA root markers
	const spaMarkers = [
		'__next', '__nuxt', 'id="app"', 'id="root"',
		'ng-app', 'data-reactroot', 'data-server-rendered',
	];
	if (spaMarkers.some((m) => lower.includes(m))) return true;

	// Heavy script presence: count <script> tags vs visible text
	const scriptMatches = lower.match(/<script[\s>]/g);
	const scriptCount = scriptMatches ? scriptMatches.length : 0;
	const textLength = html.replace(/<[^>]+>/g, "").trim().length;
	if (scriptCount > 5 && textLength < scriptCount * 200) return true;

	// Meta redirect or JS-only content
	if (lower.includes('window.location') && textLength < 500) return true;

	return false;
}