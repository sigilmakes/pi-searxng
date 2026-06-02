/**
 * SearXNG extension for pi
 *
 * Thin harness — /searxng command for TUI interaction.
 * On session start: ensures `searx` CLI is on PATH and SearXNG is running.
 * Search and fetch are handled by the `searx` CLI, composable from bash.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const COMPOSE_FILE = path.join(PACKAGE_ROOT, "docker", "docker-compose.yaml");
const BIN_DIR = path.join(PACKAGE_ROOT, "bin");
const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8042";

const execFileAsync = (cmd: string, args: string[]): Promise<string> =>
	new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout: 30_000 }, (err, stdout, stderr) => {
			if (err) reject(err);
			else resolve(stdout);
		});
	});

// ── PATH setup ────────────────────────────────────────────

function ensureBinOnPath(): boolean {
	const currentPath = process.env.PATH || "";
	const paths = currentPath.split(path.delimiter);
	if (paths.includes(BIN_DIR)) return false; // already there

	process.env.PATH = `${BIN_DIR}${path.delimiter}${currentPath}`;
	return true; // was added
}

// ── Health ────────────────────────────────────────────────

async function isHealthy(): Promise<boolean> {
	try {
		const resp = await fetch(SEARXNG_URL, { signal: AbortSignal.timeout(3000), redirect: "follow" });
		return resp.ok;
	} catch {
		return false;
	}
}

async function waitForHealthy(seconds: number): Promise<boolean> {
	for (let i = 0; i < seconds; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		if (await isHealthy()) return true;
	}
	return false;
}

async function dockerCompose(action: string, ...extra: string[]): Promise<void> {
	await execFileAsync("docker", ["compose", "-f", COMPOSE_FILE, action, ...extra]);
}

async function startSearxng(): Promise<boolean> {
	try {
		await dockerCompose("up", "-d");
		return await waitForHealthy(15);
	} catch {
		return false;
	}
}

// ── Extension ─────────────────────────────────────────────

export default function searxngExtension(pi: ExtensionAPI) {
	// Add bin/ to PATH so `searx` is available in bash
	const added = ensureBinOnPath();

	pi.on("session_start", async (_event, ctx) => {
		if (added) {
			ctx.ui.notify(`searx CLI on PATH: ${BIN_DIR}`, "info");
		}

		// Ensure SearXNG is running
		if (await isHealthy()) return;

		ctx.ui.notify("Starting SearXNG...", "info");
		const ok = await startSearxng();
		ctx.ui.notify(ok ? "SearXNG started." : "Failed to start SearXNG. Use /searxng start.", ok ? "info" : "warning");
	});

	pi.registerCommand("searxng", {
		description: "Manage SearXNG: status, start, stop, restart, engines",
		async handler(args, ctx) {
			const sub = (args.trim() || "status").split(/\s+/)[0].toLowerCase();

			switch (sub) {
				case "status": {
					const healthy = await isHealthy();
					const label = healthy ? "✓ running" : "✗ not responding";
					let text = `SearXNG: ${label}\nURL: ${SEARXNG_URL}`;

					if (healthy) {
						try {
							const resp = await fetch(
								`${SEARXNG_URL}/search?q=test&format=json&categories=general&limit=1`,
								{ signal: AbortSignal.timeout(5000) },
							);
							const data = (await resp.json()) as {
								results: unknown[];
								unresponsive_engines: string[][];
							};
							const down = data.unresponsive_engines || [];
							text += `\n\nResults: ${data.results.length}`;
							text += down.length > 0
								? `\n⚠ ${down.length} engine(s) down: ${down.map((e) => e[0]).join(", ")}`
								: "\nAll queried engines responding.";
						} catch {
							text += "\nCould not check engine health.";
						}
					}
					ctx.ui.notify(text, "info");
					break;
				}

				case "start": {
					ctx.ui.notify("Starting SearXNG...", "info");
					const ok = await startSearxng();
					ctx.ui.notify(
						ok ? "SearXNG started." : "Failed to start SearXNG. Check Docker.",
						ok ? "info" : "error",
					);
					break;
				}

				case "stop": {
					ctx.ui.notify("Stopping SearXNG...", "info");
					await dockerCompose("down");
					ctx.ui.notify("SearXNG stopped.", "info");
					break;
				}

				case "restart": {
					ctx.ui.notify("Restarting SearXNG...", "info");
					await dockerCompose("restart");
					const ok = await waitForHealthy(15);
					ctx.ui.notify(
						ok ? "SearXNG restarted." : "Restarted but not yet responding. May need a moment.",
						ok ? "info" : "warning",
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
							engines: Array<{ name: string; enabled: boolean; categories: string[] }>;
							categories: string[];
						};
						const enabled = config.engines.filter((e) => e.enabled);
						const byCategory = new Map<string, string[]>();
						for (const e of enabled) {
							for (const c of e.categories) {
								const list = byCategory.get(c) || [];
								list.push(e.name);
								byCategory.set(c, list);
							}
						}
						const lines = [
							`${enabled.length} engines enabled, ${config.engines.length - enabled.length} disabled`,
							`Categories: ${config.categories.join(", ")}`,
							"",
						];
						for (const [cat, engines] of [...byCategory].sort((a, b) => a[0].localeCompare(b[0]))) {
							lines.push(`  ${cat}: ${engines.join(", ")}`);
						}
						ctx.ui.notify(lines.join("\n"), "info");
					} catch (e) {
						ctx.ui.notify(
							`Failed to fetch engine list: ${e instanceof Error ? e.message : String(e)}`,
							"error",
						);
					}
					break;
				}

				default:
					ctx.ui.notify(
						`Unknown subcommand: ${sub}\nUsage: /searxng [status|start|stop|restart|engines]`,
						"warning",
					);
			}
		},
	});
}