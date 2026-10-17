import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekApiError, validateFetchResponse, validateSearchResponse } from "../src/api.ts";

const validResult = {
	rerank_score: 2.4,
	title: "DeepSeek V4 model released",
	url: "https://example.com/deepseek-v4",
	snippet: "DeepSeek V4 is now available.",
	summary: "DeepSeek released the V4 model.",
	content: "DeepSeek V4 is now generally available...",
	site_name: "Example News",
	site_icon: "https://example.com/favicon.ico",
	date: "2026-06-01T00:00:00+00:00",
	authority: 3,
};

test("search response validation preserves all documented fields", () => {
	const response = validateSearchResponse({ results: [validResult] });
	assert.deepEqual(response.results[0], validResult);
});

test("search response validation accepts nullable site and date fields", () => {
	const response = validateSearchResponse({
		results: [{ ...validResult, site_name: null, site_icon: null, date: null, authority: -1 }],
	});
	assert.equal(response.results[0]?.site_name, null);
	assert.equal(response.results[0]?.date, null);
	assert.equal(response.results[0]?.authority, -1);
});

test("search response validation rejects missing and malformed fields", () => {
	assert.throws(() => validateSearchResponse({}), /results array/);
	assert.throws(() => validateSearchResponse({ results: [{}] }), /rerank_score/);
	assert.throws(
		() => validateSearchResponse({ results: [{ ...validResult, title: 42 }] }),
		/title must be a string/,
	);
	assert.throws(
		() => validateSearchResponse({ results: [{ ...validResult, authority: "3" }] }),
		/authority must be a finite number/,
	);
});

test("fetch response validation requires title and content strings", () => {
	assert.deepEqual(validateFetchResponse({ title: "Example", content: "# Example\n\nBody." }), {
		title: "Example",
		content: "# Example\n\nBody.",
	});
	assert.throws(() => validateFetchResponse({ title: "Example" }), /content must be a string/);
	assert.throws(() => validateFetchResponse([]), /must be an object/);
});

test("DeepSeekApiError classifies retryable status codes", () => {
	assert.equal(new DeepSeekApiError("rate limited", { status: 429 }).retryable, true);
	assert.equal(new DeepSeekApiError("server error", { status: 503 }).retryable, true);
	assert.equal(new DeepSeekApiError("timeout", { status: 408 }).retryable, true);
	assert.equal(new DeepSeekApiError("bad request", { status: 400 }).retryable, false);
	assert.equal(new DeepSeekApiError("unauthorized", { status: 401 }).retryable, false);
	assert.equal(new DeepSeekApiError("network", {}).retryable, true);
});
