import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DeepSeekApiError, DeepSeekClient } from "./api.ts";
import { buildPreview, searchCacheKey, fetchCacheKey, truncateUtf8, writeFetchCacheFile } from "./cache.ts";
import type { DeepSeekWebToolsConfig } from "./config.ts";
import { formatFetchForModel, formatSearchForModel } from "./format.ts";
import {
	addBillingToLedger,
	addCachedToLedger,
	addFailedToLedger,
	createBilling,
	createUsage,
	fetchBilling,
	searchBilling,
} from "./usage.ts";
import type { RuntimeState } from "./runtime.ts";
import {
	type CachedFetch,
	type CachedSearch,
	type BillingDetails,
	type FetchToolDetails,
	type SearchRequest,
	type SearchResponse,
	type SearchResultSummary,
	type SearchToolDetails,
	type ToolDetails,
	type ToolErrorDetails,
} from "./types.ts";

export interface OperationContext<TDetails extends ToolDetails = ToolDetails> {
	runtime: RuntimeState;
	ctx: ExtensionContext;
	signal?: AbortSignal;
	emit?: (details: TDetails) => void;
	onLedgerChange?: () => void;
}

export interface OperationResult<TDetails extends ToolDetails> {
	details: TDetails;
	content: string;
	usage?: Usage;
	isError: boolean;
}

export interface SearchInput {
	query: string;
	count?: number;
	ori_question?: string;
	localization?: string;
	need_content?: boolean;
}

export interface FetchInput {
	url: string;
}

function toToolError(error: unknown): ToolErrorDetails {
	if (error instanceof DeepSeekApiError) {
		return {
			message: error.message,
			...(error.status !== undefined ? { status: error.status } : {}),
			...(error.code !== undefined ? { code: error.code } : {}),
			...(error.type !== undefined ? { type: error.type } : {}),
			retryable: error.retryable,
		};
	}
	if (error instanceof Error) {
		const retryable = error.name === "AbortError" ? false : undefined;
		return { message: error.message, ...(retryable !== undefined ? { retryable } : {}) };
	}
	return { message: String(error) };
}

function summarizeResults(results: SearchResponse["results"]): SearchResultSummary[] {
	return results.map((result) => {
		const { content, ...rest } = result;
		return {
			...rest,
			contentChars: content.length,
			contentBytes: Buffer.byteLength(content, "utf8"),
		};
	});
}

async function resolveClient(runtime: RuntimeState, ctx: ExtensionContext): Promise<DeepSeekClient> {
	const apiKey = await ctx.modelRegistry.getApiKeyForProvider(runtime.config.provider);
	if (!apiKey) {
		throw new Error(
			`No API key found for provider "${runtime.config.provider}". Run /login and configure DeepSeek, or set DEEPSEEK_API_KEY.`,
		);
	}
	return new DeepSeekClient(runtime.config, apiKey);
}

export function validateSearchInput(input: SearchInput, config: DeepSeekWebToolsConfig): SearchRequest {
	const query = input.query.trim();
	if (query.length === 0) throw new Error("query must not be blank");
	if (Array.from(query).length > 128) throw new Error("query must be at most 128 Unicode characters");
	const count = input.count ?? config.search.count;
	if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("count must be an integer between 1 and 50");
	const oriQuestion = input.ori_question?.trim();
	if (oriQuestion !== undefined && Array.from(oriQuestion).length > 128) {
		throw new Error("ori_question must be at most 128 Unicode characters");
	}
	return {
		query,
		count,
		...(oriQuestion ? { ori_question: oriQuestion } : {}),
		...(input.localization ?? config.search.localization
			? { localization: input.localization ?? config.search.localization }
			: {}),
		need_content: input.need_content ?? config.search.needContent,
	};
}

export function validateFetchInput(input: FetchInput): string {
	const url = input.url.trim();
	if (url.length === 0) throw new Error("url must not be empty");
	if (url.length > 8192) throw new Error("url must be at most 8192 characters");
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("url must be an absolute HTTP/HTTPS URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("url must use http or https");
	}
	if (!parsed.hostname) throw new Error("url must include a host");
	if (parsed.username || parsed.password) throw new Error("url must not include credentials");
	return url;
}

function searchErrorDetails(
	input: SearchInput,
	config: DeepSeekWebToolsConfig,
	startedAt: number,
	error: unknown,
): SearchToolDetails {
	return {
		kind: "search",
		stage: "error",
		query: input.query,
		count: input.count ?? config.search.count,
		...(input.ori_question ? { oriQuestion: input.ori_question } : {}),
		needContent: input.need_content ?? config.search.needContent,
		startedAt,
		durationMs: Date.now() - startedAt,
		results: [],
		cached: false,
		error: toToolError(error),
	};
}

