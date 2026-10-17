import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
	renderFetchCall,
	renderFetchResult,
	renderSearchCall,
	renderSearchResult,
} from "../src/render/tool-cards.ts";
import type { FetchToolDetails, SearchToolDetails } from "../src/types.ts";

const foregroundTokens = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"scrollbarTrack",
	"scrollbarThumb",
	"searchMatchText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
	"bashMode",
] as const;

const backgroundTokens = [
	"selectedBg",
	"searchMatchBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
] as const;

function createTestTheme(): Theme {
	const foreground = Object.fromEntries(foregroundTokens.map((token) => [token, "#89b4fa"]));
	const background = Object.fromEntries(backgroundTokens.map((token) => [token, "#1e1e2e"]));
	return new Theme(
		foreground as unknown as ConstructorParameters<typeof Theme>[0],
		background as unknown as ConstructorParameters<typeof Theme>[1],
		"truecolor",
		{ name: "test-dark", appearance: "dark" },
	);
}

const theme = createTestTheme();
initTheme("dark");

function assertFits(component: { render(width: number): string[] }, widths: number[] = [32, 60, 80, 120]): void {
	for (const width of widths) {
		const lines = component.render(width);
		assert.ok(lines.length > 0, `expected lines at width ${width}`);
		for (const line of lines) {
			assert.equal(visibleWidth(line), width, `line does not fit width ${width}: ${JSON.stringify(line)}`);
		}
	}
}

function searchDetails(overrides: Partial<SearchToolDetails> = {}): SearchToolDetails {
	return {
		kind: "search",
		stage: "done",
		query: "DeepSeek V4 发布 site:github.com lang:zh",
		count: 2,
		needContent: false,
		startedAt: Date.now() - 420,
		durationMs: 420,
		results: [
			{
				rerank_score: 2.4,
				title: "DeepSeek V4 模型发布 🚀",
				url: "https://example.com/deepseek-v4",
				snippet: "支持工具调用与长上下文。",
				summary: "DeepSeek 发布了 V4 模型，改进了工具调用与长上下文能力。",
				site_name: "Example News",
				site_icon: null,
				date: "2026-06-01T00:00:00+00:00",
				authority: 3,
				contentChars: 120,
				contentBytes: 360,
			},
			{
				rerank_score: 1.1,
				title: "Community thread",
				url: "https://forum.example.org/thread/42",
				snippet: "A short snippet.",
				summary: "A community discussion.",
				site_name: null,
				site_icon: null,
				date: null,
				authority: -1,
				contentChars: 0,
				contentBytes: 0,
			},
		],
		cached: false,
		requestedAt: "2026-10-17T10:30:00.000Z",
		billing: { billed: true, cny: 0.005, usd: 0.005 / 7.2, cnyPerUsd: 7.2 },
		...overrides,
	};
}

test("search call card shows the query, options, and operators", () => {
	const card = renderSearchCall(
		{ query: "DeepSeek V4 site:github.com lang:zh after:2025", count: 5, need_content: true },
		theme,
	);
	const text = card.render(100).join("\n");
	assert.match(text, /DeepSeek V4/);
	assert.match(text, /count 5/);
	assert.match(text, /need_content/);
	assert.match(text, /operators: site:github\.com · lang:zh · after:2025/);
	assertFits(card);
});

test("collapsed search card shows top results and the expand hint", () => {
	const card = renderSearchResult(searchDetails(), "", { expanded: false }, theme);
	const text = card.render(100).join("\n");
	assert.match(text, /DeepSeek V4 模型发布/);
	assert.match(text, /Example News/);
	assert.match(text, /A2|A3/);
	assert.match(text, /ctrl\+o/);
	assert.match(text, /¥0\.005 billed/);
	assertFits(card);
});

test("expanded search card shows URLs and summaries", () => {
	const card = renderSearchResult(searchDetails(), "", { expanded: true }, theme);
	const text = card.render(120).join("\n");
	assert.match(text, /https:\/\/example\.com\/deepseek-v4/);
	assert.match(text, /DeepSeek 发布了 V4 模型/);
	assertFits(card);
});

test("cache-hit and empty search cards report billing correctly", () => {
	const cached = renderSearchResult(
		searchDetails({ cached: true, billing: { billed: false, cny: 0, usd: 0, cnyPerUsd: 7.2 } }),
		"",
		{ expanded: false },
		theme,
	);
	assert.match(cached.render(100).join("\n"), /cache hit · no new charge/);

	const empty = renderSearchResult(
		searchDetails({ results: [], billing: { billed: false, cny: 0, usd: 0, cnyPerUsd: 7.2, reason: "no-results" } }),
		"",
		{ expanded: false },
		theme,
	);
	const emptyText = empty.render(100).join("\n");
	assert.match(emptyText, /No matching results/);
	assert.match(emptyText, /not billed/);
});

test("pending and error search cards render their states", () => {
	const pending = renderSearchResult(
		searchDetails({ stage: "requesting", durationMs: 250 }),
		"",
		{ expanded: false, isPartial: true },
		theme,
	);
	assert.match(pending.render(100).join("\n"), /requesting/);

	const failed = renderSearchResult(
		searchDetails({
			stage: "error",
			error: { message: "HTTP 429: rate limited", status: 429, code: "rate_limit", retryable: true },
		}),
		"",
		{ expanded: false },
		theme,
	);
	const failedText = failed.render(100).join("\n");
	assert.match(failedText, /rate limited/);
	assert.match(failedText, /HTTP 429/);
	assert.match(failedText, /retryable/);
	assertFits(failed);
});

