import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { CONFIG_FILE_NAME, DEFAULT_CONFIG, loadConfig, resolveConfigPath } from "../src/config.ts";

async function scratchDir(): Promise<string> {
	await mkdir(join(process.cwd(), ".scratch"), { recursive: true });
	return mkdtemp(join(process.cwd(), ".scratch", "config-"));
}

test("defaults are returned when no config file exists", async () => {
	const dir = await scratchDir();
	try {
		const config = loadConfig(dir, {});
		assert.deepEqual(config, DEFAULT_CONFIG);
		assert.equal(resolveConfigPath(dir, {}), join(dir, CONFIG_FILE_NAME));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a config file overrides nested defaults", async () => {
	const dir = await scratchDir();
	try {
		await writeFile(
			join(dir, CONFIG_FILE_NAME),
			JSON.stringify({
				cnyPerUsd: 7.1,
				cache: { enabled: false, ttlMs: 5_000 },
				search: { count: 17, needContent: true, localization: "1.1.1.1" },
				fetch: { maxModelBytes: 8_192 },
			}),
		);
		const config = loadConfig(dir, {});
		assert.equal(config.cnyPerUsd, 7.1);
		assert.equal(config.cache.enabled, false);
		assert.equal(config.cache.ttlMs, 5_000);
		assert.equal(config.cache.maxEntries, DEFAULT_CONFIG.cache.maxEntries);
		assert.equal(config.search.count, 17);
		assert.equal(config.search.needContent, true);
		assert.equal(config.search.localization, "1.1.1.1");
		assert.equal(config.fetch.maxModelBytes, 8_192);
		assert.equal(config.fetch.previewChars, DEFAULT_CONFIG.fetch.previewChars);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("environment variables override the file and defaults", async () => {
	const dir = await scratchDir();
	try {
		const config = loadConfig(dir, {
			DEEPSEEK_WEB_TOOLS_PROVIDER: "deepseek-alt",
			DEEPSEEK_WEB_TOOLS_BASE_URL: "https://api.example.com/",
			DEEPSEEK_WEB_TOOLS_QPS: "3",
			DEEPSEEK_WEB_TOOLS_CNY_PER_USD: "7.05",
			DEEPSEEK_WEB_TOOLS_CACHE_ENABLED: "false",
			DEEPSEEK_WEB_TOOLS_CACHE_TTL_MS: "1000",
			DEEPSEEK_WEB_TOOLS_SEARCH_MAX_BYTES: "4096",
		});
		assert.equal(config.provider, "deepseek-alt");
		assert.equal(config.baseUrl, "https://api.example.com");
		assert.equal(config.qps, 3);
		assert.equal(config.cnyPerUsd, 7.05);
		assert.equal(config.cache.enabled, false);
		assert.equal(config.cache.ttlMs, 1_000);
		assert.equal(config.search.maxModelBytes, 4_096);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("DEEPSEEK_WEB_TOOLS_CONFIG can point at another file", async () => {
	const dir = await scratchDir();
	try {
		const custom = join(dir, "custom.json");
		await writeFile(custom, JSON.stringify({ qps: 2 }));
		const config = loadConfig(dir, { DEEPSEEK_WEB_TOOLS_CONFIG: custom });
		assert.equal(config.qps, 2);
		assert.equal(resolveConfigPath(dir, { DEEPSEEK_WEB_TOOLS_CONFIG: custom }), custom);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("invalid config values are rejected with the key path", async () => {
	const dir = await scratchDir();
	try {
		await writeFile(join(dir, CONFIG_FILE_NAME), JSON.stringify({ search: { count: 0 } }));
		assert.throws(() => loadConfig(dir, {}), /search\.count/);
		await writeFile(join(dir, CONFIG_FILE_NAME), JSON.stringify({ cnyPerUsd: "7.2" }));
		assert.throws(() => loadConfig(dir, {}), /cnyPerUsd/);
		await writeFile(join(dir, CONFIG_FILE_NAME), "{ not json");
		assert.throws(() => loadConfig(dir, {}), /Cannot parse/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
