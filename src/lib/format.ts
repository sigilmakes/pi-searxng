/**
 * Output formatting — JSON and text renderers for search, fetch, status, engines.
 */

import type { SearchOutput, FetchOutput, ConfigOutput } from "./searxng.js";
import type { ContainerInfo } from "./service.js";

// ── Search ─────────────────────────────────────────────────

export function searchJSON(out: SearchOutput): string {
	return JSON.stringify(out, null, 2);
}

export function searchText(out: SearchOutput): string {
	const lines: string[] = [];
	lines.push(`Search: "${out.query}" — ${out.returned} results`);

	const unresponsive = out.unresponsive || [];
	if (out.results.length === 0) {
		if (unresponsive.length > 0) {
			lines.push(
				`\n⚠ All engines unresponsive: ${unresponsive.map((e) => e.engine).join(", ")}`,
			);
			lines.push("Try: searx restart");
		} else {
			lines.push(
				"\nNo results. If using Playwright engines, they may need browser auth.",
			);
			lines.push("Try: searx browser-auth \"https://www.google.com/search?q=test\"");
		}
		return lines.join("\n");
	}

	if (unresponsive.length > 0) {
		const down = unresponsive
			.map((e) => `${e.engine} (${e.reason})`)
			.join(", ");
		lines.push(`⚠ ${unresponsive.length} engine(s) down: ${down}`);
	}

	for (let i = 0; i < out.results.length; i++) {
		const r = out.results[i];
		lines.push(`\n${i + 1}. ${r.title}`);
		lines.push(`   ${r.url}`);
		if (r.snippet) lines.push(`   ${r.snippet}`);
		const meta: string[] = [];
		if (r.engines.length > 1) meta.push(r.engines.join(", "));
		if (r.date) meta.push(r.date.slice(0, 10));
		if (meta.length) lines.push(`   ${meta.join(" · ")}`);
	}

	if (out.answers?.length) {
		lines.push("\nDirect answers:");
		for (const a of out.answers) lines.push(`  • ${a}`);
	}

	if (out.suggestions?.length) {
		lines.push(`\nRelated: ${out.suggestions.join(", ")}`);
	}

	return lines.join("\n");
}

// ── Fetch ──────────────────────────────────────────────────

export function fetchJSON(out: FetchOutput & { method?: string }): string {
	return JSON.stringify(out, null, 2);
}

export function fetchText(out: FetchOutput): string {
	const lines: string[] = [out.content];
	if (out.has_more) {
		lines.push(
			`\n--- [${out.total_length - out.offset - out.shown_length} more characters, use --offset ${out.next_offset}] ---`,
		);
	}
	return lines.join("\n");
}

// ── Status ─────────────────────────────────────────────────

export interface StatusOutput {
	url: string;
	healthy: boolean;
	compose_file: string;
	containers: ContainerInfo[];
	engine_check?: {
		results?: number;
		unresponsive_count?: number;
		unresponsive?: Array<{ engine: string; reason: string }>;
		error?: string;
	};
}

export function statusJSON(out: StatusOutput): string {
	return JSON.stringify(out, null, 2);
}

export function statusText(out: StatusOutput): string {
	const lines: string[] = [];
	const label = out.healthy ? "✓ running" : "✗ not responding";
	lines.push(`SearXNG: ${label}`);
	lines.push(`URL: ${out.url}`);
	lines.push(`Compose: ${out.compose_file}`);

	if (out.healthy && out.engine_check) {
		const ec = out.engine_check;
		if (ec.error) {
			lines.push(`Health check: ${ec.error}`);
		} else {
			lines.push(`Health check: ${ec.results ?? "?"} result(s)`);
			if (ec.unresponsive && ec.unresponsive.length > 0) {
				const down = ec.unresponsive
					.map((e) => `${e.engine} (${e.reason})`)
					.join(", ");
				lines.push(`Unresponsive: ${down}`);
			} else {
				lines.push("All queried engines responding.");
			}
		}
	}

	return lines.join("\n");
}

// ── Engines ────────────────────────────────────────────────

export function enginesJSON(out: ConfigOutput): string {
	return JSON.stringify(out, null, 2);
}

export function enginesText(out: ConfigOutput): string {
	const lines: string[] = [];
	lines.push(
		`Engines: ${out.total_enabled} enabled, ${out.total_disabled} disabled`,
	);
	lines.push(`Categories: ${out.categories.join(", ")}\n`);
	for (const cat of Object.keys(out.engines_by_category).sort()) {
		const engines = out.engines_by_category[cat].sort();
		lines.push(`  ${cat}: ${engines.join(", ")}`);
	}
	return lines.join("\n");
}