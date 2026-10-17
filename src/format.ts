import { truncateUtf8 } from "./cache.ts";
import { formatBytes, formatCny, formatDuration, formatUsd } from "./usage.ts";
import type { FetchResponse, FetchToolDetails, SearchResult, SearchToolDetails } from "./types.ts";

function billingLine(details: SearchToolDetails | FetchToolDetails, unit: string): string {
	if (details.cached) {
		const original = details.requestedAt ? ` (original request at ${details.requestedAt})` : "";
		return `Session cache hit — no new charge${original}.`;
	}
	const billing = details.billing;
	if (!billing) return "Billing information unavailable.";
	if (!billing.billed) {
		const reason = billing.reason === "no-results" ? "no results" : billing.reason === "empty-content" ? "empty content" : "not billable";
		return `Not billed (${reason}).`;
	}
	return `Billed ${formatCny(billing.cny)} per successful ${unit} request (${formatUsd(billing.usd)} at ${billing.cnyPerUsd} CNY/USD).`;
}

function formatDate(value: string | null): string {
	if (!value) return "unknown date";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toISOString().slice(0, 10);
}

function formatAuthority(authority: number): string {
	if (authority < 0) return "unknown authority";
	if (authority >= 3) return `authority ${authority}/4 (very authoritative)`;
	return `authority ${authority}/4`;
}

function formatSearchResult(result: SearchResult, index: number, includeContent: boolean): string {
	const lines: string[] = [];
	lines.push(`${index + 1}. ${result.title}`);
	lines.push(`   URL: ${result.url}`);
	const meta: string[] = [];
	if (result.site_name) meta.push(result.site_name);
	meta.push(`published ${formatDate(result.date)}`);
	meta.push(`rerank ${result.rerank_score.toFixed(1)}`);
	meta.push(formatAuthority(result.authority));
	lines.push(`   ${meta.join(" · ")}`);
	const summary = result.summary.trim() || result.snippet.trim();
	if (summary) lines.push(`   Summary: ${summary}`);
	if (includeContent && result.content.trim()) {
		lines.push("   Content:");
		for (const line of result.content.split("\n")) lines.push(`   ${line}`);
	}
	return lines.join("\n");
}

export function formatSearchForModel(
	details: SearchToolDetails,
	results: SearchResult[],
	maxBytes: number,
): string {
	const header: string[] = [];
	header.push(`# DeepSeek web search: ${details.query}`);
	if (details.oriQuestion) header.push(`Original question: ${details.oriQuestion}`);
	const countText = `${results.length} result${results.length === 1 ? "" : "s"}`;
	const durationText = details.durationMs !== undefined ? ` · ${formatDuration(details.durationMs)}` : "";
	header.push(`${countText}${durationText}`);
	header.push(billingLine(details, "search"));
	if (details.note) header.push(`Note: ${details.note}`);
	header.push("");

	if (results.length === 0) {
		return [...header, "No matching results."].join("\n");
	}

	const intro = header.join("\n");
	let output = intro;
	for (let index = 0; index < results.length; index++) {
		const result = results[index]!;
		const block = `\n${formatSearchResult(result, index, details.needContent)}\n`;
		if (Buffer.byteLength(output + block, "utf8") > maxBytes) {
			const remaining = results.length - index;
			output += `\n[${remaining} more result${remaining === 1 ? "" : "s"} omitted to stay within the ${formatBytes(maxBytes)} model-facing limit. Use a smaller count or enable need_content for a specific query.]\n`;
			break;
		}
		output += block;
	}
	return output.trimEnd();
}

export function formatFetchForModel(
	details: FetchToolDetails,
	response: FetchResponse,
	maxBytes: number,
): string {
	const lines: string[] = [];
	lines.push(`# ${response.title || "(untitled page)"}`);
	lines.push(`URL: ${details.url}`);
	const meta: string[] = [];
	if (details.durationMs !== undefined) meta.push(formatDuration(details.durationMs));
	meta.push(formatBytes(details.contentBytes ?? Buffer.byteLength(response.content, "utf8")));
	meta.push(`${response.content.split("\n").length} lines`);
	lines.push(meta.join(" · "));
	lines.push(billingLine(details, "fetch"));
	if (details.note) lines.push(`Note: ${details.note}`);
	lines.push("");

	const limit = maxBytes;
	const truncated = truncateUtf8(response.content, limit);
	lines.push(truncated.text);
	if (truncated.truncated) {
		lines.push("");
		const cacheNote = details.cachePath
			? `Full content cached at ${details.cachePath} (${details.contentLines ?? "unknown"} lines). Use the read tool with offset/limit to read more.`
			: "Full content exceeds the model-facing limit.";
		lines.push(
			`[Content truncated: showing first ${formatBytes(Buffer.byteLength(truncated.text, "utf8"))} of ${formatBytes(truncated.bytes)}. ${cacheNote}]`,
		);
	}
	return lines.join("\n");
}
