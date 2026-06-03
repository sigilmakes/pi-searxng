#!/usr/bin/env node
/** searx — composable SearXNG + browser rendering CLI. */

import { Command } from "commander";
import fs from "node:fs";
import * as searxng from "./lib/searxng.js";
import * as service from "./lib/service.js";
import * as browser from "./lib/browser.js";
import * as render from "./lib/render.js";
import * as cfg from "./lib/config.js";
import { runDoctor, doctorText } from "./lib/doctor.js";
import { fetchUrl } from "./lib/fetch.js";
import * as fmt from "./lib/format.js";
import { startServer } from "./render-server.js";
import type { StatusOutput } from "./lib/format.js";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8042";

const program = new Command();
program
    .name("searx")
    .description("SearXNG CLI — composable search, fetch, browser rendering, and service management")
    .version("2.1.0");

interface OutputFlags {
    text?: boolean;
    json?: boolean;
}

function writeOut(content: string): void {
    process.stdout.write(content + "\n");
}

function errorOut(msg: string): never {
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
}

function asBool(value: unknown): boolean {
    return value === true || value === "true" || value === "1" || value === "yes";
}

// ── search ─────────────────────────────────────────────────

program
    .command("search")
    .description("Search the web via SearXNG")
    .argument("<query>", "Search query")
    .option("-c, --categories <cats>", "Categories: general,news,it,science,etc")
    .option("-e, --engines <engines>", "Engines: google playwright,bing,wikipedia,etc")
    .option("-t, --time-range <range>", "Time range: day,week,month,year")
    .option("-l, --language <lang>", "Language code")
    .option("-n, --limit <number>", "Max results", 8)
    .option("-p, --page <number>", "Page number", 1)
    .option("--json", "Raw SearXNG JSON (for jq piping)")
    .option("--text", "Human-readable output")
    .action(async (query: string, opts: OutputFlags & Partial<searxng.SearchParams>) => {
        const params: searxng.SearchParams = {
            query,
            categories: opts.categories,
            engines: opts.engines,
            timeRange: opts.timeRange,
            language: opts.language,
            limit: Number(opts.limit) || 8,
            page: Number(opts.page) || 1,
        };
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
    .option("--browser", "Force browser rendering")
    .option("--no-browser", "Skip browser, use markitdown only")
    .option("--text", "Output just the text content")
    .action(async (url: string, opts: OutputFlags & { maxChars?: number; offset?: number; browser?: boolean; noBrowser?: boolean }) => {
        try {
            const result = await fetchUrl(url, {
                maxChars: Number(opts.maxChars) || 5000,
                offset: Number(opts.offset) || 0,
                forceBrowser: opts.browser,
                noBrowser: opts.noBrowser,
            });
            writeOut(opts.text ? fmt.fetchText(result) : fmt.fetchJSON(result));
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
    .option("--wait <number>", "Seconds to wait after page load", 2)
    .option("--text", "Output just the extracted text")
    .action(async (url: string, opts: OutputFlags & { extract?: string; wait?: number }) => {
        try {
            if (!(await browser.isAvailable())) {
                errorOut("No browser available. Try: searx doctor");
            }

            if (opts.extract) {
                const selectors = opts.extract.split(",").map((s) => s.trim()).filter(Boolean);
                const results = await browser.extract(url, selectors, { wait: Number(opts.wait) || 2 });
                if (opts.text) {
                    for (const r of results) for (const item of r.items) writeOut(item);
                } else {
                    writeOut(JSON.stringify(results, null, 2));
                }
            } else {
                const result = await browser.render(url, { wait: Number(opts.wait) || 2 });
                writeOut(opts.text ? result.text : JSON.stringify({
                    url: result.url,
                    title: result.title,
                    text: result.text,
                    rendered: result.rendered,
                    duration_ms: result.duration_ms,
                }, null, 2));
            }
            await browser.close();
        } catch (err) {
            errorOut(err instanceof Error ? err.message : String(err));
        }
    });

// ── doctor ─────────────────────────────────────────────────

program
    .command("doctor")
    .description("Check SearXNG, render server, browser, auth state, and recommended engines")
    .option("--json", "JSON output")
    .option("--text", "Human-readable output")
    .action(async (opts: OutputFlags) => {
        try {
            const result = await runDoctor();
            writeOut(opts.json ? JSON.stringify(result, null, 2) : doctorText(result));
        } catch (err) {
            errorOut(err instanceof Error ? err.message : String(err));
        }
    });

// ── config ─────────────────────────────────────────────────

const configCmd = program.command("config").description("Show or update persistent searx config");

configCmd
    .command("show")
    .description("Show persistent config")
    .option("--json", "JSON output")
    .action((opts: OutputFlags) => {
        const config = cfg.loadConfig();
        writeOut(opts.json ? JSON.stringify({ path: cfg.CONFIG_PATH, config }, null, 2) : [
            `Config: ${cfg.CONFIG_PATH}`,
            `browserPath: ${config.browserPath || "(auto)"}`,
            `browserState: ${config.browserState || cfg.DEFAULT_BROWSER_STATE}`,
            `renderPort: ${config.renderPort}`,
            `autoStartRenderServer: ${config.autoStartRenderServer}`,
        ].join("\n"));
    });

configCmd
    .command("set")
    .description("Set a config value")
    .argument("<key>", "browserPath|browserState|renderPort|autoStartRenderServer")
    .argument("<value>", "value")
    .action((key: keyof cfg.SearxConfig, value: string) => {
        try {
            const config = cfg.setConfigValue(key, value);
            writeOut(JSON.stringify({ path: cfg.CONFIG_PATH, config }, null, 2));
        } catch (err) {
            errorOut(err instanceof Error ? err.message : String(err));
        }
    });

// ── browser-auth ───────────────────────────────────────────

program
    .command("browser-auth")
    .description("Open a headed browser for human login/CAPTCHA, then save browser state")
    .argument("<url>", "URL to open")
    .option("--state <path>", "Storage state path")
    .option("--timeout <number>", "Navigation timeout in seconds", 60)
    .action(async (url: string, opts: { state?: string; timeout?: number }) => {
        try {
            const saved = await browser.authenticate(url, {
                state: opts.state,
                timeout: Number(opts.timeout) || 60,
            });
            writeOut(`Saved browser state: ${saved}`);
            if (!opts.state) cfg.setConfigValue("browserState", saved);
        } catch (err) {
            errorOut(err instanceof Error ? err.message : String(err));
        }
    });

// ── render lifecycle ───────────────────────────────────────

program
    .command("render")
    .description("Manage render server lifecycle")
    .argument("<action>", "start|stop|restart|status")
    .option("--json", "JSON output")
    .option("--text", "Human-readable output")
    .action(async (action: string, opts: OutputFlags) => {
        try {
            let status;
            if (action === "start") status = await render.start();
            else if (action === "stop") status = await render.stop();
            else if (action === "restart") status = await render.restart();
            else if (action === "status") status = await render.status();
            else errorOut("Usage: searx render [start|stop|restart|status]");

            if (opts.json) writeOut(JSON.stringify(status, null, 2));
            else writeOut([
                `Render server: ${status.healthy ? "healthy" : status.running ? "running but unhealthy" : "stopped"}`,
                `URL: ${status.url}`,
                status.pid ? `PID: ${status.pid}` : undefined,
                `Log: ${status.logFile}`,
            ].filter(Boolean).join("\n"));
        } catch (err) {
            errorOut(err instanceof Error ? err.message : String(err));
        }
    });

program
    .command("render-server")
    .description("Start HTTP rendering service in foreground (debug mode)")
    .option("--port <number>", "Port to listen on", cfg.renderPort())
    .action(async (opts: { port?: number }) => {
        try {
            await startServer(Number(opts.port) || cfg.renderPort());
        } catch (err) {
            errorOut(err instanceof Error ? err.message : String(err));
        }
    });

// ── SearXNG service ────────────────────────────────────────

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
                    const searchOut = await searxng.search({ query: "test", engines: "duckduckgo playwright", limit: 1 });
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

program.command("start").description("Start SearXNG").option("--text", "Human-readable output").action(async (opts: OutputFlags) => {
    try {
        if (await searxng.isHealthy()) {
            writeOut(opts.text ? "SearXNG already running." : JSON.stringify({ status: "already_running", url: SEARXNG_URL }));
            return;
        }
        await service.start();
        const ok = await service.waitForHealthy(20);
        if (!ok) errorOut("SearXNG did not become healthy within 20 seconds");
        writeOut(opts.text ? "SearXNG started." : JSON.stringify({ status: "started", url: SEARXNG_URL }));
    } catch (err) {
        errorOut(err instanceof Error ? err.message : String(err));
    }
});

program.command("stop").description("Stop SearXNG").option("--text", "Human-readable output").action(async (opts: OutputFlags) => {
    try {
        await service.stop();
        writeOut(opts.text ? "SearXNG stopped." : JSON.stringify({ status: "stopped" }));
    } catch (err) {
        errorOut(err instanceof Error ? err.message : String(err));
    }
});

program.command("restart").description("Restart SearXNG").option("--text", "Human-readable output").action(async (opts: OutputFlags) => {
    try {
        await service.restart();
        const ok = await service.waitForHealthy(20);
        writeOut(opts.text ? (ok ? "SearXNG restarted." : "SearXNG restarted but not yet responding.") : JSON.stringify({ status: ok ? "restarted" : "restarting", url: SEARXNG_URL }));
    } catch (err) {
        errorOut(err instanceof Error ? err.message : String(err));
    }
});

program.command("engines").description("List enabled engines by category").option("--text", "Human-readable output").action(async (opts: OutputFlags) => {
    try {
        if (!(await searxng.isHealthy())) errorOut("SearXNG is not running. Try: searx start");
        const result = await searxng.listEngines();
        writeOut(opts.text ? fmt.enginesText(result) : fmt.enginesJSON(result));
    } catch (err) {
        errorOut(err instanceof Error ? err.message : String(err));
    }
});

program.action(async () => {
    const result = await runDoctor();
    writeOut(doctorText(result));
});

program.parse();
