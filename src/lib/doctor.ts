/** System health checks for pi-searxng. */

import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as searxng from "./searxng.js";
import * as render from "./render.js";
import * as browser from "./browser.js";
import { CONFIG_PATH, browserStatePath, loadConfig, resolveBrowserPath } from "./config.js";

const execFileAsync = promisify(execFile);

export interface DoctorResult {
    configPath: string;
    config: ReturnType<typeof loadConfig>;
    docker: boolean;
    searxng: boolean;
    renderServer: Awaited<ReturnType<typeof render.status>>;
    browser: {
        path?: string;
        available: boolean;
        statePath: string;
        statePresent: boolean;
    };
    engines: {
        playwright: string[];
        unresponsive: Array<{ engine: string; reason: string }>;
        recommended: string;
    };
    warnings: string[];
}

export async function runDoctor(): Promise<DoctorResult> {
    const warnings: string[] = [];
    const config = loadConfig();

    let docker = false;
    try {
        await execFileAsync("docker", ["--version"], { timeout: 3000 });
        docker = true;
    } catch {
        warnings.push("Docker is not available; SearXNG cannot be managed.");
    }

    const searxHealthy = await searxng.isHealthy();
    if (!searxHealthy) warnings.push("SearXNG is not responding. Try: searx start");

    const renderStatus = await render.status();
    if (!renderStatus.healthy) warnings.push("Render server is not healthy. Try: searx render start");

    const browserPath = resolveBrowserPath();
    const browserAvailable = await browser.isAvailable();
    if (!browserAvailable) warnings.push("Browser cannot launch. Try: searx config set browserPath $(which chromium)");

    const state = browserStatePath();
    const statePresent = fs.existsSync(state);
    if (!statePresent) warnings.push("Browser auth state is absent; Google may challenge. Try: searx browser-auth 'https://www.google.com/search?q=test'");

    let playwright: string[] = [];
    let unresponsive: Array<{ engine: string; reason: string }> = [];
    if (searxHealthy) {
        try {
            const cfg = await searxng.getConfig();
            playwright = cfg.engines.filter((e) => e.enabled && e.name.includes("playwright")).map((e) => e.name);
            const check = await searxng.search({ query: "test", engines: "duckduckgo playwright", limit: 1 });
            unresponsive = check.unresponsive || [];
        } catch (err) {
            warnings.push(`Engine check failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return {
        configPath: CONFIG_PATH,
        config,
        docker,
        searxng: searxHealthy,
        renderServer: renderStatus,
        browser: {
            path: browserPath,
            available: browserAvailable,
            statePath: state,
            statePresent,
        },
        engines: {
            playwright,
            unresponsive,
            recommended: 'searx search "query" -e "duckduckgo playwright,bing,wikipedia" -n 5 --text',
        },
        warnings,
    };
}

export function doctorText(result: DoctorResult): string {
    const lines: string[] = [];
    lines.push("pi-searxng doctor");
    lines.push(`Config: ${result.configPath}`);
    lines.push(`Docker: ${result.docker ? "available" : "missing"}`);
    lines.push(`SearXNG: ${result.searxng ? "running" : "not responding"}`);
    lines.push(`Render server: ${result.renderServer.healthy ? "healthy" : "not healthy"} (${result.renderServer.url})`);
    if (result.renderServer.pid) lines.push(`Render PID: ${result.renderServer.pid}`);
    lines.push(`Browser: ${result.browser.available ? "available" : "unavailable"}${result.browser.path ? ` (${result.browser.path})` : ""}`);
    lines.push(`Browser state: ${result.browser.statePresent ? "present" : "absent"} (${result.browser.statePath})`);
    lines.push(`Playwright engines: ${result.engines.playwright.length ? result.engines.playwright.join(", ") : "none enabled"}`);
    lines.push(`Recommended search: ${result.engines.recommended}`);

    if (result.warnings.length) {
        lines.push("", "Warnings:");
        for (const warning of result.warnings) lines.push(`- ${warning}`);
    }

    return lines.join("\n");
}
