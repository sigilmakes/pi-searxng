#!/usr/bin/env node
/**
 * searx — CLI for SearXNG search, fetch, browse, and service management.
 *
 * Composable search primitives for the agent harness.
 * Returns JSON by default for piping. Use --text for human-readable output.
 *
 * Examples:
 *   searx search "rust async" -c it -n 3
 *   searx search "query" --json | jq '.results[0].url'
 *   searx fetch "https://example.com" -n 3000
 *   searx browse "https://example.com" --extract "h1, h2"
 *   searx status
 *   searx restart
 */

import { Command } from "commander";
import * as searxng from "./lib/searxng.js";
import * as service from "./lib/service.js";
import * as browser from "./lib/browser.js";
import { fetchUrl } from "./lib/fetch.js";
import * as fmt from "./lib/format.js";
import type { StatusOutput } from "./lib/format.js";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8042";

const program = new Command();
program
	.name("searx")
	.description("SearXNG CLI — composable search primitives")
	.version("2.0.0");

// ── Shared output flags ────────────────────────────────────

interface OutputFlags {
	text?: boolean;   // --text: human-readable
	json?: boolean;   // --json: raw SearXNG response (search only)
}

function writeOut(content: string): void {
	process.stdout.write(content + "\n");
}

function errorOut(msg: string): never {
	process.stderr.write(`Error: ${msg}\n`);
	process.exit(1);
}

// ── search ─────────────────────────────────────────────────

program
	.command("search")
	.description("Search the web via SearXNG")
	.argument("<query>", "Search query (quoted or space-separated words)")
	.option("-c, --categories <cats>", "Categories: general,news,it,science,etc (comma-separated)")
	.option("-e, --engines <engines>", "Engines: google,brave,wikipedia,etc (comma-separated)")
	.option("-t, --time-range <range>", "Time range: day,week,month,year")
	.option("-l, --language <lang>", "Language code: en,de,fr,etc")
	.option("-n, --limit <number>", "Max results", 8)
	.option("-p, --page <number>", "Page number", 1)
	.option("--json", "Raw SearXNG JSON (for jq piping)")
	.option("--text", "Human-readable output")
	.action(async (query: string, opts: OutputFlags & Partial<searxng.SearchParams>) => {
		const params: searxng.SearchParams = { query, ...opts } as searxng.SearchParams;
		try {
			if (opts.json) {
				const raw = await searxng.searchRaw(params);
				writeOut(JSON.stringify(raw, null, 2));
			} else {
				const result = await searxng.search(params);
				writeOut(opts.text ? fmt.searchText(result) : fmt.searchJSON(result));
			}
		} catch (err) {
			errorOut(err instanceof Error ? err.message : String(err));
		}
	});

// ── fetch ──────────────────────────────────────────────────

program
	.command("fetch")
	.description("Fetch a URL — browser rendering for JS pages, markitdown for static content")
	.argument("<url>", "URL to fetch")
	.option("-n, --max-chars <number>", "Max characters", 5000)
	.option("-o, --offset <number>", "Character offset for pagination", 0)
	.option("--browser", "Force browser rendering (skip JS detection)")
	.option("--no-browser", "Skip browser, use markitdown only")
	.option("--text", "Output just the text content")
	.action(async (url: string, opts: OutputFlags & fetchUrl.FetchOptions & { maxChars?: number; offset?: number }) => {
		try {
			const result = await fetchUrl(url, {
				maxChars: opts.maxChars,
				offset: opts.offset,
				forceBrowser: opts.browser,
				noBrowser: (opts as Record<string, unknown>).noBrowser as boolean,
			});

			if (opts.text) {
				writeOut(fmt.fetchText(result));
			} else {
				writeOut(fmt.fetchJSON(result));
			}
		} catch (err) {
			errorOut(err instanceof Error ? err.message : String(err));
		}
	});

// ── browse ─────────────────────────────────────────────────

program
	.command("browse")
	.description("Open a URL in headless browser and extract content")
	.argument("<url>", "URL to browse")
	.option("--extract <selectors>", "CSS selectors to extract (comma-separated)")
	.option("--wait <seconds>", "Seconds to wait after page load", 2)
	.option("--session <name>", "Browser session name", "searx")
	.option("--close", "Close the browser session after extraction")
	.option("--text", "Output just the extracted text")
	.action(async (url: string, opts: OutputFlags & { extract?: string; wait?: number; session?: string; close?: boolean }) => {
		try {
			if (!(await browser.isAvailable())) {
				errorOut(
					"playwright-cli not found. Install with: npm install -g @playwright/cli && playwright-cli install",
				);
			}

			const result = await browser.render(url, {
				wait: opts.wait,
				session: opts.session,
			});

			if (opts.extract) {
				// Extract specific elements via eval
				const selectors = opts.extract.split(",").map((s) => s.trim());
				const { execFile: ef } = await import("node:child_process");
				const { promisify } = await import("node:util");
				const run = promisify(ef);

				for (const sel of selectors) {
					try {
						const { stdout } = await run(PLAYWRIGHT_CLI(), [
							"-s", opts.session || "searx", "--raw", "eval",
							`[...document.querySelectorAll('${sel}')].map(el => el.textContent.trim()).join('\\n---\\n')`,
						], { timeout: 10_000 });
						if (opts.text) {
							writeOut(stdout.trim());
						} else {
							writeOut(JSON.stringify({ selector: sel, content: stdout.trim() }, null, 2));
						}
					} catch {
						if (!opts.text) {
							writeOut(JSON.stringify({ selector: sel, content: null, error: "no matches" }));
						}
					}
				}
			} else {
				if (opts.text) {
					writeOut(result.text);
				} else {
					writeOut(JSON.stringify({
						url: result.url,
						title: result.title,
						text: result.text,
						rendered: result.rendered,
						duration_ms: result.duration_ms,
					}, null, 2));
				}
			}

			if (opts.close) {
				await browser.close(opts.session);
			}
		} catch (err) {
			errorOut(err instanceof Error ? err.message : String(err));
		}
	});