function fetchErrorDetails(input: FetchInput, startedAt: number, error: unknown): FetchToolDetails {
	return {
		kind: "fetch",
		stage: "error",
		url: input.url,
		startedAt,
		durationMs: Date.now() - startedAt,
		cached: false,
		error: toToolError(error),
	};
}

export async function runSearch(
	input: SearchInput,
	context: OperationContext<SearchToolDetails>,
): Promise<OperationResult<SearchToolDetails>> {
	const startedAt = Date.now();
	const config = context.runtime.config;
	let details: SearchToolDetails = {
		kind: "search",
		stage: "queued",
		query: input.query,
		count: input.count ?? config.search.count,
		...(input.ori_question ? { oriQuestion: input.ori_question } : {}),
		needContent: input.need_content ?? config.search.needContent,
		startedAt,
		results: [],
		cached: false,
	};

	const emit = (stage: SearchToolDetails["stage"], note?: string): void => {
		details = { ...details, stage, ...(note ? { note } : {}), durationMs: Date.now() - startedAt };
		context.emit?.(details);
	};
	const ticker = context.emit
		? setInterval(() => context.emit?.({ ...details, durationMs: Date.now() - startedAt }), 250)
		: undefined;
	let billing: BillingDetails | undefined;
	let ledgerRecorded = false;

	try {
		const request = validateSearchInput(input, config);
		details = {
			...details,
			query: request.query,
			count: request.count ?? config.search.count,
			...(request.ori_question ? { oriQuestion: request.ori_question } : {}),
			...(request.localization ? { localization: request.localization } : {}),
			needContent: request.need_content ?? config.search.needContent,
		};
		emit("queued");
		const cacheKey = searchCacheKey(request);
		const cached = context.runtime.caches.search.get(cacheKey);
		if (cached) {
			details = {
				...details,
				stage: "cache-hit",
				cached: true,
				requestedAt: cached.requestedAt,
				results: summarizeResults(cached.response.results),
				durationMs: Date.now() - startedAt,
				billing: createBilling(0, config.cnyPerUsd, false),
				note: undefined,
			};
			addCachedToLedger(context.runtime.ledger, "search");
			ledgerRecorded = true;
			context.onLedgerChange?.();
			const content = formatSearchForModel(details, cached.response.results, config.search.maxModelBytes);
			return { details, content, isError: false };
		}

		const client = await resolveClient(context.runtime, context.ctx);
		emit("requesting", `POST ${config.baseUrl}/v1/tools/search`);
		const { response, durationMs } = await client.search(request as unknown as Record<string, unknown>, {
			signal: context.signal ?? context.ctx.signal,
			onRetry: (info) => {
				emit("requesting", `Retrying after ${info.waitMs}ms (attempt ${info.attempt}${info.status ? `, HTTP ${info.status}` : ""}): ${info.message}`);
			},
		});
		const requestedAt = new Date().toISOString();
		billing = searchBilling(response.results.length, config.pricing.searchCny, config.cnyPerUsd);
		details = {
			...details,
			stage: "done",
			durationMs,
			requestedAt,
			results: summarizeResults(response.results),
			billing,
			note: undefined,
		};
		context.runtime.caches.search.set(cacheKey, { response, requestedAt } satisfies CachedSearch);
		addBillingToLedger(context.runtime.ledger, "search", billing);
		ledgerRecorded = true;
		context.onLedgerChange?.();
		const content = formatSearchForModel(details, response.results, config.search.maxModelBytes);
		return { details, content, ...(billing.billed ? { usage: createUsage(billing) } : {}), isError: false };
	} catch (error) {
		if (!billing && error instanceof DeepSeekApiError && error.billable) {
			billing = searchBilling(1, config.pricing.searchCny, config.cnyPerUsd);
		}
		details = { ...searchErrorDetails(input, config, startedAt, error), ...(billing ? { billing } : {}) };
		if (!ledgerRecorded) {
			if (billing) addBillingToLedger(context.runtime.ledger, "search", billing);
			else addFailedToLedger(context.runtime.ledger, "search");
			context.onLedgerChange?.();
		}
		context.emit?.(details);
		return {
			details,
			content: `DeepSeek search failed: ${details.error?.message ?? "unknown error"}`,
			...(billing?.billed ? { usage: createUsage(billing) } : {}),
			isError: true,
		};
	} finally {
		if (ticker) clearInterval(ticker);
	}
}

