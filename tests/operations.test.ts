import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { validateFetchInput, validateSearchInput } from "../src/operations.ts";

test("search input applies configured defaults", () => {
	const request = validateSearchInput({ query: "  DeepSeek V4  " }, DEFAULT_CONFIG);
	assert.deepEqual(request, {
		query: "DeepSeek V4",
		count: 10,
		need_content: false,
	});
});

test("search input carries optional parameters", () => {
	const request = validateSearchInput(
		{
			query: "DeepSeek site:github.com",
			count: 5,
			ori_question: "What is new?",
			localization: "1.1.1.1",
			need_content: true,
		},
		DEFAULT_CONFIG,
	);
	assert.equal(request.count, 5);
	assert.equal(request.ori_question, "What is new?");
	assert.equal(request.localization, "1.1.1.1");
	assert.equal(request.need_content, true);
});

test("search input rejects blank, oversized, and out-of-range values", () => {
	assert.throws(() => validateSearchInput({ query: "   " }, DEFAULT_CONFIG), /must not be blank/);
	assert.throws(() => validateSearchInput({ query: "x".repeat(129) }, DEFAULT_CONFIG), /128/);
	assert.throws(() => validateSearchInput({ query: "x", count: 0 }, DEFAULT_CONFIG), /count/);
	assert.throws(() => validateSearchInput({ query: "x", count: 51 }, DEFAULT_CONFIG), /count/);
	assert.throws(() => validateSearchInput({ query: "x", count: 1.5 }, DEFAULT_CONFIG), /count/);
	assert.throws(
		() => validateSearchInput({ query: "x", ori_question: "q".repeat(129) }, DEFAULT_CONFIG),
		/ori_question/,
	);
});

test("search input counts Unicode code points for the 128 character limit", () => {
	assert.doesNotThrow(() => validateSearchInput({ query: "😀".repeat(128) }, DEFAULT_CONFIG));
	assert.throws(() => validateSearchInput({ query: "😀".repeat(129) }, DEFAULT_CONFIG), /128/);
});

test("fetch input accepts absolute HTTP and HTTPS URLs", () => {
	assert.equal(validateFetchInput({ url: " https://example.com/article " }), "https://example.com/article");
	assert.equal(validateFetchInput({ url: "http://example.com/" }), "http://example.com/");
});

test("fetch input rejects unsafe and malformed URLs", () => {
	assert.throws(() => validateFetchInput({ url: "   " }), /must not be empty/);
	assert.throws(() => validateFetchInput({ url: "example.com" }), /absolute HTTP\/HTTPS URL/);
	assert.throws(() => validateFetchInput({ url: "file:///etc/passwd" }), /http or https/);
	assert.throws(() => validateFetchInput({ url: "https://user:pass@example.com/" }), /credentials/);
	assert.throws(() => validateFetchInput({ url: `https://example.com/${"a".repeat(8200)}` }), /8192/);
});
