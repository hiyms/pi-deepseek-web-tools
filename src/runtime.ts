import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { SessionCache } from "./cache.ts";
import { loadConfig, type DeepSeekWebToolsConfig } from "./config.ts";
import { createEmptyLedger, ledgerFromEntries, type UsageLedger } from "./usage.ts";
import type { CachedFetch, CachedSearch } from "./types.ts";

export interface RuntimeCaches {
	search: SessionCache<CachedSearch>;
	fetch: SessionCache<CachedFetch>;
}

export interface RuntimeState {
	agentDir: string;
	config: DeepSeekWebToolsConfig;
	caches: RuntimeCaches;
	ledger: UsageLedger;
}

export function createCaches(config: DeepSeekWebToolsConfig): RuntimeCaches {
	return {
		search: new SessionCache<CachedSearch>(
			config.cache.enabled ? config.cache.ttlMs : 0,
			config.cache.maxEntries,
			config.cache.maxBytes,
			(entry) => Buffer.byteLength(JSON.stringify(entry.response), "utf8"),
		),
		fetch: new SessionCache<CachedFetch>(
			config.cache.enabled ? config.cache.ttlMs : 0,
			config.cache.maxEntries,
			config.cache.maxBytes,
			(entry) => entry.contentBytes + 1_024,
		),
	};
}

export function createRuntime(agentDir: string): RuntimeState {
	const config = loadConfig(agentDir);
	return {
		agentDir,
		config,
		caches: createCaches(config),
		ledger: createEmptyLedger(),
	};
}

export function resetRuntime(state: RuntimeState, entries: readonly SessionEntry[], resetCaches = true): void {
	state.config = loadConfig(state.agentDir);
	if (resetCaches) state.caches = createCaches(state.config);
	state.ledger = ledgerFromEntries(entries);
}
