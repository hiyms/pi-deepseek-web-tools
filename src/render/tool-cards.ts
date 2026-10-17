import type { Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Markdown, stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { formatBytes, formatCny, formatDuration, formatUsd } from "../usage.ts";
import type { FetchToolDetails, SearchResultSummary, SearchToolDetails, ToolDetails } from "../types.ts";
import { Card, type CardTone } from "./card.ts";
import { PrefixLines, type PrefixLine } from "./prefix-lines.ts";

export interface SearchCallArgs {
	query?: string;
	count?: number;
	ori_question?: string;
	localization?: string;
	need_content?: boolean;
}

export interface FetchCallArgs {
	url?: string;
}

export interface CardRenderOptions {
	expanded: boolean;
	isPartial?: boolean;
	commandView?: boolean;
}

function clean(value: string | null | undefined): string {
	if (!value) return "";
	return stripTerminalSequences(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function singleLine(value: string | null | undefined): string {
	return clean(value).replace(/\s+/g, " ").trim();
}

function displayPath(path: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

function stageLabel(stage: SearchToolDetails["stage"]): string {
	switch (stage) {
		case "queued":
			return "queued";
		case "requesting":
			return "requesting";
		case "parsing":
			return "parsing";
		case "writing-cache":
			return "writing cache";
		case "done":
			return "done";
		case "cache-hit":
			return "cache hit";
		case "error":
			return "failed";
	}
}

function durationOf(details: ToolDetails): string {
	return formatDuration(details.durationMs ?? Math.max(0, Date.now() - details.startedAt));
}

function billingText(details: ToolDetails): string {
	if (details.cached) return "cache hit · no new charge";
	const billing = details.billing;
	if (!billing) return "billing unknown";
	if (!billing.billed) return "not billed";
	return `${formatCny(billing.cny)} billed (${formatUsd(billing.usd)})`;
}

function toneFor(details: ToolDetails, isError: boolean): CardTone {
	if (isError || details.stage === "error") return "error";
	if (details.stage === "done" || details.stage === "cache-hit") return "success";
	return "pending";
}

function parseSearchOperators(query: string): string[] {
	const matches = query.match(/(?:^|\s)(-?"[^"]+"|(?:-?site:|lang:|after:|before:)\S+)/g) ?? [];
	return [...new Set(matches.map((match) => match.trim()).filter(Boolean))];
}

function shortenUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function formatPublished(date: string | null): string {
	if (!date) return "date unknown";
	const parsed = new Date(date);
	if (Number.isNaN(parsed.getTime())) return singleLine(date);
	return parsed.toISOString().slice(0, 10);
}

function scoreBadge(theme: Theme, score: number): string {
	if (score >= 1.5) return theme.fg("success", "●");
	if (score >= 1.0) return theme.fg("accent", "◐");
	return theme.fg("muted", "○");
}

function authorityBadge(theme: Theme, authority: number): string {
	if (authority < 0) return theme.fg("muted", "A?");
	if (authority >= 3) return theme.fg("success", `A${authority}`);
	if (authority === 2) return theme.fg("accent", "A2");
	return theme.fg("muted", `A${authority}`);
}

function resultLines(theme: Theme, result: SearchResultSummary, expanded: boolean): PrefixLine[] {
	const title = singleLine(result.title) || "(untitled)";
	const site = singleLine(result.site_name) || shortenUrl(result.url);
	const lines: PrefixLine[] = [
		{
			prefix: "",
			continuationPrefix: "     ",
			text: `${scoreBadge(theme, result.rerank_score)} ${theme.fg("accent", result.rerank_score.toFixed(1))}  ${theme.bold(title)}`,
		},
		{
			prefix: "     ",
			text: theme.fg(
				"dim",
				[
					site,
					authorityBadge(theme, result.authority),
					formatPublished(result.date),
					...(result.contentBytes > 0 ? [`${formatBytes(result.contentBytes)} body`] : []),
				].join(" · "),
			),
		},
	];
	if (expanded) {
		lines.push({ prefix: "     ", text: theme.fg("mdLinkUrl", clean(result.url)) });
		if (result.summary.trim()) lines.push({ prefix: "     ", text: theme.fg("toolOutput", clean(result.summary)) });
		if (result.snippet.trim()) lines.push({ prefix: "     ", text: theme.fg("muted", clean(result.snippet)) });
	} else if (result.snippet.trim()) {
		lines.push({ prefix: "     ", text: theme.fg("toolOutput", singleLine(result.snippet)) });
	}
	return lines;
}

function pendingCard(details: ToolDetails, theme: Theme, subject: string, description: string): Component {
	const lines: PrefixLine[] = [
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("accent", subject) },
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("dim", description) },
	];
	if (details.note) {
		lines.push({ prefix: "", continuationPrefix: "  ", text: theme.fg("warning", singleLine(details.note)) });
	}
	return new Card(
		{
			title: details.kind === "search" ? "DeepSeek Search" : "DeepSeek Fetch",
			meta: `${stageLabel(details.stage)} · ${durationOf(details)}`,
			children: [new PrefixLines(lines)],
			tone: "pending",
		},
		theme,
	);
}

function errorCard(details: ToolDetails, theme: Theme, subject: string): Component {
	const error = details.error;
	const lines: PrefixLine[] = [
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("accent", subject) },
		{ prefix: "", text: "" },
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("error", clean(error?.message) || "Unknown error") },
	];
	const metadata: string[] = [];
	if (error?.status !== undefined) metadata.push(`HTTP ${error.status}`);
	if (error?.code) metadata.push(`code ${error.code}`);
	if (error?.type) metadata.push(error.type);
	if (error?.retryable) metadata.push("retryable");
	if (metadata.length > 0) {
		lines.push({ prefix: "", continuationPrefix: "  ", text: theme.fg("dim", metadata.join(" · ")) });
	}
	if (details.note) {
		lines.push({ prefix: "", continuationPrefix: "  ", text: theme.fg("warning", singleLine(details.note)) });
	}
	return new Card(
		{
			title: details.kind === "search" ? "DeepSeek Search" : "DeepSeek Fetch",
			meta: `failed · ${durationOf(details)}`,
			children: [new PrefixLines(lines)],
			tone: "error",
		},
		theme,
	);
}

function searchDetails(value: unknown): SearchToolDetails | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const details = value as SearchToolDetails;
	if (details.kind !== "search" || typeof details.query !== "string" || !Array.isArray(details.results)) return undefined;
	return details;
}

