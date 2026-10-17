import assert from "node:assert/strict";
import test from "node:test";
import { formatFetchForModel, formatSearchForModel } from "../src/format.ts";
import type { FetchToolDetails, SearchResult, SearchToolDetails } from "../src/types.ts";

const RATE = 7.2;

const results: SearchResult[] = [
	{
		rerank_score: 2.4,
		title: "DeepSeek V4 model released",
		url: "https://example.com/deepseek-v4",
		snippet: "DeepSeek V4 is now available, with tool calling and long-context support.",
		summary:
			"DeepSeek has released the V4 model. The release adds improved tool calling and long-context support for agent workflows.",
		content: "DeepSeek V4 is now generally available...",
		site_name: "Example News",
		site_icon: "https://example.com/favicon.ico",
		date: "2026-06-01T00:00:00+00:00",
		authority: 3,
	},
	{
		rerank_score: 1.2,
		title: "Community discussion",
		url: "https://forum.example.org/thread/42",
		snippet: "Users discuss the new model.",
		summary: "A community thread about the release.",
		content: "",
		site_name: null,
		site_icon: null,
		date: null,
		authority: -1,
	},
];

function searchDetails(overrides: Partial<SearchToolDetails> = {}): SearchToolDetails {
	return {
		kind: "search",
		stage: "done",
		query: "DeepSeek V4 发布",
		count: 2,
		needContent: false,
		startedAt: 0,
		durationMs: 420,
		results: results.map(({ content, ...rest }) => ({
			...rest,
			contentChars: content.length,
			contentBytes: Buffer.byteLength(content, "utf8"),
		})),
		cached: false,
		requestedAt: "2026-10-17T10:30:00.000Z",
		billing: { billed: true, cny: 0.005, usd: 0.005 / RATE, cnyPerUsd: RATE },
		...overrides,
	};
}

test("search output includes result metadata, summary, and billing", () => {
	const output = formatSearchForModel(searchDetails(), results, 48 * 1024);
	assert.match(output, /DeepSeek web search: DeepSeek V4 发布/);
	assert.match(output, /2 results/);
	assert.match(output, /DeepSeek V4 model released/);
	assert.match(output, /https:\/\/example\.com\/deepseek-v4/);
	assert.match(output, /Example News/);
	assert.match(output, /published 2026-06-01/);
	assert.match(output, /rerank 2\.4/);
	assert.match(output, /authority 3\/4/);
	assert.match(output, /Summary: DeepSeek has released the V4 model/);
	assert.match(output, /Billed ¥0\.005/);
	assert.doesNotMatch(output, /DeepSeek V4 is now generally available/);
});

test("need_content appends page bodies", () => {
	const output = formatSearchForModel(searchDetails({ needContent: true }), results, 48 * 1024);
	assert.match(output, /Content:\n   DeepSeek V4 is now generally available/);
});

test("cache hits are reported without a new charge", () => {
	const output = formatSearchForModel(
		searchDetails({
			cached: true,
			billing: { billed: false, cny: 0, usd: 0, cnyPerUsd: RATE },
		}),
		results,
		48 * 1024,
	);
	assert.match(output, /Session cache hit — no new charge/);
	assert.match(output, /original request at 2026-10-17T10:30:00.000Z/);
});

test("empty search results are not billed", () => {
	const output = formatSearchForModel(
		searchDetails({
			results: [],
			billing: { billed: false, cny: 0, usd: 0, cnyPerUsd: RATE, reason: "no-results" },
		}),
		[],
		48 * 1024,
	);
	assert.match(output, /0 results/);
	assert.match(output, /No matching results/);
	assert.match(output, /Not billed \(no results\)/);
});

test("search output is capped by the byte limit", () => {
	const withHint = formatSearchForModel(searchDetails(), results, 700);
	assert.match(withHint, /more result/);
	assert.ok(Buffer.byteLength(withHint, "utf8") <= 700);

	const hardCap = formatSearchForModel(searchDetails(), results, 300);
	assert.ok(Buffer.byteLength(hardCap, "utf8") <= 300);
});

function fetchDetails(overrides: Partial<FetchToolDetails> = {}): FetchToolDetails {
	return {
		kind: "fetch",
		stage: "done",
		url: "https://example.com/article",
		startedAt: 0,
		durationMs: 812,
		title: "Example article",
		contentChars: 180,
		contentBytes: 180,
		contentLines: 2,
		preview: "Example article\n\nArticle content.",
		cached: false,
		billing: { billed: true, cny: 0.005, usd: 0.005 / RATE, cnyPerUsd: RATE },
		...overrides,
	};
}

test("fetch output includes title, metadata, and full content when small", () => {
	const response = { title: "Example article", content: "Line one.\nLine two." };
	const output = formatFetchForModel(fetchDetails(), response, 48 * 1024);
	assert.match(output, /# Example article/);
	assert.match(output, /URL: https:\/\/example\.com\/article/);
	assert.match(output, /180 B/);
	assert.match(output, /2 lines/);
	assert.match(output, /Billed ¥0\.005/);
	assert.match(output, /Line one\.\nLine two\./);
	assert.doesNotMatch(output, /Content truncated/);
});

test("fetch output points at the cached file when truncated", () => {
	const content = "0123456789".repeat(100);
	const response = { title: "Long page", content };
	const output = formatFetchForModel(
		fetchDetails({
			title: "Long page",
			contentChars: content.length,
			contentBytes: Buffer.byteLength(content),
			contentLines: 1,
			cachePath: "/home/user/.pi/agent/cache/deepseek-web-tools/fetch/page.md",
			truncated: true,
			bytesReturned: 120,
		}),
		response,
		1024,
	);
	assert.match(output, /Content truncated/);
	assert.match(output, /Full content cached at \/home\/user\/\.pi\/agent\/cache\/deepseek-web-tools\/fetch\/page\.md/);
	assert.match(output, /Use the read tool with offset\/limit/);
	assert.ok(Buffer.byteLength(output, "utf8") <= 1024);
});
