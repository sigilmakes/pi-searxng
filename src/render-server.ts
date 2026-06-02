/**
 * HTTP rendering service for SearXNG custom engines.
 *
 * Exposes Playwright rendering over HTTP so SearXNG Python engine modules
 * running inside Docker can render pages through the host's browser.
 *
 * Endpoints:
 *   POST /render  { url, wait?, timeout? } → { title, html, text }
 *   GET  /health  → { ok: true }
 *
 * Usage:
 *   searx render-server            # start on port 8118
 *   searx render-server --port 9000
 */

import http from "node:http";
import { render, close, isAvailable, type BrowserResult } from "./lib/browser.js";

const DEFAULT_PORT = 8118;

interface RenderRequest {
    url: string;
    wait?: number;
    timeout?: number;
}

function parseBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
}

export async function startServer(port = DEFAULT_PORT): Promise<void> {
    if (!(await isAvailable())) {
        console.error("No browser available. Set SEARX_BROWSER_PATH or run: npx playwright install chromium");
        process.exit(1);
    }

    const server = http.createServer(async (req, res) => {
        // CORS for dev
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url || "/", `http://localhost:${port}`);

        // Health check
        if (url.pathname === "/health" && req.method === "GET") {
            sendJSON(res, 200, { ok: true });
            return;
        }

        // Render page
        if (url.pathname === "/render" && req.method === "POST") {
            try {
                const body = await parseBody(req);
                const params = JSON.parse(body) as RenderRequest;

                if (!params.url) {
                    sendJSON(res, 400, { error: "missing url" });
                    return;
                }

                const result: BrowserResult = await render(params.url, {
                    wait: params.wait,
                    timeout: params.timeout,
                });

                sendJSON(res, 200, {
                    title: result.title,
                    html: result.html,
                    text: result.text,
                    duration_ms: result.duration_ms,
                });
            } catch (err) {
                sendJSON(res, 500, {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            return;
        }

        // Extract elements
        if (url.pathname === "/extract" && req.method === "POST") {
            try {
                const body = await parseBody(req);
                const params = JSON.parse(body) as { url: string; selectors: string[]; wait?: number };

                if (!params.url || !params.selectors?.length) {
                    sendJSON(res, 400, { error: "missing url or selectors" });
                    return;
                }

                // Dynamic import to avoid circular
                const { extract } = await import("./lib/browser.js");
                const results = await extract(params.url, params.selectors, { wait: params.wait });

                sendJSON(res, 200, results);
            } catch (err) {
                sendJSON(res, 500, {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            return;
        }

        sendJSON(res, 404, { error: "not found" });
    });

    server.listen(port, () => {
        console.log(`Render server listening on port ${port}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
        console.log("\nShutting down...");
        server.close();
        await close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}