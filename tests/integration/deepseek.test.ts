import assert from "node:assert/strict";
import test from "node:test";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { DeepSeekClient } from "../../src/api.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { formatFetchForModel, formatSearchForModel } from "../../src/format.ts";
import { fetchBilling, searchBilling } from "../../src/usage.ts";
import type { FetchToolDetails, SearchToolDetails } from "../../src/types.ts";

function resolveKey(): string | undefined {
	if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
	const credential = readStoredCredential("deepseek");
	if (credential?.type === "api_key") return credential.key;
	return undefined;
}

const apiKey = resolveKey();
const config = { ...DEFAULT_CONFIG, timeoutMs: 60_000 };
const client = apiKey ? new DeepSeekClient(config, apiKey) : undefined;
const missingKey = apiKey ? false : "No DEEPSEEK_API_KEY or stored deepseek credential";

test("real DeepSeek search returns ranked results and a billable request", { skip: missingKey }, async () => {
	const startedAt = Date.now();
	const { response, durationMs } = await client!.search({
		query: "DeepSeek V4 模型发布",
		count: 3,
		need_content: false,
	});
	assert.ok(response.results.length > 0, "expected at least one search result");
	for (const result of response.results) {
		assert.equal(typeof result.title, "string");
		assert.equal(typeof result.url, "string");
		assert.ok(result.url.startsWith("http"));
		assert.equal(typeof result.rerank_score, "number");
		assert.equal(typeof result.authority, "number");
		assert.equal(typeof result.summary, "string");
	}
	const billing = searchBilling(response.results.length, config.pricing.searchCny, config.cnyPerUsd);
	assert.equal(billing.billed, true);
	assert.equal(billing.cny, 0.005);
	const details: SearchToolDetails = {
		kind: "search",
		stage: "done",
		query: "DeepSeek V4 模型发布",
		count: 3,
		needContent: false,
		startedAt,
		durationMs,
		results: response.results.map(({ content, ...rest }) => ({
			...rest,
			contentChars: content.length,
			contentBytes: Buffer.byteLength(content, "utf8"),
		})),
		cached: false,
		requestedAt: new Date().toISOString(),
		billing,
	};
	const output = formatSearchForModel(details, response.results, config.search.maxModelBytes);
	assert.match(output, /Billed ¥0\.005/);
	assert.match(output, /https:\/\//);
});

test("real DeepSeek fetch returns Markdown content and a billable request", { skip: missingKey }, async () => {
	const search = await client!.search({ query: "DeepSeek official site", count: 1 });
	const url = search.response.results[0]?.url;
	assert.ok(url, "expected a URL to fetch");
	const startedAt = Date.now();
	const { response, durationMs } = await client!.fetch({ url });
	assert.equal(typeof response.title, "string");
	assert.equal(typeof response.content, "string");
	assert.ok(response.content.length > 0, "expected fetch content");
	const billing = fetchBilling(response.content.length, config.pricing.fetchCny, config.cnyPerUsd);
	assert.equal(billing.billed, true);
	const details: FetchToolDetails = {
		kind: "fetch",
		stage: "done",
		url,
		startedAt,
		durationMs,
		title: response.title,
		contentChars: response.content.length,
		contentBytes: Buffer.byteLength(response.content, "utf8"),
		contentLines: response.content.split("\n").length,
		preview: response.content.slice(0, 1_000),
		cached: false,
		requestedAt: new Date().toISOString(),
		billing,
	};
	const output = formatFetchForModel(details, response, config.fetch.maxModelBytes);
	assert.match(output, /Billed ¥0\.005/);
	assert.match(output, /URL: https?:\/\//);
});
