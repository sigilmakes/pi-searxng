/** Render server lifecycle helpers. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderPort, renderUrl, resolveBrowserPath, browserStatePath, browserProfilePath } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const BIN = path.join(PACKAGE_ROOT, "bin", "searx");

export const PID_FILE = path.join(os.homedir(), ".pi", "agent", "searx-render.pid");
export const LOG_DIR = path.join(os.homedir(), ".pi", "agent", "logs");
export const LOG_FILE = path.join(LOG_DIR, "searx-render.log");

export interface RenderStatus {
    running: boolean;
    pid?: number;
    url: string;
    healthy: boolean;
    logFile: string;
}

function readPid(): number | undefined {
    try {
        const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
        return Number.isFinite(pid) ? pid : undefined;
    } catch {
        return undefined;
    }
}

function processAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export async function health(): Promise<boolean> {
    try {
        const resp = await fetch(`${renderUrl()}/health`, { signal: AbortSignal.timeout(2000) });
        return resp.ok;
    } catch {
        return false;
    }
}

export async function status(): Promise<RenderStatus> {
    const pid = readPid();
    const alive = pid ? processAlive(pid) : false;
    const healthy = await health();
    return {
        running: alive || healthy,
        pid: alive ? pid : undefined,
        url: renderUrl(),
        healthy,
        logFile: LOG_FILE,
    };
}

export async function start(): Promise<RenderStatus> {
    const current = await status();
    if (current.running && current.healthy) return current;

    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const out = fs.openSync(LOG_FILE, "a");
    const err = fs.openSync(LOG_FILE, "a");
    const port = renderPort();
    const browserPath = resolveBrowserPath();

    const env = {
        ...process.env,
        SEARX_RENDER_PORT: String(port),
        ...(browserPath ? { SEARX_BROWSER_PATH: browserPath } : {}),
        SEARX_BROWSER_STATE: browserStatePath(),
        SEARX_BROWSER_PROFILE: browserProfilePath(),
    };

    const child = spawn(BIN, ["render-server", "--port", String(port)], {
        cwd: PACKAGE_ROOT,
        detached: true,
        stdio: ["ignore", out, err],
        env,
    });
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));

    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await health()) return status();
    }

    return status();
}

export async function stop(): Promise<RenderStatus> {
    const pid = readPid();
    if (pid && processAlive(pid)) {
        try {
            process.kill(pid, "SIGTERM");
        } catch {
            // already gone
        }
    }

    for (let i = 0; i < 10; i++) {
        if (!pid || !processAlive(pid)) break;
        await new Promise((r) => setTimeout(r, 300));
    }

    return status();
}

export async function restart(): Promise<RenderStatus> {
    await stop();
    return start();
}
