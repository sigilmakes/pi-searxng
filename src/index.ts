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
const SEARX_BIN = path.join(BIN_DIR, "searx");
const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8042";

const DIRECT_COMMANDS = [
    "status",
    "doctor",
    "start",
    "stop",
    "restart",
    "engines",
    "render status",
    "render start",
    "render stop",
    "render restart",
    "config",
    "prefill search",
];

function ensureDirsOnPath(): string[] {
    const currentPath = process.env.PATH || "";
    const paths = currentPath.split(path.delimiter);
    const added: string[] = [];
    for (const dir of [NM_BIN_DIR, BIN_DIR]) if (!paths.includes(dir)) added.push(dir);
    if (added.length > 0) process.env.PATH = `${added.join(path.delimiter)}${path.delimiter}${currentPath}`;
    return added;
}

const AGENT_BIN = path.join(os.homedir(), ".pi", "agent", "bin");
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

async function cliText(args: string[], timeout = 30_000): Promise<string> {
    const { stdout, stderr } = await execFileAsync(SEARX_BIN, args, { timeout });
    return stdout.trim() || stderr.trim();
}

async function statusText(): Promise<string> {
    const healthy = await isHealthy();
    const r = await render.status();
    return [
        `SearXNG: ${healthy ? "running" : "not responding"}`,
        `URL: ${SEARXNG_URL}`,
        `Render: ${r.healthy ? "healthy" : r.running ? "running but unhealthy" : "stopped"} (${r.url})`,
        `CLI: searx doctor`,
    ].join("\n");
}

async function select(ctx: any, title: string, options: string[]): Promise<string | undefined> {
    if (ctx.ui.select) return ctx.ui.select(title, options);
    ctx.ui.notify(`${title}: ${options.join(", ")}`, "info");
    return undefined;
}

async function runAction(action: string, ctx: any): Promise<void> {
    switch (action) {
        case "status":
            ctx.ui.notify(await statusText(), "info");
            break;
        case "doctor":
            ctx.ui.notify(await cliText(["doctor", "--text"], 60_000), "info");
            break;
        case "start": {
            ctx.ui.notify("Starting SearXNG...", "info");
            const ok = await startSearxng();
            ctx.ui.notify(ok ? "SearXNG started." : "Failed to start SearXNG. Check Docker.", ok ? "info" : "error");
            break;
        }
        case "stop":
            ctx.ui.notify("Stopping SearXNG...", "info");
            await dockerCompose("down");
            ctx.ui.notify("SearXNG stopped.", "info");
            break;
        case "restart": {
            ctx.ui.notify("Restarting SearXNG...", "info");
            await dockerCompose("restart");
            const ok = await waitForHealthy(15);
            ctx.ui.notify(ok ? "SearXNG restarted." : "Restarted but not yet responding.", ok ? "info" : "warning");
            break;
        }
        case "render status":
        case "render start":
        case "render restart":
        case "render stop": {
            const [, sub = "status"] = action.split(" ");
            const status = sub === "start" ? await render.start()
                : sub === "restart" ? await render.restart()
                : sub === "stop" ? await render.stop()
                : await render.status();
            ctx.ui.notify(`Render: ${status.healthy ? "healthy" : status.running ? "running but unhealthy" : "stopped"}\nURL: ${status.url}\nLog: ${status.logFile}`, "info");
            break;
        }
        case "engines":
            ctx.ui.notify(await cliText(["engines", "--text"], 30_000), "info");
            break;
        case "config":
            ctx.ui.notify(await cliText(["config", "show"], 30_000), "info");
            break;
        case "prefill search":
            ctx.ui.setEditorText?.('searx search "query" -e "duckduckgo playwright,bing,wikipedia" -n 5 --text');
            ctx.ui.notify("Inserted recommended search command into editor.", "info");
            break;
        default:
            ctx.ui.notify(`Unknown subcommand: ${action}\nUsage: /searxng [${DIRECT_COMMANDS.join("|")}]`, "warning");
    }
}

async function showDashboard(ctx: any): Promise<void> {
    ctx.ui.notify(await statusText(), "info");
    const choice = await select(ctx, "SearXNG", [
        "prefill search",
        "doctor",
        "status",
        "render status",
        "render start",
        "render restart",
        "engines",
        "config",
        "restart",
        "stop",
        "Cancel",
    ]);
    if (!choice || choice === "Cancel") return;
    await runAction(choice, ctx);
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

        if (loadConfig().autoStartRenderServer) {
            const status = await render.start();
            if (!status.healthy) ctx.ui.notify("Render server not healthy. Run: searx doctor", "warning");
        }
    });

    pi.registerCommand("searxng", {
        description: "SearXNG dashboard / status / doctor / render / search prefill",
        getArgumentCompletions: async (prefix: string) => DIRECT_COMMANDS
            .filter((value) => value.startsWith(prefix))
            .map((value) => ({ value, label: value })),
        async handler(args, ctx) {
            const action = args.trim();
            if (!action) return showDashboard(ctx);
            return runAction(action, ctx);
        },
    });
}