test("fetch call and result cards render content and cache details", () => {
	const call = renderFetchCall({ url: "https://example.com/article" }, theme);
	assert.match(call.render(80).join("\n"), /example\.com\/article/);
	assertFits(call);

	const details: FetchToolDetails = {
		kind: "fetch",
		stage: "done",
		url: "https://example.com/article",
		startedAt: Date.now() - 800,
		durationMs: 812,
		title: "Example article",
		contentChars: 180,
		contentBytes: 180,
		contentLines: 2,
		preview: "# Example article\n\nArticle content.",
		cachePath: "/home/user/.pi/agent/cache/deepseek-web-tools/fetch/page.md",
		truncated: true,
		bytesReturned: 180,
		cached: false,
		billing: { billed: true, cny: 0.005, usd: 0.005 / 7.2, cnyPerUsd: 7.2 },
	};
	const collapsed = renderFetchResult(details, "", { expanded: false }, theme);
	const collapsedText = collapsed.render(100).join("\n");
	assert.match(collapsedText, /Example article/);
	assert.match(collapsedText, /Full content cached at/);
	assert.match(collapsedText, /¥0\.005 billed/);
	assertFits(collapsed);

	const expanded = renderFetchResult(details, "", { expanded: true }, theme);
	assertFits(expanded);
});

test("cards also fit very narrow terminal widths", () => {
	const card = renderSearchResult(searchDetails(), "", { expanded: false }, theme);
	for (const width of [1, 4, 7]) {
		const lines = card.render(width);
		for (const line of lines) {
			assert.ok(visibleWidth(line) <= width, `line exceeds narrow width ${width}: ${JSON.stringify(line)}`);
		}
	}
});

test("wrapped result text keeps the five-space indentation", () => {
	const longSnippet = "这是一个很长的摘要，用来验证换行以后仍然保留结果行前面的缩进。".repeat(4);
	const card = renderSearchResult(
		searchDetails({
			results: [{ ...searchDetails().results[0]!, snippet: longSnippet }],
		}),
		"",
		{ expanded: false },
		theme,
	);
	const lines = card.render(64);
	const snippetLines = lines.filter((line) => stripTerminalSequences(line).includes("这是一个很长的摘要"));
	assert.ok(snippetLines.length > 1, "expected the snippet to wrap");
	for (const line of snippetLines) {
		assert.ok(
			stripTerminalSequences(line).includes("│     "),
			`wrapped line lost its indentation: ${JSON.stringify(line)}`,
		);
	}
});

test("fetch card shortens the cache path under the home directory", () => {
	const home = process.env.HOME;
	assert.ok(home, "HOME is required for this test");
	const card = renderFetchResult(
		{
			kind: "fetch",
			stage: "done",
			url: "https://example.com/article",
			startedAt: Date.now() - 100,
			durationMs: 100,
			title: "Example article",
			contentChars: 200_000,
			contentBytes: 200_000,
			contentLines: 5_000,
			preview: "body",
			cachePath: `${home}/.pi/agent/cache/deepseek-web-tools/fetch/page.md`,
			truncated: true,
			bytesReturned: 48_000,
			cached: false,
			billing: { billed: true, cny: 0.005, usd: 0.005 / 7.2, cnyPerUsd: 7.2 },
		},
		"",
		{ expanded: false },
		theme,
	);
	assert.match(card.render(120).join("\n"), /~\/\.pi\/agent\/cache\/deepseek-web-tools\/fetch\/page\.md/);
});

test("fetch previews strip terminal escape sequences", () => {
	const card = renderFetchResult(
		{
			kind: "fetch",
			stage: "done",
			url: "https://example.com/article",
			startedAt: Date.now() - 100,
			durationMs: 100,
			title: "Example article",
			contentChars: 100,
			contentBytes: 100,
			contentLines: 2,
			preview: "\u001b]0;pwned\u0007# Example article\n\nBody",
			truncated: false,
			bytesReturned: 100,
			cached: false,
			billing: { billed: true, cny: 0.005, usd: 0.005 / 7.2, cnyPerUsd: 7.2 },
		},
		"",
		{ expanded: true },
		theme,
	);
	const text = card.render(100).join("\n");
	assert.doesNotMatch(text, /pwned/);
	assert.match(text, /Body/);
});

test("untrusted terminal escape sequences are stripped from card content", () => {
	const card = renderSearchResult(
		searchDetails({
			results: [
				{
					...searchDetails().results[0]!,
					title: "\u001b]0;pwned\u0007Injected title",
					snippet: "\u001b[31mred text\u001b[0m",
				},
			],
		}),
		"",
		{ expanded: true },
		theme,
	);
	const text = card.render(100).join("\n");
	assert.doesNotMatch(text, /pwned/);
	assert.doesNotMatch(text, /\u001b\]0;/);
	assert.match(text, /Injected title/);
});
