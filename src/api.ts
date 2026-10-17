import type { DeepSeekWebToolsConfig } from "./config.ts";
import type { DeepSeekEndpoint, FetchResponse, SearchResponse, SearchResult } from "./types.ts";

export interface ApiRequestOptions {
	signal?: AbortSignal;
	onRetry?: (info: { attempt: number; waitMs: number; status?: number; message: string }) => void;
}

export class DeepSeekApiError extends Error {
	readonly status: number | undefined;
	readonly code: string | undefined;
	readonly type: string | undefined;
	readonly retryable: boolean;
	readonly billable: boolean;

	constructor(
		message: string,
		options: { status?: number; code?: string; type?: string; retryable?: boolean; billable?: boolean } = {},
	) {
		super(message);
		this.name = "DeepSeekApiError";
		this.status = options.status;
		this.code = options.code;
		this.type = options.type;
		this.retryable = options.retryable ?? isRetryableStatus(options.status);
		this.billable = options.billable ?? false;
	}
}

function isRetryableStatus(status: number | undefined): boolean {
	if (status === undefined) return true;
	return status === 408 || status === 429 || status >= 500;
}

function abortError(): Error {
	const error = new Error("Request aborted");
	error.name = "AbortError";
	return error;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			cleanup();
			reject(abortError());
		};
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

class QpsLimiter {
	private timestamps: number[] = [];
	private chain: Promise<void> = Promise.resolve();

	constructor(private readonly qps: number) {}

	acquire(signal: AbortSignal | undefined): Promise<void> {
		const slot = this.chain.then(() => this.waitForSlot(signal));
		this.chain = slot.catch(() => undefined);
		return slot;
	}

	private async waitForSlot(signal: AbortSignal | undefined): Promise<void> {
		for (;;) {
			if (signal?.aborted) throw abortError();
			const now = Date.now();
			while (this.timestamps.length > 0 && this.timestamps[0]! <= now - 1_000) {
				this.timestamps.shift();
			}
			if (this.timestamps.length < this.qps) {
				this.timestamps.push(now);
				return;
			}
			const waitMs = this.timestamps[0]! + 1_000 - now;
			await delay(Math.max(1, waitMs), signal);
		}
	}
}

const limiters = new Map<string, QpsLimiter>();

function limiterFor(baseUrl: string, endpoint: DeepSeekEndpoint, qps: number): QpsLimiter {
	const key = `${baseUrl}\u0000${endpoint}\u0000${qps}`;
	const existing = limiters.get(key);
	if (existing) return existing;
	const limiter = new QpsLimiter(qps);
	limiters.set(key, limiter);
	return limiter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string, context: string): string {
	const value = record[key];
	if (typeof value !== "string") throw new Error(`${context}.${key} must be a string`);
	return value;
}

function readNullableString(record: Record<string, unknown>, key: string, context: string): string | null {
	const value = record[key];
	if (value === null) return null;
	if (typeof value !== "string") throw new Error(`${context}.${key} must be a string or null`);
	return value;
}

