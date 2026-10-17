export const SEARCH_TOOL_NAME = "deepseek-search";
export const FETCH_TOOL_NAME = "deepseek-fetch";
export const CUSTOM_MESSAGE_TYPE = "deepseek-web-tools";
export const CACHE_DIR_NAME = "deepseek-web-tools";

export const SEARCH_PRICE_CNY = 0.005;
export const FETCH_PRICE_CNY = 0.005;

export type DeepSeekEndpoint = "search" | "fetch";

export type CardStage =
	| "queued"
	| "requesting"
	| "parsing"
	| "writing-cache"
	| "done"
	| "cache-hit"
	| "error";

export interface SearchRequest {
	query: string;
	count?: number;
	ori_question?: string;
	localization?: string;
	need_content?: boolean;
}

export interface SearchResult {
	rerank_score: number;
	title: string;
	url: string;
	snippet: string;
	summary: string;
	content: string;
	site_name: string | null;
	site_icon: string | null;
	date: string | null;
	authority: number;
}

export interface SearchResponse {
	results: SearchResult[];
}

export interface FetchRequest {
	url: string;
}

export interface FetchResponse {
	title: string;
	content: string;
}

export interface BillingDetails {
	billed: boolean;
	cny: number;
	usd: number;
	cnyPerUsd: number;
	reason?: "no-results" | "empty-content";
}

export interface ToolErrorDetails {
	message: string;
	status?: number;
	code?: string;
	type?: string;
	retryable?: boolean;
}

export interface SearchResultSummary extends Omit<SearchResult, "content"> {
	contentChars: number;
	contentBytes: number;
}

export interface SearchToolDetails {
	kind: "search";
	stage: CardStage;
	query: string;
	count: number;
	oriQuestion?: string;
	localization?: string;
	needContent: boolean;
	startedAt: number;
	durationMs?: number;
	results: SearchResultSummary[];
	cached: boolean;
	billing?: BillingDetails;
	error?: ToolErrorDetails;
	note?: string;
	requestedAt?: string;
}

export interface FetchToolDetails {
	kind: "fetch";
	stage: CardStage;
	url: string;
	startedAt: number;
	durationMs?: number;
	title?: string;
	contentChars?: number;
	contentBytes?: number;
	contentLines?: number;
	preview?: string;
	cachePath?: string;
	truncated?: boolean;
	bytesReturned?: number;
	cached: boolean;
	billing?: BillingDetails;
	error?: ToolErrorDetails;
	note?: string;
	requestedAt?: string;
}

export type ToolDetails = SearchToolDetails | FetchToolDetails;

export interface CommandCardMessageDetails {
	card: ToolDetails;
}

export type CachedSearch = {
	response: SearchResponse;
	requestedAt: string;
};

export type CachedFetch = {
	response: FetchResponse;
	requestedAt: string;
	cachePath?: string;
	truncated: boolean;
	bytesReturned: number;
	contentChars: number;
	contentBytes: number;
	contentLines: number;
};