function fetchDetails(value: unknown): FetchToolDetails | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const details = value as FetchToolDetails;
	if (details.kind !== "fetch" || typeof details.url !== "string") return undefined;
	return details;
}

export function renderSearchCall(args: SearchCallArgs, theme: Theme): Component {
	const query = singleLine(args.query) || "(query streaming…)";
	const badges = [`count ${args.count ?? "default"}`];
	if (args.need_content) badges.push("need_content");
	if (args.localization) badges.push(`localization ${singleLine(args.localization)}`);
	if (args.ori_question) badges.push("ori_question");
	const operators = parseSearchOperators(query);
	const lines: PrefixLine[] = [
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("accent", query) },
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("dim", badges.join(" · ")) },
	];
	if (operators.length > 0) {
		lines.push({
			prefix: "",
			continuationPrefix: "  ",
			text: theme.fg("muted", `operators: ${operators.join(" · ")}`),
		});
	}
	return new Card(
		{
			title: "DeepSeek Search",
			meta: "queued",
			children: [new PrefixLines(lines)],
			tone: "pending",
		},
		theme,
	);
}

export function renderSearchResult(
	detailsValue: unknown,
	content: string,
	options: CardRenderOptions,
	theme: Theme,
): Component {
	const details = searchDetails(detailsValue);
	if (!details) return new Text(clean(content) || "(no output)", 0, 0);
	if (options.isPartial || (details.stage !== "done" && details.stage !== "cache-hit" && details.stage !== "error")) {
		return pendingCard(details, theme, details.query, "Waiting for DeepSeek Search…");
	}
	if (details.stage === "error" || details.error) return errorCard(details, theme, details.query);

	const shownResults = options.commandView ? details.results.slice(0, 8) : details.results;
	const lines: PrefixLine[] = [
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("accent", singleLine(details.query)) },
		{
			prefix: "",
			continuationPrefix: "  ",
			text: theme.fg(
				"dim",
				[
					`count ${details.count}`,
					details.needContent ? "need_content" : "summary only",
					...(details.oriQuestion ? ["ori_question"] : []),
					...(details.localization ? [`localization ${singleLine(details.localization)}`] : []),
				].join(" · "),
			),
		},
	];
	if (details.note) {
		lines.push({ prefix: "", continuationPrefix: "  ", text: theme.fg("warning", singleLine(details.note)) });
	}
	lines.push({ prefix: "", text: "" });

	if (details.results.length === 0) {
		lines.push({ prefix: "", continuationPrefix: "  ", text: theme.fg("muted", "No matching results.") });
	} else {
		const visible = options.expanded ? shownResults : shownResults.slice(0, 5);
		for (const [index, result] of visible.entries()) {
			lines.push(...resultLines(theme, result, options.expanded));
			if (index < visible.length - 1) lines.push({ prefix: "", text: "" });
		}
		if (!options.expanded && details.results.length > visible.length) {
			lines.push({ prefix: "", text: "" });
			lines.push({
				prefix: "",
				continuationPrefix: "  ",
				text: theme.fg("muted", `… ${details.results.length - visible.length} more results, ctrl+o to expand`),
			});
		} else if (!options.expanded) {
			lines.push({ prefix: "", text: "" });
			lines.push({ prefix: "", continuationPrefix: "  ", text: theme.fg("muted", "ctrl+o for summaries and URLs") });
		}
	}

	const meta = [
		`${details.results.length} result${details.results.length === 1 ? "" : "s"}`,
		durationOf(details),
		billingText(details),
	].join(" · ");
	return new Card(
		{
			title: "DeepSeek Search",
			meta,
			children: [new PrefixLines(lines)],
			tone: toneFor(details, false),
		},
		theme,
	);
}

