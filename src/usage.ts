import type { Usage } from "@earendil-works/pi-ai";
import { toolDetailsFromUnknown } from "./config.ts";
import {
	COMMAND_USAGE_ENTRY_TYPE,
	FETCH_TOOL_NAME,
	SEARCH_TOOL_NAME,
	type BillingDetails,
} from "./types.ts";

type EntryLike = {
	type: string;
	customType?: string;
	data?: unknown;
	message?: {
		role?: string;
		toolName?: string;
		details?: unknown;
	};
};

export interface EndpointLedger {
	calls: number;
	billed: number;
	cached: number;
}

export interface UsageLedger {
	search: EndpointLedger;
	fetch: EndpointLedger;
	cny: number;
	usd: number;
}

export function createEmptyLedger(): UsageLedger {
	return {
		search: { calls: 0, billed: 0, cached: 0 },
		fetch: { calls: 0, billed: 0, cached: 0 },
		cny: 0,
		usd: 0,
	};
}

export function cnyToUsd(cny: number, cnyPerUsd: number): number {
	if (!Number.isFinite(cny) || !Number.isFinite(cnyPerUsd) || cnyPerUsd <= 0) {
		throw new Error(`Cannot convert CNY to USD with cnyPerUsd=${cnyPerUsd}`);
	}
	return cny / cnyPerUsd;
}

export function createBilling(
	priceCny: number,
	cnyPerUsd: number,
	billed: boolean,
	reason?: BillingDetails["reason"],
): BillingDetails {
	const cny = billed ? priceCny : 0;
	return {
		billed,
		cny,
		usd: cnyToUsd(cny, cnyPerUsd),
		cnyPerUsd,
		...(reason ? { reason } : {}),
	};
}

export function createUsage(billing: BillingDetails): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: billing.usd,
		},
	};
}

export function searchBilling(resultCount: number, priceCny: number, cnyPerUsd: number): BillingDetails {
	return createBilling(priceCny, cnyPerUsd, resultCount > 0, resultCount > 0 ? undefined : "no-results");
}

export function fetchBilling(contentChars: number, priceCny: number, cnyPerUsd: number): BillingDetails {
	return createBilling(priceCny, cnyPerUsd, contentChars > 0, contentChars > 0 ? undefined : "empty-content");
}

export function addBillingToLedger(ledger: UsageLedger, kind: "search" | "fetch", billing: BillingDetails): void {
	ledger[kind].calls++;
	if (billing.billed) {
		ledger[kind].billed++;
		ledger.cny += billing.cny;
		ledger.usd += billing.usd;
	}
}

export function addCachedToLedger(ledger: UsageLedger, kind: "search" | "fetch"): void {
	ledger[kind].calls++;
	ledger[kind].cached++;
}

export function addFailedToLedger(ledger: UsageLedger, kind: "search" | "fetch"): void {
	ledger[kind].calls++;
}

export function ledgerFromEntries(entries: readonly EntryLike[]): UsageLedger {
	const ledger = createEmptyLedger();
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === COMMAND_USAGE_ENTRY_TYPE) {
			addCommandUsageEntry(ledger, entry.data);
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (!message || message.role !== "toolResult") continue;
		if (message.toolName !== SEARCH_TOOL_NAME && message.toolName !== FETCH_TOOL_NAME) continue;
		const details = toolDetailsFromUnknown(message.details);
		if (!details) continue;
		const kind = details.kind;
		ledger[kind].calls++;
		if (details.cached) {
			ledger[kind].cached++;
			continue;
		}
		if (details.billing?.billed) {
			ledger[kind].billed++;
			ledger.cny += details.billing.cny;
			ledger.usd += details.billing.usd;
		}
	}
	return ledger;
}

function addCommandUsageEntry(ledger: UsageLedger, data: unknown): void {
	if (typeof data !== "object" || data === null) return;
	const record = data as { kind?: unknown; cached?: unknown; billing?: unknown };
	if (record.kind !== "search" && record.kind !== "fetch") return;
	const kind = record.kind;
	ledger[kind].calls++;
	if (record.cached === true) {
		ledger[kind].cached++;
		return;
	}
	const billing = record.billing;
	if (typeof billing !== "object" || billing === null) return;
	const details = billing as { billed?: unknown; cny?: unknown; usd?: unknown };
	if (details.billed !== true) return;
	if (typeof details.cny !== "number" || typeof details.usd !== "number") return;
	ledger[kind].billed++;
	ledger.cny += details.cny;
	ledger.usd += details.usd;
}

export function formatCny(cny: number): string {
	return `¥${cny.toFixed(3)}`;
}

export function formatUsd(usd: number): string {
	return `$${usd.toFixed(3)}`;
}

export function formatDuration(ms: number): string {
	if (ms < 1_000) return `${Math.round(ms)}ms`;
	return `${(ms / 1_000).toFixed(2)}s`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1_024) return `${bytes} B`;
	if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
	return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function formatLedgerSummary(ledger: UsageLedger): string {
	const parts: string[] = [];
	if (ledger.search.calls > 0) {
		const searchParts = [`${ledger.search.calls} search`];
		if (ledger.search.cached > 0) searchParts.push(`${ledger.search.cached} cached`);
		parts.push(searchParts.join(" "));
	}
	if (ledger.fetch.calls > 0) {
		const fetchParts = [`${ledger.fetch.calls} fetch`];
		if (ledger.fetch.cached > 0) fetchParts.push(`${ledger.fetch.cached} cached`);
		parts.push(fetchParts.join(" "));
	}
	parts.push(formatCny(ledger.cny));
	return parts.join(" · ");
}
