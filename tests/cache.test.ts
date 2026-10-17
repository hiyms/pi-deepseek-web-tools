import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
	buildPreview,
	fetchCacheKey,
	sanitizeUrlForFileName,
	searchCacheKey,
	SessionCache,
	truncateUtf8,
	writeFetchCacheFile,
} from "../src/cache.ts";

test("session cache honors TTL, LRU order, and the entry limit", () => {
	const cache = new SessionCache<string>(1_000, 2);
	cache.set("a", "A", 0);
	cache.set("b", "B", 0);
	assert.equal(cache.get("a", 500), "A");
	cache.set("c", "C", 600);
	assert.equal(cache.get("b", 700), undefined);
	assert.equal(cache.get("a", 700), "A");
	assert.equal(cache.get("c", 700), "C");
	assert.equal(cache.get("a", 1_500), undefined);
});

test("session cache with zero TTL stores nothing", () => {
	const cache = new SessionCache<string>(0, 10);
	cache.set("a", "A", 0);
	assert.equal(cache.get("a", 0), undefined);
	assert.equal(cache.size, 0);
});

test("cache keys distinguish request parameters", () => {
	const base = { query: "DeepSeek", count: 5 };
	assert.notEqual(searchCacheKey(base), searchCacheKey({ ...base, count: 6 }));
	assert.notEqual(searchCacheKey(base), searchCacheKey({ ...base, need_content: true }));
	assert.notEqual(searchCacheKey(base), searchCacheKey({ ...base, ori_question: "question" }));
	assert.notEqual(fetchCacheKey("https://example.com/a"), fetchCacheKey("https://example.com/b"));
});

test("truncateUtf8 never splits a multi-byte character", () => {
	const chinese = truncateUtf8("你好世界", 4);
	assert.equal(chinese.text, "你");
	assert.equal(chinese.bytes, 12);
	assert.equal(chinese.truncated, true);

	const emoji = truncateUtf8("a😀b", 2);
	assert.equal(emoji.text, "a");
	assert.equal(emoji.bytes, 6);
	assert.equal(emoji.truncated, true);

	const complete = truncateUtf8("hello", 5);
	assert.equal(complete.text, "hello");
	assert.equal(complete.truncated, false);
});

test("buildPreview counts code points instead of UTF-16 units", () => {
	assert.equal(buildPreview("你好世界", 2), "你好");
	assert.equal(buildPreview("a😀b", 2), "a😀");
	assert.equal(buildPreview("short", 100), "short");
	assert.equal(buildPreview("short", 0), "");
});

test("sanitizeUrlForFileName produces a readable file stem", () => {
	assert.equal(sanitizeUrlForFileName("https://www.example.com/a/b?q=1"), "www-example-com-a-b");
	assert.equal(sanitizeUrlForFileName("https://example.com/"), "example-com");
});

test("writeFetchCacheFile writes the complete content to the agent cache", async () => {
	await mkdir(join(process.cwd(), ".scratch"), { recursive: true });
	const dir = await mkdtemp(join(process.cwd(), ".scratch", "fetch-cache-"));
	try {
		const content = "# 标题\n\n正文内容\n";
		const file = await writeFetchCacheFile(dir, "https://example.com/article", content, new Date("2026-10-17T10:30:00Z"));
		assert.match(file.path, /20261017T103000-example-com-article-[0-9a-f]{10}\.md$/);
		assert.equal(file.bytes, Buffer.byteLength(content, "utf8"));
		assert.equal(file.lines, 4);
		assert.equal(await readFile(file.path, "utf8"), content);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
