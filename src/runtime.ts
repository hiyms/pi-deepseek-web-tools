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
		search: new SessionCache<CachedSearch>(config.cache.enabled ? config.cache.ttlMs : 0, config.cache.maxEntries),
		fetch: new SessionCache<CachedFetch>(config.cache.enabled ? config.cache.ttlMs : 0, config.cache.maxEntries),
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

export function resetRuntime(state: RuntimeState, entries: readonly SessionEntry[]): void {
	state.config = loadConfig(state.agentDir);
	state.caches = createCaches(state.config);
	state.ledger = ledgerFromEntries(entries);
}
