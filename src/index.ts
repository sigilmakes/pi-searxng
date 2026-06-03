/**
 * SearXNG extension for pi.
 *
 * Thin harness: `/searxng` command plus session-start lifecycle.
 * Search/fetch happen through the `searx` CLI.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadConfig } from "./lib/config.js";
import * as render from "./lib/render.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const COMPOSE_FILE = path.join(PACKAGE_ROOT, "docker", "docker-compose.yaml");
const BIN_DIR = path.join(PACKAGE_ROOT, "bin");
const NM_BIN_DIR = path.join(PACKAGE_ROOT, "node_modules", ".bin");
const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8042";

function ensureDirsOnPath(): string[] {
    const currentPath = process.env.PATH || "";
    const paths = currentPath.split(path.delimiter);
    const added: string[] = [];

    for (const dir of [NM_BIN_DIR, BIN_DIR]) {
        if (!paths.includes(dir)) added.push(dir);
    }

    if (added.length > 0) process.env.PATH = `${added.join(path.delimiter)}${path.delimiter}${currentPath}`;
    return added;
}

const AGENT_BIN = path.join(os.homedir(), ".pi", "agent", "bin");
const SEARX_BIN = path.join(BIN_DIR, "searx");
const SEARX_LINK = path.join(AGENT_BIN, "searx");

function ensureSymlink(): void {
    try {
        fs.mkdirSync(AGENT_BIN, { recursive: true });
        if (fs.existsSync(SEARX_LINK)) {
            const current = fs.readlinkSync(SEARX_LINK);
            if (current === SEARX_BIN) return;
            fs.unlinkSync(SEARX_LINK);
        }
        fs.symlinkSync(SEARX_BIN, SEARX_LINK);
    } catch {
        // Best-effort. PATH setup still handles the current pi process.
    }
}

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

export default function searxngExtension(pi: ExtensionAPI) {
    const added = ensureDirsOnPath();
    ensureSymlink();

    pi.on("session_start", async (_event, ctx) => {
        if (added.length > 0) ctx.ui.notify(`searx CLI on PATH: ${added.join(", ")}`, "info");

        if (!(await isHealthy())) {
            ctx.ui.notify("Starting SearXNG...", "info");
            const ok = await startSearxng();
            ctx.ui.notify(ok ? "SearXNG started." : "Failed to start SearXNG. Use /searxng start.", ok ? "info" : "warning");
        }

        const config = loadConfig();
        if (config.autoStartRenderServer) {
            const status = await render.start();
            if (!status.healthy) {
                ctx.ui.notify("Render server not healthy. Run: searx doctor", "warning");
            }
        }
    });

    pi.registerCommand("searxng", {
        description: "Manage SearXNG: status, start, stop, restart, engines, render, doctor",
        async handler(args, ctx) {
            const parts = (args.trim() || "status").split(/\s+/);
            const sub = parts[0].toLowerCase();

            switch (sub) {
                case "status": {
                    const healthy = await isHealthy();
                    const r = await render.status();
                    let text = `SearXNG: ${healthy ? "running" : "not responding"}\nURL: ${SEARXNG_URL}`;
                    text += `\nRender: ${r.healthy ? "healthy" : r.running ? "running but unhealthy" : "stopped"} (${r.url})`;
                    ctx.ui.notify(text, "info");
                    break;
                }
                case "start": {
                    ctx.ui.notify("Starting SearXNG...", "info");
                    const ok = await startSearxng();
                    ctx.ui.notify(ok ? "SearXNG started." : "Failed to start SearXNG. Check Docker.", ok ? "info" : "error");
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
                    ctx.ui.notify(ok ? "SearXNG restarted." : "Restarted but not yet responding.", ok ? "info" : "warning");
                    break;
                }
                case "render": {
                    const action = (parts[1] || "status").toLowerCase();
                    const status = action === "start" ? await render.start()
                        : action === "stop" ? await render.stop()
                        : action === "restart" ? await render.restart()
                        : await render.status();
                    ctx.ui.notify(`Render: ${status.healthy ? "healthy" : status.running ? "running but unhealthy" : "stopped"}\nURL: ${status.url}\nLog: ${status.logFile}`, "info");
                    break;
                }
                case "doctor": {
                    ctx.ui.notify("Run `searx doctor` in bash for full diagnostics.", "info");
                    break;
                }
                case "engines": {
                    if (!(await isHealthy())) {
                        ctx.ui.notify("SearXNG is not running. Use /searxng start first.", "warning");
                        break;
                    }
                    const resp = await fetch(`${SEARXNG_URL}/config`, { signal: AbortSignal.timeout(5000) });
                    const config = (await resp.json()) as { engines: Array<{ name: string; enabled: boolean; categories: string[] }>; categories: string[] };
                    const enabled = config.engines.filter((e) => e.enabled);
                    const byCategory = new Map<string, string[]>();
                    for (const e of enabled) for (const c of e.categories) byCategory.set(c, [...(byCategory.get(c) || []), e.name]);
                    const lines = [`${enabled.length} engines enabled, ${config.engines.length - enabled.length} disabled`, `Categories: ${config.categories.join(", ")}`, ""];
                    for (const [cat, engines] of [...byCategory].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`  ${cat}: ${engines.join(", ")}`);
                    ctx.ui.notify(lines.join("\n"), "info");
                    break;
                }
                default:
                    ctx.ui.notify(`Unknown subcommand: ${sub}\nUsage: /searxng [status|start|stop|restart|engines|render|doctor]`, "warning");
            }
        },
    });
}
