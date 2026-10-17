import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_DIR_NAME, type SearchRequest } from "./types.ts";

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export class SessionCache<T> {
	private readonly entries = new Map<string, CacheEntry<T>>();
	private totalBytes = 0;

	constructor(
		private readonly ttlMs: number,
		private readonly maxEntries: number,
		private readonly maxBytes: number = Number.POSITIVE_INFINITY,
		private readonly measure: (value: T) => number = () => 0,
	) {}

	get(key: string, now: number = Date.now()): T | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= now) {
			this.entries.delete(key);
			this.totalBytes -= this.measure(entry.value);
			return undefined;
		}
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	set(key: string, value: T, now: number = Date.now()): void {
		if (this.ttlMs <= 0) return;
		const bytes = Math.max(0, this.measure(value));
		if (bytes > this.maxBytes) return;
		this.prune(now);
		const previous = this.entries.get(key);
		if (previous) {
			this.totalBytes -= this.measure(previous.value);
		}
		this.entries.delete(key);
		this.entries.set(key, { value, expiresAt: now + this.ttlMs });
		this.totalBytes += bytes;
		while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
			const oldest = this.entries.keys().next();
			if (oldest.done) break;
			const entry = this.entries.get(oldest.value);
			this.entries.delete(oldest.value);
			if (entry) this.totalBytes -= this.measure(entry.value);
		}
	}

	clear(): void {
		this.entries.clear();
		this.totalBytes = 0;
	}

	get size(): number {
		return this.entries.size;
	}

	get bytes(): number {
		return this.totalBytes;
	}

	private prune(now: number): void {
		for (const [key, entry] of this.entries) {
			if (entry.expiresAt <= now) {
				this.entries.delete(key);
				this.totalBytes -= this.measure(entry.value);
			}
		}
	}
}

export function searchCacheKey(request: SearchRequest): string {
	return [
		"search",
		request.query,
		String(request.count ?? ""),
		request.ori_question ?? "",
		request.localization ?? "",
		String(request.need_content ?? ""),
	].join("\u0000");
}

export function fetchCacheKey(url: string): string {
	return `fetch\u0000${url}`;
}

export function truncateUtf8(text: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
	const buffer = Buffer.from(text, "utf8");
	if (buffer.length <= maxBytes) return { text, bytes: buffer.length, truncated: false };
	let end = maxBytes;
	while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
	return { text: buffer.subarray(0, end).toString("utf8"), bytes: buffer.length, truncated: true };
}

export function buildPreview(content: string, previewChars: number): string {
	if (previewChars <= 0) return "";
	const characters = Array.from(content);
	if (characters.length <= previewChars) return content;
	return characters.slice(0, previewChars).join("");
}

export function sanitizeUrlForFileName(url: string): string {
	let hostname: string;
	let pathname: string;
	try {
		const parsed = new URL(url);
		hostname = parsed.hostname;
		pathname = parsed.pathname;
	} catch {
		return "page";
	}
	const raw = `${hostname}${pathname}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	return raw.slice(0, 64) || "page";
}

export interface FetchCacheFile {
	path: string;
	bytes: number;
	lines: number;
}

export async function writeFetchCacheFile(
	agentDir: string,
	url: string,
	content: string,
	fetchedAt: Date,
): Promise<FetchCacheFile> {
	const dir = join(agentDir, "cache", CACHE_DIR_NAME, "fetch");
	await mkdir(dir, { recursive: true });
	const timestamp = fetchedAt.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
	const hash = createHash("sha256").update(url).update("\u0000").update(content).digest("hex").slice(0, 10);
	const path = join(dir, `${timestamp}-${sanitizeUrlForFileName(url)}-${hash}.md`);
	await writeFile(path, content, "utf8");
	const bytes = Buffer.byteLength(content, "utf8");
	return { path, bytes, lines: content.split("\n").length };
}