function readRequiredNumber(record: Record<string, unknown>, key: string, context: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${context}.${key} must be a finite number`);
	return value;
}

export function validateSearchResponse(value: unknown): SearchResponse {
	if (!isRecord(value) || !Array.isArray(value.results)) {
		throw new Error("DeepSeek search response must contain a results array");
	}
	const results = value.results.map((entry, index): SearchResult => {
		const context = `results[${index}]`;
		if (!isRecord(entry)) throw new Error(`${context} must be an object`);
		return {
			rerank_score: readRequiredNumber(entry, "rerank_score", context),
			title: readRequiredString(entry, "title", context),
			url: readRequiredString(entry, "url", context),
			snippet: readRequiredString(entry, "snippet", context),
			summary: readRequiredString(entry, "summary", context),
			content: readRequiredString(entry, "content", context),
			site_name: readNullableString(entry, "site_name", context),
			site_icon: readNullableString(entry, "site_icon", context),
			date: readNullableString(entry, "date", context),
			authority: readRequiredNumber(entry, "authority", context),
		};
	});
	return { results };
}

export function validateFetchResponse(value: unknown): FetchResponse {
	if (!isRecord(value)) throw new Error("DeepSeek fetch response must be an object");
	return {
		title: readRequiredString(value, "title", "response"),
		content: readRequiredString(value, "content", "response"),
	};
}

function parseErrorMessage(text: string): { message: string; code?: string; type?: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { message: text.trim().slice(0, 500) };
	}
	if (!isRecord(parsed) || !isRecord(parsed.error)) {
		return { message: text.trim().slice(0, 500) };
	}
	const error = parsed.error;
	return {
		message: typeof error.message === "string" ? error.message : text.trim().slice(0, 500),
		code: typeof error.code === "string" ? error.code : undefined,
		type: typeof error.type === "string" ? error.type : undefined,
	};
}

function retryAfterMs(response: Response): number | undefined {
	const header = response.headers.get("retry-after");
	if (!header) return undefined;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
	const date = Date.parse(header);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	return undefined;
}

function backoffMs(attempt: number): number {
	return Math.min(500 * 2 ** attempt, 4_000);
}

export class DeepSeekClient {
	constructor(
		private readonly config: DeepSeekWebToolsConfig,
		private readonly apiKey: string,
	) {}

	search(body: Record<string, unknown>, options: ApiRequestOptions = {}): Promise<{ response: SearchResponse; durationMs: number }> {
		return this.request("search", body, options).then((result) => {
			try {
				return { response: validateSearchResponse(result.data), durationMs: result.durationMs };
			} catch (error) {
				const billable = isRecord(result.data) && Array.isArray(result.data.results) && result.data.results.length > 0;
				throw new DeepSeekApiError(
					`DeepSeek search returned an invalid response: ${error instanceof Error ? error.message : String(error)}`,
					{ status: 200, retryable: false, billable },
				);
			}
		});
	}

	fetch(body: Record<string, unknown>, options: ApiRequestOptions = {}): Promise<{ response: FetchResponse; durationMs: number }> {
		return this.request("fetch", body, options).then((result) => {
			try {
				return { response: validateFetchResponse(result.data), durationMs: result.durationMs };
			} catch (error) {
				const billable =
					isRecord(result.data) && typeof result.data.content === "string" && result.data.content.length > 0;
				throw new DeepSeekApiError(
					`DeepSeek fetch returned an invalid response: ${error instanceof Error ? error.message : String(error)}`,
					{ status: 200, retryable: false, billable },
				);
			}
		});
	}

	private async request(
		endpoint: DeepSeekEndpoint,
		body: Record<string, unknown>,
		options: ApiRequestOptions,
	): Promise<{ data: unknown; durationMs: number }> {
		const startedAt = Date.now();

		for (let attempt = 0; ; attempt++) {
			const limiter = limiterFor(this.config.baseUrl, endpoint, this.config.qps);
			await limiter.acquire(options.signal);
			const attemptTimeout = AbortSignal.timeout(this.config.timeoutMs);
			const signal = options.signal ? AbortSignal.any([options.signal, attemptTimeout]) : attemptTimeout;

			let response: Response;
			try {
				response = await fetch(`${this.config.baseUrl}/v1/tools/${endpoint}`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
					signal,
				});
			} catch (error) {
				if (options.signal?.aborted) throw error;
				if (attemptTimeout.aborted) {
					const message = `timed out after ${this.config.timeoutMs}ms`;
					if (attempt < this.config.maxRetries) {
						const waitMs = backoffMs(attempt);
						options.onRetry?.({ attempt: attempt + 1, waitMs, message });
						await delay(waitMs, options.signal);
						continue;
					}
					throw new DeepSeekApiError(`DeepSeek ${endpoint} request ${message}`, { retryable: true });
				}
				const message = error instanceof Error ? error.message : String(error);
				if (attempt < this.config.maxRetries) {
					const waitMs = backoffMs(attempt);
					options.onRetry?.({ attempt: attempt + 1, waitMs, message });
					await delay(waitMs, options.signal);
					continue;
				}
				throw new DeepSeekApiError(`DeepSeek ${endpoint} network error: ${message}`, { retryable: true });
			}

			if (!response.ok) {
				const text = await response.text();
				const parsed = parseErrorMessage(text);
				const retryable = isRetryableStatus(response.status);
				const serverWait = retryAfterMs(response);
				const hint =
					response.status === 401
						? " Check the deepseek provider credentials with /login, or set DEEPSEEK_API_KEY."
						: response.status === 402
							? " The DeepSeek account balance is insufficient."
							: "";
				const error = new DeepSeekApiError(
					`DeepSeek ${endpoint} failed with HTTP ${response.status}: ${parsed.message}${hint}`,
					{
						status: response.status,
						code: parsed.code,
						type: parsed.type,
						retryable,
					},
				);
				if (retryable && attempt < this.config.maxRetries) {
					const waitMs = serverWait ?? backoffMs(attempt);
					options.onRetry?.({
						attempt: attempt + 1,
						waitMs,
						status: response.status,
						message: parsed.message,
					});
					await delay(waitMs, options.signal);
					continue;
				}
				throw error;
			}

			let data: unknown;
			try {
				data = await response.json();
			} catch (error) {
				throw new DeepSeekApiError(
					`DeepSeek ${endpoint} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
					{ status: response.status, retryable: false },
				);
			}
			return { data, durationMs: Date.now() - startedAt };
		}
	}
}
