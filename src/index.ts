/**
 * SearXNG Extension for pi
 *
 * Provides web_search and web_fetch tools backed by a local SearXNG instance,
 * plus a /searxng command for service lifecycle management.
 *
 * - web_search: Query SearXNG with full API parameter support
 * - web_fetch: Convert URLs to clean markdown via markitdown
 * - /searxng: Manage the SearXNG Docker service (start/stop/restart/status/engines)
 *
 * The extension auto-starts SearXNG on session start if needed and on
 * web_search if the service is not responding.
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type, StringEnum } from "@earendil-works/pi-ai";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Paths ────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(__filename), "..");
const COMPOSE_FILE = path.join(PACKAGE_ROOT, "docker", "docker-compose.yaml");

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8042";

const execFileAsync = promisify(execFile);

// ── SearXNG Lifecycle ───────────────────────────────────

async function isHealthy(): Promise<boolean> {
	try {
		const resp = await fetch(SEARXNG_URL, {
			signal: AbortSignal.timeout(3000),
			redirect: "follow",
		});
		return resp.ok;
	} catch {
		return false;
	}
}

async function dockerCompose(
	action: string,
	args: string[] = [],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	const allArgs = ["compose", "-f", COMPOSE_FILE, action, ...args];
	try {
		const { stdout, stderr } = await execFileAsync("docker", allArgs, {
			encoding: "utf-8",
			timeout: 30_000,
		});
		return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; message?: string };
		return {
			ok: false,
			stdout: err.stdout?.trim() || "",
			stderr: err.stderr?.trim() || err.message || String(e),
		};
	}
}

async function ensureSearxng(signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
	if (await isHealthy()) return { ok: true };

	// Try to start
	const result = await dockerCompose("up", ["-d"]);
	if (!result.ok) {
		return { ok: false, error: `Could not start SearXNG: ${result.stderr}` };
	}

	// Wait for healthy
	for (let i = 0; i < 20; i++) {
		if (signal?.aborted) return { ok: false, error: "Aborted" };
		await new Promise((r) => setTimeout(r, 1000));
		if (await isHealthy()) return { ok: true };
	}

	return { ok: false, error: "SearXNG did not become healthy within 20 seconds" };
}

// ── SearXNG Search ──────────────────────────────────────

interface SearchResult {
	title: string;
	url: string;
	content: string;
	engines: string[];
	score: number;
	category: string;
	publishedDate?: string | null;
}

interface SearXNGResponse {
	query: string;
	number_of_results: number;
	results: SearchResult[];
	answers: string[];
	infoboxes: Array<{ content: string; engine: string; title: string }>;
	suggestions: string[];
	corrections: Array<{ correct?: string }>;
	unresponsive_engines: string[][];
}

async function searchSearXNG(
	params: {
		query: string;
		categories?: string;
		engines?: string;
		time_range?: string;
		language?: string;
		pageno?: number;
		limit?: number;
	},
	signal?: AbortSignal,
): Promise<{ data: SearXNGResponse | null; error?: string }> {
	const searchParams = new URLSearchParams({
		q: params.query,
		format: "json",
		pageno: String(params.pageno || 1),
	});
	if (params.categories) searchParams.set("categories", params.categories);
	if (params.engines) searchParams.set("engines", params.engines);
	if (params.time_range) searchParams.set("time_range", params.time_range);
	if (params.language) searchParams.set("language", params.language);

	const url = `${SEARXNG_URL}/search?${searchParams.toString()}`;

	try {
		const resp = await fetch(url, {
			headers: { Accept: "application/json" },
			signal: signal ?? undefined,
		});
		if (!resp.ok) {
			return { data: null, error: `SearXNG returned HTTP ${resp.status}` };
		}
		const data = (await resp.json()) as SearXNGResponse;
		return { data };
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		return { data: null, error: `SearXNG request failed: ${msg}` };
	}
}

function formatResults(data: SearXNGResponse, limit: number): string {
	const results = data.results.slice(0, limit);
	const lines: string[] = [];

	// Header
	const cat = results.length > 0 ? results[0].category : "general";
	lines.push(`Search results for "${data.query}" (${cat}, page ${data.number_of_results > 0 ? "many" : "0"} total)`);
	lines.push(`${results.length} result${results.length !== 1 ? "s" : ""}`);

	if (data.corrections?.length) {
		for (const c of data.corrections) {
			if (c.correct) lines.push(`Did you mean: ${c.correct}`);
		}
	}

	lines.push("");

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		const num = i + 1;
		lines.push(`${num}. ${r.title || "Untitled"}`);
		lines.push(`   ${r.url}`);
		if (r.content) {
			const snippet = r.content.length > 250 ? r.content.slice(0, 247) + "..." : r.content;
			lines.push(`   ${snippet.replace(/\n/g, " ")}`);
		}
		const meta: string[] = [];
		if (r.engines.length > 1) meta.push(r.engines.join(", "));
		if (r.publishedDate) meta.push(r.publishedDate.split("T")[0]);
		if (meta.length) lines.push(`   ${meta.join(" · ")}`);
		lines.push("");
	}

	// Answers
	if (data.answers?.length) {
		lines.push("Direct answers:");
		for (const a of data.answers) {
			lines.push(`• ${a}`);
		}
		lines.push("");
	}

	// Infoboxes
	if (data.infoboxes?.length) {
		for (const ib of data.infoboxes) {
			lines.push(`[Infobox: ${ib.title}] ${ib.content.slice(0, 300)}`);
		}
		lines.push("");
	}

	// Suggestions
	if (data.suggestions?.length) {
		lines.push(`Related searches: ${data.suggestions.join(", ")}`);
	}

	// Unresponsive engines warning
	if (data.unresponsive_engines?.length) {
		const down = data.unresponsive_engines.map((e) => `${e[0]} (${e[1]})`);
		if (results.length === 0) {
			lines.push("");
			lines.push(`⚠ All search engines are unresponsive: ${down.join(", ")}`);
			lines.push("Use /searxng restart to clear engine suspensions.");
		} else {
			lines.push(`⚠ ${data.unresponsive_engines.length} engine(s) unresponsive: ${down.join(", ")}`);
		}
	}

	return lines.join("\n");
}

// ── Web Fetch (markitdown) ───────────────────────────────

async function fetchWithMarkitdown(
	url: string,
	maxLength: number,
	offset: number,
	signal?: AbortSignal,
): Promise<{ text: string; totalLength: number; hasMore: boolean }> {
	const args = ["--from", "markitdown[pdf]", "markitdown", url];

	const { stdout, stderr } = await execFileAsync("uvx", args, {
		encoding: "utf-8",
		timeout: 45_000,
		maxBuffer: 50 * 1024 * 1024,
		signal: signal ?? undefined,
	});

	const text = (stdout || "").trim();
	if (!text) {
		throw new Error(`markitdown returned empty output${stderr ? `: ${stderr.trim().slice(0, 200)}` : ""}`);
	}

	const totalLength = text.length;
	const sliced = text.slice(offset, offset + maxLength);
	const remaining = totalLength - (offset + sliced.length);

	return {
		text: sliced,
		totalLength,
		hasMore: remaining > 0,
	};
}

// ── Tool Definitions ─────────────────────────────────────

const SearchParams = Type.Object({
	query: Type.String({ description: "Search query terms" }),
	categories: Type.Optional(
		Type.String({
			description:
				"SearXNG categories: general, news, images, it, science, files, music, videos, social media. Comma-separated for multiple. Default: general.",
		}),
	),
	engines: Type.Optional(
		Type.String({
			description:
				"Specific engines to query: google, brave, duckduckgo, wikipedia, stackoverflow, github, arxiv, pypi, mdn, etc. Comma-separated for multiple. Default: all enabled engines.",
		}),
	),
	time_range: Type.Optional(
		StringEnum(["day", "week", "month", "year"] as const, {
			description: "Restrict results to recent time period",
		}),
	),
	language: Type.Optional(
		Type.String({
			description: "Result language code: en, de, fr, es, etc. Default: all languages.",
		}),
	),
	pageno: Type.Optional(
		Type.Number({
			description: "Page number for pagination (default: 1)",
			minimum: 1,
		}),
	),
	limit: Type.Optional(
		Type.Number({
			description: "Maximum results to return (default: 8, max: 20)",
			minimum: 1,
			maximum: 20,
		}),
	),
});

const FetchParams = Type.Object({
	url: Type.String({ description: "URL to fetch and convert to clean markdown" }),
	max_length: Type.Optional(
		Type.Number({
			description: "Maximum characters to return (default: 5000)",
			minimum: 500,
		}),
	),
	offset: Type.Optional(
		Type.Number({
			description: "Character offset for paginating through long documents (default: 0)",
			minimum: 0,
		}),
	),
});

// ── Extension ────────────────────────────────────────────

export default function searxngExtension(pi: ExtensionAPI) {
	// ── Session start: ensure SearXNG is running ──────────

	pi.on("session_start", async (_event, ctx) => {
		if (await isHealthy()) return;

		ctx.ui.notify("Starting SearXNG...", "info");
		const result = await ensureSearxng();
		if (result.ok) {
			ctx.ui.notify("SearXNG is running", "info");
		} else {
			ctx.ui.notify(`SearXNG failed to start: ${result.error}`, "warning");
		}
	});

	// ── web_search tool ────────────────────────────────────

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using a local SearXNG instance. Returns titles, URLs, and snippets from multiple search engines. Supports categories, time ranges, language, and engine selection. Automatically manages the SearXNG service.",
		promptSnippet: "Search the web for current information, documentation, and facts",
		promptGuidelines: [
			"Use web_search when you need current information from the web — documentation, news, facts, or research.",
			"Use categories like 'it' for technical content, 'news' for recent events, 'science' for academic papers.",
			"For technical docs, try engines like 'stackoverflow,github,mdn' for targeted results.",
			"If results mention engines being unresponsive, suggest /searxng restart to refresh them.",
		],
		parameters: SearchParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			// Ensure SearXNG is running
			if (!(await isHealthy())) {
				const started = await ensureSearxng(signal);
				if (!started.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `SearXNG is not available: ${started.error}\n\nTry /searxng start or /searxng restart to manage the service.`,
							},
						],
						isError: true,
					};
				}
			}

			const { data, error } = await searchSearXNG(
				{
					query: params.query,
					categories: params.categories,
					engines: params.engines,
					time_range: params.time_range,
					language: params.language,
					pageno: params.pageno,
					limit: params.limit || 8,
				},
				signal ?? undefined,
			);

			if (error) {
				return {
					content: [{ type: "text" as const, text: `Search failed: ${error}` }],
					isError: true,
				};
			}

			if (!data) {
				return {
					content: [{ type: "text" as const, text: "Search failed: no response from SearXNG" }],
					isError: true,
				};
			}

			const formatted = formatResults(data, params.limit || 8);

			const unresponsiveCount = data.unresponsive_engines?.length || 0;
			const resultCount = Math.min(data.results.length, params.limit || 8);

			return {
				content: [{ type: "text" as const, text: formatted }],
				details: {
					query: params.query,
					totalResults: data.number_of_results,
					returnedResults: resultCount,
					unresponsiveEngines: unresponsiveCount,
					page: params.pageno || 1,
				},
			};
		},
	});

	// ── web_fetch tool ─────────────────────────────────────

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch a web page or online document and convert it to clean markdown text. Handles HTML, PDFs, DOCX, PPTX, and other formats via markitdown. Supports pagination for long documents.",
		promptSnippet: "Fetch and read web pages, PDFs, and online documents",
		promptGuidelines: [
			"Use web_fetch to read the full content of a web page or online document.",
			"For long documents, use max_length and offset to paginate through the content.",
			"web_fetch uses markitdown which handles HTML, PDF, DOCX, PPTX, and more.",
			"For SPAs or JavaScript-heavy sites that markitdown can't render, try the /summarize skill as an alternative.",
		],
		parameters: FetchParams,

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const maxLength = params.max_length || 5000;
			const offset = params.offset || 0;

			try {
				const result = await fetchWithMarkitdown(params.url, maxLength, offset, signal ?? undefined);

				let text = result.text;
				if (result.hasMore) {
					const nextOffset = offset + maxLength;
					text += `\n\n--- ${result.totalLength - nextOffset} more characters available. Use offset=${nextOffset} to continue. ---`;
				}

				const header = `Fetched: ${params.url}\nLength: ${result.totalLength.toLocaleString()} characters`;
				if (offset > 0) {
					text =
						`${header} (showing ${offset}-${Math.min(offset + result.text.length, result.totalLength)}${result.hasMore ? `, next at offset=${offset + maxLength}` : ""})\n\n${text}`;
				} else {
					text = `${header}\n\n${text}`;
				}

				return {
					content: [{ type: "text" as const, text }],
					details: {
						url: params.url,
						totalLength: result.totalLength,
						shownLength: result.text.length,
						offset,
						hasMore: result.hasMore,
					},
				};
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to fetch ${params.url}: ${msg}\n\nThe URL may be unreachable, the content type may not be supported, or markitdown may not be installed.`,
						},
					],
					isError: true,
				};
			}
		},
	});

	// ── /searxng command ──────────────────────────────────

	pi.registerCommand("searxng", {
		description: "Manage SearXNG service: status, start, stop, restart, engines",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const subcommand = (args.trim() || "status").split(/\s+/)[0].toLowerCase();

			switch (subcommand) {
				case "status": {
					const healthy = await isHealthy();
					const containerInfo = await dockerCompose("ps");

					let status = healthy ? "✓ running" : "✗ not responding";
					if (!healthy && containerInfo.ok) {
						status = "✗ not responding (container may be starting)";
					}

					let msg = `SearXNG: ${status}\nURL: ${SEARXNG_URL}\nCompose: ${COMPOSE_FILE}`;

					if (healthy) {
						// Check engine health
						try {
							const resp = await fetch(
								`${SEARXNG_URL}/search?q=test&format=json&categories=general`,
								{ signal: AbortSignal.timeout(5000) },
							);
							const data = (await resp.json()) as SearXNGResponse;
							const down = data.unresponsive_engines || [];
							const total = data.results?.length || 0;
							msg += `\n\nResults for health check: ${total}`;
							if (down.length > 0) {
								msg += `\nUnresponsive engines (${down.length}): ${down.map((e) => `${e[0]} (${e[1]})`).join(", ")}`;
							} else {
								msg += "\nAll queried engines responding.";
							}
						} catch {
							msg += "\n\nCould not check engine status.";
						}
					}

					ctx.ui.notify(msg, healthy ? "info" : "warning");
					break;
				}

				case "start": {
					ctx.ui.notify("Starting SearXNG...", "info");
					const result = await ensureSearxng();
					ctx.ui.notify(
						result.ok ? "SearXNG started successfully" : `Failed to start: ${result.error}`,
						result.ok ? "info" : "error",
					);
					break;
				}

				case "stop": {
					ctx.ui.notify("Stopping SearXNG...", "info");
					const result = await dockerCompose("down");
					ctx.ui.notify(
						result.ok ? "SearXNG stopped" : `Failed to stop: ${result.stderr}`,
						result.ok ? "info" : "error",
					);
					break;
				}

				case "restart": {
					ctx.ui.notify("Restarting SearXNG...", "info");
					await dockerCompose("restart");
					// Wait for healthy
					const result = await ensureSearxng();
					ctx.ui.notify(
						result.ok ? "SearXNG restarted" : `Restarted but may not be healthy: ${result.error}`,
						result.ok ? "info" : "warning",
					);
					break;
				}

				case "engines": {
					if (!(await isHealthy())) {
						ctx.ui.notify("SearXNG is not running. Use /searxng start first.", "warning");
						break;
					}
					try {
						const resp = await fetch(`${SEARXNG_URL}/config`, {
							signal: AbortSignal.timeout(5000),
						});
						const config = (await resp.json()) as {
							categories: string[];
							engines: Array<{
								name: string;
								enabled: boolean;
								categories: string[];
							}>;
						};

						const enabled = config.engines.filter((e) => e.enabled);
						const disabled = config.engines.filter((e) => !e.enabled);

						const lines: string[] = [
							`SearXNG engines: ${enabled.length} enabled, ${disabled.length} disabled`,
							`Categories: ${config.categories.join(", ")}`,
							"",
							"Enabled engines by category:",
						];

						const byCategory = new Map<string, string[]>();
						for (const e of enabled) {
							for (const c of e.categories) {
								const list = byCategory.get(c) || [];
								list.push(e.name);
								byCategory.set(c, list);
							}
						}

						for (const [cat, engines] of [...byCategory].sort((a, b) => a[0].localeCompare(b[0]))) {
							lines.push(`  ${cat}: ${engines.join(", ")}`);
						}

						ctx.ui.notify(lines.join("\n"), "info");
					} catch (e: unknown) {
						const msg = e instanceof Error ? e.message : String(e);
						ctx.ui.notify(`Failed to fetch engine list: ${msg}`, "error");
					}
					break;
				}

				default:
					ctx.ui.notify(
						`Unknown subcommand: ${subcommand}\nUsage: /searxng [status|start|stop|restart|engines]`,
						"warning",
					);
			}
		},
	});
}