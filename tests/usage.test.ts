import assert from "node:assert/strict";
import test from "node:test";
import {
	addBillingToLedger,
	addCachedToLedger,
	createBilling,
	createEmptyLedger,
	createUsage,
	fetchBilling,
	formatCny,
	formatLedgerSummary,
	ledgerFromEntries,
	searchBilling,
} from "../src/usage.ts";
import { COMMAND_USAGE_ENTRY_TYPE, FETCH_TOOL_NAME, SEARCH_TOOL_NAME, type BillingDetails } from "../src/types.ts";

const RATE = 7.2;

function billedSearch(): BillingDetails {
	return {
		billed: true,
		cny: 0.005,
		usd: 0.005 / RATE,
		cnyPerUsd: RATE,
	};
}

function billedFetch(): BillingDetails {
	return {
		billed: true,
		cny: 0.005,
		usd: 0.005 / RATE,
		cnyPerUsd: RATE,
	};
}

function searchDetails(cached: boolean, billing: BillingDetails) {
	return {
		kind: "search",
		stage: "done",
		query: "DeepSeek V4",
		count: 5,
		needContent: false,
		startedAt: 0,
		results: [],
		cached,
		billing,
	};
}

function fetchDetails(cached: boolean, billing: BillingDetails) {
	return {
		kind: "fetch",
		stage: "done",
		url: "https://example.com/article",
		startedAt: 0,
		cached,
		billing,
	};
}

test("search billing charges only when results exist", () => {
	assert.equal(searchBilling(3, 0.005, RATE).billed, true);
	assert.equal(searchBilling(3, 0.005, RATE).cny, 0.005);
	assert.equal(searchBilling(0, 0.005, RATE).billed, false);
	assert.equal(searchBilling(0, 0.005, RATE).cny, 0);
	assert.equal(searchBilling(0, 0.005, RATE).reason, "no-results");
});

test("fetch billing charges only when content exists", () => {
	assert.equal(fetchBilling(42, 0.005, RATE).billed, true);
	assert.equal(fetchBilling(42, 0.005, RATE).cny, 0.005);
	assert.equal(fetchBilling(0, 0.005, RATE).billed, false);
	assert.equal(fetchBilling(0, 0.005, RATE).reason, "empty-content");
});

test("usage carries the converted USD cost in cost.total", () => {
	const billing = createBilling(0.005, RATE, true);
	const usage = createUsage(billing);
	assert.equal(usage.cost.total, 0.005 / RATE);
	assert.equal(usage.input, 0);
	assert.equal(usage.output, 0);
	assert.equal(usage.totalTokens, 0);
});

test("createBilling validates the exchange rate", () => {
	assert.throws(() => createBilling(0.005, 0, true), /cnyPerUsd/);
	assert.throws(() => createBilling(0.005, Number.NaN, true), /cnyPerUsd/);
});

test("ledger reconstruction counts tool results from the session", () => {
	const ledger = ledgerFromEntries([
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: SEARCH_TOOL_NAME,
				details: searchDetails(false, billedSearch()),
			},
		},
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: FETCH_TOOL_NAME,
				details: fetchDetails(false, billedFetch()),
			},
		},
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: SEARCH_TOOL_NAME,
				details: searchDetails(true, createBilling(0, RATE, false)),
			},
		},
		{
			type: "message",
			message: {
				role: "assistant",
				details: searchDetails(false, billedSearch()),
			},
		},
	]);
	assert.deepEqual(ledger.search, { calls: 2, billed: 1, cached: 1 });
	assert.deepEqual(ledger.fetch, { calls: 1, billed: 1, cached: 0 });
	assert.equal(ledger.cny, 0.01);
	assert.equal(ledger.usd, 0.01 / RATE);
});

test("custom command usage entries are counted", () => {
	const ledger = ledgerFromEntries([
		{
			type: "custom",
			customType: COMMAND_USAGE_ENTRY_TYPE,
			data: { kind: "search", cached: false, billing: billedSearch() },
		},
		{
			type: "custom",
			customType: COMMAND_USAGE_ENTRY_TYPE,
			data: { kind: "fetch", cached: true },
		},
		{
			type: "custom",
			customType: "other-extension",
			data: { kind: "search", cached: false, billing: billedSearch() },
		},
	]);
	assert.deepEqual(ledger.search, { calls: 1, billed: 1, cached: 0 });
	assert.deepEqual(ledger.fetch, { calls: 1, billed: 0, cached: 1 });
	assert.equal(ledger.cny, 0.005);
});

test("ledger ignores unrelated tools and malformed details", () => {
	const ledger = ledgerFromEntries([
		{ type: "message", message: { role: "toolResult", toolName: "read", details: { kind: "read" } } },
		{ type: "message", message: { role: "toolResult", toolName: SEARCH_TOOL_NAME, details: { kind: "search" } } },
		{ type: "message", message: { role: "toolResult", toolName: FETCH_TOOL_NAME, details: null } },
	]);
	assert.deepEqual(ledger, createEmptyLedger());
});

test("ledger helpers separate billed and cached calls", () => {
	const ledger = createEmptyLedger();
	addBillingToLedger(ledger, "search", billedSearch());
	addCachedToLedger(ledger, "search");
	addCachedToLedger(ledger, "fetch");
	assert.deepEqual(ledger.search, { calls: 2, billed: 1, cached: 1 });
	assert.deepEqual(ledger.fetch, { calls: 1, billed: 0, cached: 1 });
	assert.equal(formatLedgerSummary(ledger), "2 search 1 cached · 1 fetch 1 cached · ¥0.005");
	assert.equal(formatCny(0.015), "¥0.015");
});

test("ledger summary omits endpoints without calls", () => {
	assert.equal(formatLedgerSummary(createEmptyLedger()), "¥0.000");
});