function PLAYWRIGHT_CLI(): string {
	return process.env.PLAYWRIGHT_CLI || "playwright-cli";
}

// ── status ─────────────────────────────────────────────────

program
	.command("status")
	.description("Show SearXNG service health")
	.option("--text", "Human-readable output")
	.action(async (opts: OutputFlags) => {
		try {
			const healthy = await searxng.isHealthy();
			const containers = await service.ps();

			const output: StatusOutput = {
				url: SEARXNG_URL,
				healthy,
				compose_file: service.COMPOSE_FILE,
				containers,
			};

			if (healthy) {
				try {
					const searchOut = await searxng.search({
						query: "test",
						categories: "general",
						limit: 1,
					});
					output.engine_check = {
						results: searchOut.returned,
						unresponsive_count: searchOut.unresponsive?.length ?? 0,
						unresponsive: searchOut.unresponsive,
					};
				} catch {
					output.engine_check = { error: "could not query engines" };
				}
			}

			writeOut(opts.text ? fmt.statusText(output) : fmt.statusJSON(output));
		} catch (err) {
			errorOut(err instanceof Error ? err.message : String(err));
		}
	});

// ── start ──────────────────────────────────────────────────

program
	.command("start")
	.description("Start SearXNG")
	.option("--text", "Human-readable output")
	.action(async (opts: OutputFlags) => {
		try {
			if (await searxng.isHealthy()) {
				writeOut(
					opts.text
						? "SearXNG already running."
						: JSON.stringify({ status: "already_running", url: SEARXNG_URL }),
				);
				return;
			}

			await service.start();
			const ok = await service.waitForHealthy(20);

			if (ok) {
				writeOut(
					opts.text
						? "SearXNG started."
						: JSON.stringify({ status: "started", url: SEARXNG_URL }),
				);
			} else {
				process.stderr.write("Error: SearXNG did not become healthy within 20 seconds\n");
				process.exit(1);
			}
		} catch (err) {
			errorOut(err instanceof Error ? err.message : String(err));
		}
	});

// ── stop ───────────────────────────────────────────────────

program
	.command("stop")
	.description("Stop SearXNG")
	.option("--text", "Human-readable output")
	.action(async (opts: OutputFlags) => {
		try {
			await service.stop();
			writeOut(
				opts.text
					? "SearXNG stopped."
					: JSON.stringify({ status: "stopped" }),
			);
		} catch (err) {
			errorOut(err instanceof Error ? err.message : String(err));
		}
	});

// ── restart ────────────────────────────────────────────────

program
	.command("restart")
	.description("Restart SearXNG (clears engine suspensions)")
	.option("--text", "Human-readable output")
	.action(async (opts: OutputFlags) => {
		try {
			await service.restart();
			const ok = await service.waitForHealthy(20);

			if (ok) {
				writeOut(
					opts.text
						? "SearXNG restarted."
						: JSON.stringify({ status: "restarted", url: SEARXNG_URL }),
				);
			} else {
				writeOut(
					opts.text
						? "SearXNG restarted but not yet responding. May need a moment."
						: JSON.stringify({ status: "restarting", url: SEARXNG_URL }),
				);
			}
		} catch (err) {
			errorOut(err instanceof Error ? err.message : String(err));
		}
	});

// ── engines ────────────────────────────────────────────────

program
	.command("engines")
	.description("List enabled engines by category")
	.option("--text", "Human-readable output")
	.action(async (opts: OutputFlags) => {
		try {
			if (!(await searxng.isHealthy())) {
				errorOut("SearXNG is not running. Try: searx start");
			}
			const result = await searxng.listEngines();
			writeOut(opts.text ? fmt.enginesText(result) : fmt.enginesJSON(result));
		} catch (err) {
			errorOut(err instanceof Error ? err.message : String(err));
		}
	});

// ── Default: status ───────────────────────────────────────

program.action(async () => {
	try {
		const healthy = await searxng.isHealthy();
		writeOut(healthy ? "✓ SearXNG running" : "✗ SearXNG not responding");
	} catch {
		writeOut("✗ SearXNG not responding");
	}
});

program.parse();