export function renderFetchCall(args: FetchCallArgs, theme: Theme): Component {
	const url = singleLine(args.url) || "(url streaming…)";
	const lines: PrefixLine[] = [
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("accent", url) },
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("dim", "page → Markdown") },
	];
	return new Card(
		{
			title: "DeepSeek Fetch",
			meta: "queued",
			children: [new PrefixLines(lines)],
			tone: "pending",
		},
		theme,
	);
}

export function renderFetchResult(
	detailsValue: unknown,
	content: string,
	options: CardRenderOptions,
	theme: Theme,
): Component {
	const details = fetchDetails(detailsValue);
	if (!details) return new Text(clean(content) || "(no output)", 0, 0);
	if (options.isPartial || (details.stage !== "done" && details.stage !== "cache-hit" && details.stage !== "error")) {
		return pendingCard(details, theme, details.url, "Fetching and converting the page…");
	}
	if (details.stage === "error" || details.error) return errorCard(details, theme, details.url);

	const header: PrefixLine[] = [
		{ prefix: "", continuationPrefix: "  ", text: theme.bold(theme.fg("text", singleLine(details.title) || "(untitled page)")) },
		{ prefix: "", continuationPrefix: "  ", text: theme.fg("mdLinkUrl", singleLine(details.url)) },
		{ prefix: "", text: "" },
	];
	if (details.note) {
		header.push({ prefix: "", continuationPrefix: "  ", text: theme.fg("warning", singleLine(details.note)) });
	}
	if (details.truncated && details.cachePath) {
		header.push({
			prefix: "  ",
			text: theme.fg(
				"warning",
				`Full content cached at ${displayPath(details.cachePath)} (${details.contentLines ?? "?"} lines). Use read with offset/limit.`,
			),
		});
	}
	header.push({ prefix: "", text: "" });

	const preview = details.preview ?? "";
	const previewLines = preview.split("\n");
	const limit = options.expanded ? (options.commandView ? 60 : 120) : 10;
	const shown = previewLines.slice(0, limit);
	const markdownText = shown.join("\n");
	const children: Component[] = [new PrefixLines(header)];
	if (options.expanded) {
		children.push(new Markdown(markdownText, 0, 0, getMarkdownTheme()));
	} else {
		children.push(new Text(theme.fg("toolOutput", shown.join("\n")), 0, 0));
	}
	if (previewLines.length > shown.length) {
		const moreText = details.cachePath
			? `… ${previewLines.length - shown.length} more lines in the cached page`
			: `… ${previewLines.length - shown.length} more lines, ctrl+o to expand`;
		children.push(new PrefixLines([{ prefix: "", continuationPrefix: "  ", text: theme.fg("muted", moreText) }]));
	}
	return new Card(
		{
			title: "DeepSeek Fetch",
			meta: [
				formatBytes(details.contentBytes ?? 0),
				`${details.contentLines ?? 0} lines`,
				durationOf(details),
				billingText(details),
			].join(" · "),
			children,
			tone: toneFor(details, false),
		},
		theme,
	);
}

export function renderToolCard(
	details: ToolDetails,
	options: CardRenderOptions,
	theme: Theme,
): Component {
	return details.kind === "search"
		? renderSearchResult(details, "", options, theme)
		: renderFetchResult(details, "", options, theme);
}
