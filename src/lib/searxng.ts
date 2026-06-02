/**
 * SearXNG HTTP client — search, fetch config, engine listings.
 *
 * Thin wrapper over the SearXNG JSON API.
 * All methods are static-free functions for easy composition.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8042";

// ── Types ──────────────────────────────────────────────────

export interface SearchParams {
	query: string;
	categories?: string;
	engines?: string;
	timeRange?: string;
	language?: string;
	limit?: number;
	page?: number;
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	engines: string[];
	date?: string;
	category: string;
	score?: number;
}

export interface SearchOutput {
	query: string;
	total: number;
	returned: number;
	page: number;
	results: SearchResult[];
	answers?: string[];
	suggestions?: string[];
	unresponsive?: Array<{ engine: string; reason: string }>;
}

export interface EngineInfo {
	name: string;
	enabled: boolean;
	categories: string[];
}

export interface ConfigOutput {
	total_enabled: number;
	total_disabled: number;
	categories: string[];
	engines_by_category: Record<string, string[]>;
}

export interface FetchOutput {
	url: string;
	total_length: number;
	offset: number;
	shown_length: number;
	has_more: boolean;
	next_offset?: number;
	content: string;
}

// ── HTTP helpers ───────────────────────────────────────────

async function fetchJSON<T>(url: string, timeout = 15_000): Promise<T> {
	const resp = await fetch(url, {
		headers: { "User-Agent": "searx-cli/2.0", Accept: "application/json" },
		signal: AbortSignal.timeout(timeout),
		redirect: "follow",
	});
	if (!resp.ok) {
		throw new Error(`HTTP ${resp.status} from SearXNG`);
	}
	return resp.json() as Promise<T>;
}

// ── Health ─────────────────────────────────────────────────

export async function isHealthy(): Promise<boolean> {
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

// ── Search ─────────────────────────────────────────────────

export async function search(params: SearchParams): Promise<SearchOutput> {
	const qs = new URLSearchParams({
		q: params.query,
		format: "json",
		pageno: String(params.page || 1),
	});
	if (params.categories) qs.set("categories", params.categories);
	if (params.engines) qs.set("engines", params.engines);
	if (params.timeRange) qs.set("time_range", params.timeRange);
	if (params.language) qs.set("language", params.language);

	// Ask for more results then slice, so we respect the limit
	const url = `${SEARXNG_URL}/search?${qs}`;
	const data = await fetchJSON<Record<string, unknown>>(url);

	const limit = params.limit || 8;
	const raw = (data.results as Record<string, unknown>[]) || [];
	const sliced = raw.slice(0, limit);

	const results: SearchResult[] = sliced.map((r) => ({
		title: String(r.title || ""),
		url: String(r.url || ""),
		snippet: String(r.content || "").slice(0, 300),
		engines: (r.engines as string[]) || [],
		date: r.publishedDate ? String(r.publishedDate) : undefined,
		category: String(r.category || "general"),
		score: r.score as number | undefined,
	}));

	const output: SearchOutput = {
		query: String(data.query || params.query),
		total: (data.number_of_results as number) || 0,
		returned: results.length,
		page: params.page || 1,
		results,
	};

	if (data.answers) output.answers = data.answers as string[];
	if (data.suggestions) output.suggestions = data.suggestions as string[];
	if (data.unresponsive_engines) {
		output.unresponsive = (data.unresponsive_engines as string[][]).map((e) => ({
			engine: e[0],
			reason: e[1],
		}));
	}

	return output;
}

/** Fetch raw SearXNG JSON (for --json flag / jq piping). */
export async function searchRaw(
	params: SearchParams,
): Promise<Record<string, unknown>> {
	const qs = new URLSearchParams({
		q: params.query,
		format: "json",
		pageno: String(params.page || 1),
	});
	if (params.categories) qs.set("categories", params.categories);
	if (params.engines) qs.set("engines", params.engines);
	if (params.timeRange) qs.set("time_range", params.timeRange);
	if (params.language) qs.set("language", params.language);

	const url = `${SEARXNG_URL}/search?${qs}`;
	const data = await fetchJSON<Record<string, unknown>>(url);

	const limit = params.limit || 8;
	if (limit && data.results) {
		(data.results as unknown[]).splice(limit);
	}
	return data;
}

// ── Config / Engines ──────────────────────────────────────

export async function getConfig(): Promise<{
	engines: EngineInfo[];
	categories: string[];
}> {
	const data = await fetchJSON<{
		engines: Array<{ name: string; enabled: boolean; categories: string[] }>;
		categories: string[];
	}>(`${SEARXNG_URL}/config`, 5000);
	return {
		engines: data.engines.map((e) => ({
			name: e.name,
			enabled: e.enabled,
			categories: e.categories,
		})),
		categories: data.categories,
	};
}

export async function listEngines(): Promise<ConfigOutput> {
	const { engines, categories } = await getConfig();
	const enabled = engines.filter((e) => e.enabled);
	const disabled = engines.filter((e) => !e.enabled);

	const byCategory: Record<string, string[]> = {};
	for (const e of enabled) {
		for (const cat of e.categories.length ? e.categories : ["other"]) {
			(byCategory[cat] ??= []).push(e.name);
		}
	}

	return {
		total_enabled: enabled.length,
		total_disabled: disabled.length,
		categories,
		engines_by_category: byCategory,
	};
}

// ── Fetch (via markitdown) ─────────────────────────────────

export async function fetchPage(
	url: string,
	maxChars = 5000,
	offset = 0,
): Promise<FetchOutput> {
	let stdout: string;
	try {
		const result = await execFileAsync("uvx", [
			"--from",
			"markitdown[pdf]",
			"markitdown",
			url,
		], { timeout: 45_000 });
		stdout = result.stdout;
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error("uvx not found. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh");
		}
		throw new Error(
			`markitdown failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const text = stdout.trim();
	if (!text) throw new Error("markitdown returned empty output");

	const total = text.length;
	const sliced = text.slice(offset, offset + maxChars);
	const remaining = total - (offset + sliced.length);

	const output: FetchOutput = {
		url,
		total_length: total,
		offset,
		shown_length: sliced.length,
		has_more: remaining > 0,
		content: sliced,
	};

	if (remaining > 0) {
		output.next_offset = offset + maxChars;
	}

	return output;
}