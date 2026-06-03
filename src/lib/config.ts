/** Persistent pi-searxng configuration. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SearxConfig {
    browserPath?: string;
    browserState?: string;
    browserProfile?: string;
    renderPort: number;
    autoStartRenderServer: boolean;
}

export const CONFIG_DIR = path.join(os.homedir(), ".pi", "agent", "searxng");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const DEFAULT_BROWSER_STATE = path.join(os.homedir(), ".pi", "agent", "searx-browser-state.json");
export const DEFAULT_BROWSER_PROFILE = path.join(os.homedir(), ".pi", "agent", "searx-browser-profile");
export const DEFAULT_RENDER_PORT = 8118;

export const DEFAULT_CONFIG: SearxConfig = {
    renderPort: DEFAULT_RENDER_PORT,
    autoStartRenderServer: true,
};

export function loadConfig(): SearxConfig {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<SearxConfig>;
        return {
            ...DEFAULT_CONFIG,
            ...raw,
            renderPort: Number(raw.renderPort) || DEFAULT_RENDER_PORT,
            autoStartRenderServer: raw.autoStartRenderServer ?? true,
        };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

export function saveConfig(config: SearxConfig): void {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function setConfigValue(key: keyof SearxConfig, value: string): SearxConfig {
    const config = loadConfig();
    switch (key) {
        case "renderPort":
            config.renderPort = Number(value) || DEFAULT_RENDER_PORT;
            break;
        case "autoStartRenderServer":
            config.autoStartRenderServer = value === "true" || value === "1" || value === "yes";
            break;
        case "browserPath":
            config.browserPath = value;
            break;
        case "browserState":
            config.browserState = value;
            break;
        case "browserProfile":
            config.browserProfile = value;
            break;
        default:
            throw new Error(`Unknown config key: ${String(key)}`);
    }
    saveConfig(config);
    return config;
}

export function browserStatePath(): string {
    return process.env.SEARX_BROWSER_STATE || loadConfig().browserState || DEFAULT_BROWSER_STATE;
}

export function browserProfilePath(): string {
    return process.env.SEARX_BROWSER_PROFILE || loadConfig().browserProfile || DEFAULT_BROWSER_PROFILE;
}

export function renderPort(): number {
    return Number(process.env.SEARX_RENDER_PORT) || loadConfig().renderPort || DEFAULT_RENDER_PORT;
}

export function renderUrl(): string {
    return process.env.SEARX_RENDER_URL || `http://localhost:${renderPort()}`;
}

export function resolveBrowserPath(): string | undefined {
    if (process.env.SEARX_BROWSER_PATH) return process.env.SEARX_BROWSER_PATH;
    const configured = loadConfig().browserPath;
    if (configured) return configured;

    for (const name of ["chromium", "chromium-browser", "google-chrome", "chrome", "msedge"]) {
        const found = findOnPath(name);
        if (found) return found;
    }

    return undefined;
}

function findOnPath(name: string): string | undefined {
    const paths = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    for (const dir of paths) {
        const candidate = path.join(dir, name);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // keep looking
        }
    }
    return undefined;
}
