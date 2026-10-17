import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { FETCH_PRICE_CNY, SEARCH_PRICE_CNY, type FetchToolDetails, type SearchToolDetails } from "./types.ts";

export interface DeepSeekWebToolsConfig {
	provider: string;
	baseUrl: string;
	timeoutMs: number;
	maxRetries: number;
	qps: number;
	cnyPerUsd: number;
	showStatus: boolean;
	pricing: {
		searchCny: number;
		fetchCny: number;
	};
	cache: {
		enabled: boolean;
		ttlMs: number;
		maxEntries: number;
		maxBytes: number;
	};
	search: {
		count: number;
		needContent: boolean;
		localization: string;
		maxModelBytes: number;
	};
	fetch: {
		maxModelBytes: number;
		previewChars: number;
	};
}

export const CONFIG_FILE_NAME = "deepseek-web-tools.json";

export const DEFAULT_CONFIG: DeepSeekWebToolsConfig = {
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	timeoutMs: 90_000,
	maxRetries: 2,
	qps: 5,
	cnyPerUsd: 7.2,
	showStatus: true,
	pricing: {
		searchCny: SEARCH_PRICE_CNY,
		fetchCny: FETCH_PRICE_CNY,
	},
	cache: {
		enabled: true,
		ttlMs: 10 * 60 * 1000,
		maxEntries: 100,
		maxBytes: 32 * 1024 * 1024,
	},
	search: {
		count: 10,
		needContent: false,
		localization: "",
		maxModelBytes: 48 * 1024,
	},
	fetch: {
		maxModelBytes: 48 * 1024,
		previewChars: 4_000,
	},
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(source: string, path: string, message: string): never {
	throw new Error(`Invalid ${source} at ${path}: ${message}`);
}

function readString(value: unknown, source: string, path: string): string {
	if (typeof value !== "string") fail(source, path, "expected a string");
	return value;
}

function readNumber(value: unknown, source: string, path: string, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) fail(source, path, "expected a finite number");
	if (value < min || value > max) fail(source, path, `expected a number between ${min} and ${max}`);
	return value;
}

function readInteger(value: unknown, source: string, path: string, min: number, max: number): number {
	const number = readNumber(value, source, path, min, max);
	if (!Number.isInteger(number)) fail(source, path, "expected an integer");
	return number;
}

function readBoolean(value: unknown, source: string, path: string): boolean {
	if (typeof value === "boolean") return value;
	if (value === "true" || value === "1") return true;
	if (value === "false" || value === "0") return false;
	fail(source, path, "expected a boolean");
}

function readEnvInteger(value: string, source: string, path: string, min: number, max: number): number {
	const number = Number(value);
	if (!Number.isFinite(number)) fail(source, path, "expected a finite number");
	if (!Number.isInteger(number)) fail(source, path, "expected an integer");
	if (number < min || number > max) fail(source, path, `expected a number between ${min} and ${max}`);
	return number;
}

function readEnvNumber(value: string, source: string, path: string, min: number, max: number): number {
	const number = Number(value);
	if (!Number.isFinite(number)) fail(source, path, "expected a finite number");
	if (number < min || number > max) fail(source, path, `expected a number between ${min} and ${max}`);
	return number;
}

function readSection(value: unknown, source: string, path: string): UnknownRecord {
	if (!isRecord(value)) fail(source, path, "expected an object");
	return value;
}

function applySection(
	config: DeepSeekWebToolsConfig,
	input: UnknownRecord,
	source: string,
	prefix: string,
): void {
	if ("provider" in input) config.provider = readString(input.provider, source, `${prefix}provider`);
	if ("baseUrl" in input) config.baseUrl = readString(input.baseUrl, source, `${prefix}baseUrl`);
	if ("timeoutMs" in input)
		config.timeoutMs = readInteger(input.timeoutMs, source, `${prefix}timeoutMs`, 1_000, 600_000);
	if ("maxRetries" in input)
		config.maxRetries = readInteger(input.maxRetries, source, `${prefix}maxRetries`, 0, 5);
	if ("qps" in input) config.qps = readInteger(input.qps, source, `${prefix}qps`, 1, 50);
	if ("cnyPerUsd" in input)
		config.cnyPerUsd = readNumber(input.cnyPerUsd, source, `${prefix}cnyPerUsd`, 0.01, 100);
	if ("showStatus" in input) config.showStatus = readBoolean(input.showStatus, source, `${prefix}showStatus`);

	if ("pricing" in input) {
		const pricing = readSection(input.pricing, source, `${prefix}pricing`);
		if ("searchCny" in pricing)
			config.pricing.searchCny = readNumber(pricing.searchCny, source, `${prefix}pricing.searchCny`, 0, 1_000);
		if ("fetchCny" in pricing)
			config.pricing.fetchCny = readNumber(pricing.fetchCny, source, `${prefix}pricing.fetchCny`, 0, 1_000);
	}

	if ("cache" in input) {
		const cache = readSection(input.cache, source, `${prefix}cache`);
		if ("enabled" in cache) config.cache.enabled = readBoolean(cache.enabled, source, `${prefix}cache.enabled`);
		if ("ttlMs" in cache)
			config.cache.ttlMs = readInteger(cache.ttlMs, source, `${prefix}cache.ttlMs`, 0, 24 * 60 * 60 * 1000);
		if ("maxEntries" in cache)
			config.cache.maxEntries = readInteger(cache.maxEntries, source, `${prefix}cache.maxEntries`, 1, 5_000);
		if ("maxBytes" in cache)
			config.cache.maxBytes = readInteger(
				cache.maxBytes,
				source,
				`${prefix}cache.maxBytes`,
				1_024,
				1024 * 1024 * 1024,
			);
	}

	if ("search" in input) {
		const search = readSection(input.search, source, `${prefix}search`);
		if ("count" in search) config.search.count = readInteger(search.count, source, `${prefix}search.count`, 1, 50);
		if ("needContent" in search)
			config.search.needContent = readBoolean(search.needContent, source, `${prefix}search.needContent`);
		if ("localization" in search)
			config.search.localization = readString(search.localization, source, `${prefix}search.localization`);
		if ("maxModelBytes" in search)
			config.search.maxModelBytes = readInteger(
				search.maxModelBytes,
				source,
				`${prefix}search.maxModelBytes`,
				1_024,
				10 * 1024 * 1024,
			);
	}

	if ("fetch" in input) {
		const fetch = readSection(input.fetch, source, `${prefix}fetch`);
		if ("maxModelBytes" in fetch)
			config.fetch.maxModelBytes = readInteger(
				fetch.maxModelBytes,
				source,
				`${prefix}fetch.maxModelBytes`,
				1_024,
				10 * 1024 * 1024,
			);
		if ("previewChars" in fetch)
			config.fetch.previewChars = readInteger(
				fetch.previewChars,
				source,
				`${prefix}fetch.previewChars`,
				200,
				200_000,
			);
	}
}

