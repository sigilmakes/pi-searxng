/**
 * Docker Compose lifecycle — start, stop, restart, status.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const COMPOSE_FILE = path.join(PACKAGE_ROOT, "docker", "docker-compose.yaml");

export interface ContainerInfo {
	name?: string;
	state?: string;
	status?: string;
	image?: string;
	[key: string]: unknown;
}

async function dockerCompose(...args: string[]): Promise<{ stdout: string; stderr: string }> {
	return execFileAsync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
		timeout: 30_000,
	});
}

/** Check if SearXNG is responding on its HTTP port. */
export async function waitForHealthy(seconds: number): Promise<boolean> {
	for (let i = 0; i < seconds; i++) {
		try {
			const resp = await fetch(
				process.env.SEARXNG_URL || "http://localhost:8042",
				{ signal: AbortSignal.timeout(3000), redirect: "follow" },
			);
			if (resp.ok) return true;
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	return false;
}

/** Start SearXNG containers (docker compose up -d). */
export async function start(): Promise<void> {
	await dockerCompose("up", "-d");
}

/** Stop SearXNG containers (docker compose down). */
export async function stop(): Promise<void> {
	await dockerCompose("down");
}

/** Restart SearXNG containers (docker compose restart). */
export async function restart(): Promise<void> {
	await dockerCompose("restart");
}

/** Get container status. */
export async function ps(): Promise<ContainerInfo[]> {
	try {
		const { stdout } = await dockerCompose("ps", "--format", "json");
		if (!stdout.trim()) return [];
		return stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as ContainerInfo);
	} catch {
		return [];
	}
}

export { COMPOSE_FILE };