export async function runFetch(
	input: FetchInput,
	context: OperationContext<FetchToolDetails>,
): Promise<OperationResult<FetchToolDetails>> {
	const startedAt = Date.now();
	const config = context.runtime.config;
	let details: FetchToolDetails = {
		kind: "fetch",
		stage: "queued",
		url: input.url,
		startedAt,
		cached: false,
	};

	const emit = (stage: FetchToolDetails["stage"], note?: string): void => {
		details = { ...details, stage, ...(note ? { note } : {}), durationMs: Date.now() - startedAt };
		context.emit?.(details);
	};
	const ticker = context.emit
		? setInterval(() => context.emit?.({ ...details, durationMs: Date.now() - startedAt }), 250)
		: undefined;
	let billing: BillingDetails | undefined;
	let ledgerRecorded = false;

	try {
		const url = validateFetchInput(input);
		details = { ...details, url };
		emit("queued");
		const cacheKey = fetchCacheKey(url);
		const cached = context.runtime.caches.fetch.get(cacheKey);
		if (cached) {
			details = {
				...details,
				url,
				stage: "cache-hit",
				cached: true,
				requestedAt: cached.requestedAt,
				title: cached.response.title,
				contentChars: cached.contentChars,
				contentBytes: cached.contentBytes,
				contentLines: cached.contentLines,
				preview: buildPreview(cached.response.content, config.fetch.previewChars),
				...(cached.cachePath ? { cachePath: cached.cachePath } : {}),
				truncated: cached.truncated,
				bytesReturned: cached.bytesReturned,
				durationMs: Date.now() - startedAt,
				billing: createBilling(0, config.cnyPerUsd, false),
				note: undefined,
			};
			addCachedToLedger(context.runtime.ledger, "fetch");
			ledgerRecorded = true;
			context.onLedgerChange?.();
			const content = formatFetchForModel(details, cached.response, config.fetch.maxModelBytes);
			return { details, content, isError: false };
		}

		const client = await resolveClient(context.runtime, context.ctx);
		emit("requesting", `POST ${config.baseUrl}/v1/tools/fetch`);
		const { response, durationMs } = await client.fetch(
			{ url },
			{
				signal: context.signal ?? context.ctx.signal,
				onRetry: (info) => {
					emit("requesting", `Retrying after ${info.waitMs}ms (attempt ${info.attempt}${info.status ? `, HTTP ${info.status}` : ""}): ${info.message}`);
				},
			},
		);
		const requestedAt = new Date().toISOString();
		const contentChars = response.content.length;
		const contentBytes = Buffer.byteLength(response.content, "utf8");
		const contentLines = response.content.split("\n").length;
		billing = fetchBilling(contentChars, config.pricing.fetchCny, config.cnyPerUsd);
		const truncated = truncateUtf8(response.content, config.fetch.maxModelBytes);

		let cachePath: string | undefined;
		let note: string | undefined;
		if (truncated.truncated) {
			emit("writing-cache");
			try {
				const file = await writeFetchCacheFile(context.runtime.agentDir, url, response.content, new Date());
				cachePath = file.path;
			} catch (error) {
				note = `Could not write the full response to the cache: ${error instanceof Error ? error.message : String(error)}`;
			}
		}

		details = {
			...details,
			url,
			stage: "done",
			durationMs,
			requestedAt,
			title: response.title,
			contentChars,
			contentBytes,
			contentLines,
			preview: buildPreview(response.content, config.fetch.previewChars),
			...(cachePath ? { cachePath } : {}),
			truncated: truncated.truncated,
			bytesReturned: Buffer.byteLength(truncated.text, "utf8"),
			billing,
			note,
		};
		if (!truncated.truncated || cachePath) {
			context.runtime.caches.fetch.set(cacheKey, {
				response,
				requestedAt,
				...(cachePath ? { cachePath } : {}),
				truncated: truncated.truncated,
				bytesReturned: details.bytesReturned ?? 0,
				contentChars,
				contentBytes,
				contentLines,
			} satisfies CachedFetch);
		}
		addBillingToLedger(context.runtime.ledger, "fetch", billing);
		ledgerRecorded = true;
		context.onLedgerChange?.();
		const content = formatFetchForModel(details, response, config.fetch.maxModelBytes);
		return { details, content, ...(billing.billed ? { usage: createUsage(billing) } : {}), isError: false };
	} catch (error) {
		if (!billing && error instanceof DeepSeekApiError && error.billable) {
			billing = fetchBilling(1, config.pricing.fetchCny, config.cnyPerUsd);
		}
		details = { ...fetchErrorDetails(input, startedAt, error), ...(billing ? { billing } : {}) };
		if (!ledgerRecorded) {
			if (billing) addBillingToLedger(context.runtime.ledger, "fetch", billing);
			else addFailedToLedger(context.runtime.ledger, "fetch");
			context.onLedgerChange?.();
		}
		context.emit?.(details);
		return {
			details,
			content: `DeepSeek fetch failed: ${details.error?.message ?? "unknown error"}`,
			...(billing?.billed ? { usage: createUsage(billing) } : {}),
			isError: true,
		};
	} finally {
		if (ticker) clearInterval(ticker);
	}
}