function cloneConfig(config: DeepSeekWebToolsConfig): DeepSeekWebToolsConfig {
	return {
		...config,
		pricing: { ...config.pricing },
		cache: { ...config.cache },
		search: { ...config.search },
		fetch: { ...config.fetch },
	};
}

export function resolveConfigPath(agentDir: string, env: NodeJS.ProcessEnv = process.env): string {
	const override = env.DEEPSEEK_WEB_TOOLS_CONFIG;
	if (!override) return join(agentDir, CONFIG_FILE_NAME);
	return isAbsolute(override) ? override : resolve(process.cwd(), override);
}

export function loadConfig(agentDir: string, env: NodeJS.ProcessEnv = process.env): DeepSeekWebToolsConfig {
	const config = cloneConfig(DEFAULT_CONFIG);
	const path = resolveConfigPath(agentDir, env);

	if (existsSync(path)) {
		const raw = readFileSync(path, "utf8");
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(`Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
		}
		applySection(config, readSection(parsed, path, "root"), path, "");
	}

	if (env.DEEPSEEK_WEB_TOOLS_PROVIDER) config.provider = env.DEEPSEEK_WEB_TOOLS_PROVIDER;
	if (env.DEEPSEEK_WEB_TOOLS_BASE_URL) config.baseUrl = env.DEEPSEEK_WEB_TOOLS_BASE_URL;
	if (env.DEEPSEEK_WEB_TOOLS_TIMEOUT_MS)
		config.timeoutMs = readEnvInteger(env.DEEPSEEK_WEB_TOOLS_TIMEOUT_MS, "environment", "DEEPSEEK_WEB_TOOLS_TIMEOUT_MS", 1_000, 600_000);
	if (env.DEEPSEEK_WEB_TOOLS_QPS)
		config.qps = readEnvInteger(env.DEEPSEEK_WEB_TOOLS_QPS, "environment", "DEEPSEEK_WEB_TOOLS_QPS", 1, 50);
	if (env.DEEPSEEK_WEB_TOOLS_CNY_PER_USD)
		config.cnyPerUsd = readEnvNumber(env.DEEPSEEK_WEB_TOOLS_CNY_PER_USD, "environment", "DEEPSEEK_WEB_TOOLS_CNY_PER_USD", 0.01, 100);
	if (env.DEEPSEEK_WEB_TOOLS_CACHE_ENABLED)
		config.cache.enabled = readBoolean(env.DEEPSEEK_WEB_TOOLS_CACHE_ENABLED, "environment", "DEEPSEEK_WEB_TOOLS_CACHE_ENABLED");
	if (env.DEEPSEEK_WEB_TOOLS_CACHE_TTL_MS)
		config.cache.ttlMs = readEnvInteger(env.DEEPSEEK_WEB_TOOLS_CACHE_TTL_MS, "environment", "DEEPSEEK_WEB_TOOLS_CACHE_TTL_MS", 0, 24 * 60 * 60 * 1000);
	if (env.DEEPSEEK_WEB_TOOLS_CACHE_MAX_BYTES)
		config.cache.maxBytes = readEnvInteger(
			env.DEEPSEEK_WEB_TOOLS_CACHE_MAX_BYTES,
			"environment",
			"DEEPSEEK_WEB_TOOLS_CACHE_MAX_BYTES",
			1_024,
			1024 * 1024 * 1024,
		);
	if (env.DEEPSEEK_WEB_TOOLS_SEARCH_MAX_BYTES)
		config.search.maxModelBytes = readEnvInteger(
			env.DEEPSEEK_WEB_TOOLS_SEARCH_MAX_BYTES,
			"environment",
			"DEEPSEEK_WEB_TOOLS_SEARCH_MAX_BYTES",
			1_024,
			10 * 1024 * 1024,
		);

	config.baseUrl = config.baseUrl.replace(/\/+$/, "");
	return config;
}

export function toolDetailsFromUnknown(value: unknown): SearchToolDetails | FetchToolDetails | undefined {
	if (!isRecord(value)) return undefined;
	if (value.kind === "search" && typeof value.query === "string" && Array.isArray(value.results)) {
		return value as unknown as SearchToolDetails;
	}
	if (value.kind === "fetch" && typeof value.url === "string") {
		return value as unknown as FetchToolDetails;
	}
	return undefined;
}
