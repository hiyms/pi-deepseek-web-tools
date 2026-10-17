import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runFetch, runSearch, type OperationContext, type OperationResult } from "./operations.ts";
import { renderFetchCall, renderFetchResult, renderSearchCall, renderSearchResult, renderToolCard } from "./render/tool-cards.ts";
import { createRuntime, resetRuntime, type RuntimeState } from "./runtime.ts";
import type { CommandCardMessageDetails, FetchToolDetails, SearchToolDetails, ToolDetails } from "./types.ts";
import { CUSTOM_MESSAGE_TYPE, FETCH_TOOL_NAME, SEARCH_TOOL_NAME } from "./types.ts";
import { formatLedgerSummary } from "./usage.ts";

const STATUS_KEY = "deepseek-web-tools";

const searchParameters = Type.Object(
	{
		query: Type.String({
			minLength: 1,
			maxLength: 128,
			description:
				"Search query, 1-128 Unicode characters. Supports site:, -site:, lang:, after:, before:, quoted phrases, and exclusions.",
		}),
		count: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: 50,
				description: "Number of results to return (1-50). Defaults to the extension setting.",
			}),
		),
		ori_question: Type.Optional(
			Type.String({
				maxLength: 128,
				description: "The user's original question when it differs from the search query; helps intent ranking.",
			}),
		),
		localization: Type.Optional(
			Type.String({
				description: "IP address used to prefer localized results. Usually omit.",
			}),
		),
		need_content: Type.Optional(
			Type.Boolean({
				description:
					"Return page bodies in the model-facing output. Costs the same per request; use only when summaries are insufficient.",
			}),
		),
	},
	{ additionalProperties: false },
);

const fetchParameters = Type.Object(
	{
		url: Type.String({
			minLength: 1,
			maxLength: 8192,
			description: "Absolute HTTP/HTTPS URL of the page to fetch, without credentials.",
		}),
	},
	{ additionalProperties: false },
);

const SEARCH_DESCRIPTION = `Search the live web through DeepSeek Search (POST /v1/tools/search).

Returns ranked results with title, URL, snippet, long summary, site name, publication date, rerank score (0-3; >=1.5 is high quality), and authority (0-4; >=3 is very authoritative).

Query syntax: site:example.com, -site:example.com, -word, -"exact phrase", "exact phrase", lang:zh,en, after:2025-01-01, before:2026-06-01. Combine operators in one query.

Use summary by default. Set need_content=true only when the long summary is insufficient; page bodies make the model-facing output much larger but do not change the request price.

Billing: DeepSeek charges ¥0.005 per successful request that returns results. The extension reports this as tool usage, so it is added to pi's session cost total. Identical query+parameters within the cache TTL are served from the session cache with no new charge.`;

const FETCH_DESCRIPTION = `Fetch one web page through DeepSeek Fetch (POST /v1/tools/fetch) and return its title plus Markdown body.

Use it for a specific URL, preferably one returned by deepseek-search. Fetch results depend on the target site's availability and access policy.

Billing: DeepSeek charges ¥0.005 per successful fetch that returns page content. The extension reports this as tool usage, so it is added to pi's session cost total. Large pages are truncated in the model-facing output and written to the cache directory; read the cached file with offset/limit when instructed.`;

function textOf(content: Array<{ type: string; text?: string }>): string {
	for (const item of content) {
		if (item.type === "text" && typeof item.text === "string") return item.text;
	}
	return "";
}

function resultFor<TDetails extends ToolDetails>(result: OperationResult<TDetails>): AgentToolResult<TDetails> {
	return {
		content: [{ type: "text", text: result.content }],
		details: result.details,
		...(result.usage ? { usage: result.usage } : {}),
		...(result.isError ? { isError: true } : {}),
	};
}

function refreshStatus(runtime: RuntimeState, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	if (!runtime.config.showStatus || (runtime.ledger.search.calls === 0 && runtime.ledger.fetch.calls === 0)) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const theme = ctx.ui.theme;
	ctx.ui.setStatus(
		STATUS_KEY,
		`${theme.fg("accent", "◆")} ${theme.fg("dim", formatLedgerSummary(runtime.ledger))}`,
	);
}

function operationContext<TDetails extends ToolDetails>(
	runtime: RuntimeState,
	ctx: ExtensionContext,
	signal?: AbortSignal,
	emit?: (details: TDetails) => void,
): OperationContext<TDetails> {
	return {
		runtime,
		ctx,
		...(signal ? { signal } : {}),
		...(emit ? { emit } : {}),
		onLedgerChange: () => refreshStatus(runtime, ctx),
	};
}

async function runCommandSearch(
	pi: ExtensionAPI,
	runtime: RuntimeState,
	ctx: ExtensionCommandContext,
	query: string,
): Promise<void> {
	const result = await runSearch({ query }, operationContext<SearchToolDetails>(runtime, ctx));
	pi.sendMessage<CommandCardMessageDetails>(
		{
			customType: CUSTOM_MESSAGE_TYPE,
			content: result.content,
			display: true,
			details: { card: result.details },
		},
		{ triggerTurn: false },
	);
	if (result.isError) {
		ctx.ui.notify(result.details.error?.message ?? "DeepSeek search failed", "error");
	}
}

async function runCommandFetch(
	pi: ExtensionAPI,
	runtime: RuntimeState,
	ctx: ExtensionCommandContext,
	url: string,
): Promise<void> {
	const result = await runFetch({ url }, operationContext<FetchToolDetails>(runtime, ctx));
	pi.sendMessage<CommandCardMessageDetails>(
		{
			customType: CUSTOM_MESSAGE_TYPE,
			content: result.content,
			display: true,
			details: { card: result.details },
		},
		{ triggerTurn: false },
	);
	if (result.isError) {
		ctx.ui.notify(result.details.error?.message ?? "DeepSeek fetch failed", "error");
	}
}

export default function deepseekWebTools(pi: ExtensionAPI) {
	const runtime = createRuntime(getAgentDir());

	pi.on("session_start", async (_event, ctx) => {
		resetRuntime(runtime, ctx.sessionManager.getEntries());
		refreshStatus(runtime, ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		resetRuntime(runtime, ctx.sessionManager.getEntries());
		refreshStatus(runtime, ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	pi.registerTool<typeof searchParameters, SearchToolDetails>({
		name: SEARCH_TOOL_NAME,
		label: "DeepSeek Search",
		description: SEARCH_DESCRIPTION,
		promptSnippet:
			"Search the live web through DeepSeek Search with ranked titles, URLs, summaries, dates, rerank scores, and authority.",
		promptGuidelines: [
			"Use deepseek-search for current facts, news, documentation, versions, prices, or anything that may have changed, and include the returned URLs in your answer.",
			"Keep DeepSeek queries short and use operators such as site:, lang:, after:, before:, and quoted phrases to narrow results.",
			"Set need_content only when the returned summaries are insufficient; page bodies make the model-facing output much larger.",
		],
		parameters: searchParameters,
		annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
		executionMode: "parallel",
		renderShell: "self",
		renderCall(args, theme) {
			return renderSearchCall(args, theme);
		},
		renderResult(result, options, theme) {
			return renderSearchResult(
				result.details,
				textOf(result.content),
				{ expanded: options.expanded, isPartial: options.isPartial },
				theme,
			);
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionToolContext) {
			const result = await runSearch(
				params,
				operationContext<SearchToolDetails>(runtime, ctx, signal, (details) =>
					onUpdate?.({ content: [], details }),
				),
			);
			return resultFor(result);
		},
	});

	pi.registerTool<typeof fetchParameters, FetchToolDetails>({
		name: FETCH_TOOL_NAME,
		label: "DeepSeek Fetch",
		description: FETCH_DESCRIPTION,
		promptSnippet:
			"Fetch one URL through DeepSeek Fetch and return its title plus Markdown body, with large pages cached to a file.",
		promptGuidelines: [
			"Use deepseek-fetch only for a specific URL, preferably one returned by deepseek-search.",
			"When a fetch result says the content was truncated, read the cached path with offset/limit instead of fetching the same URL again.",
		],
		parameters: fetchParameters,
		annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
		executionMode: "parallel",
		renderShell: "self",
		renderCall(args, theme) {
			return renderFetchCall(args, theme);
		},
		renderResult(result, options, theme) {
			return renderFetchResult(
				result.details,
				textOf(result.content),
				{ expanded: options.expanded, isPartial: options.isPartial },
				theme,
			);
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionToolContext) {
			const result = await runFetch(
				params,
				operationContext<FetchToolDetails>(runtime, ctx, signal, (details) =>
					onUpdate?.({ content: [], details }),
				),
			);
			return resultFor(result);
		},
	});

	pi.registerCommand("deepseek-search", {
		description: "Search the web with DeepSeek Search and show the result card",
		handler: async (args, ctx) => {
			let query = args.trim();
			if (!query) {
				if (!ctx.hasUI) {
					ctx.ui.notify("Pass a query: /deepseek-search <query>", "error");
					return;
				}
				query = (await ctx.ui.input("DeepSeek Search", "query (supports site:, lang:, after:, …)"))?.trim() ?? "";
			}
			if (!query) return;
			await runCommandSearch(pi, runtime, ctx, query);
		},
	});

	pi.registerCommand("deepseek-fetch", {
		description: "Fetch a URL with DeepSeek Fetch and show the result card",
		handler: async (args, ctx) => {
			let url = args.trim();
			if (!url) {
				if (!ctx.hasUI) {
					ctx.ui.notify("Pass a URL: /deepseek-fetch <url>", "error");
					return;
				}
				url = (await ctx.ui.input("DeepSeek Fetch", "https://example.com/article"))?.trim() ?? "";
			}
			if (!url) return;
			await runCommandFetch(pi, runtime, ctx, url);
		},
	});

	pi.registerMessageRenderer<CommandCardMessageDetails>(CUSTOM_MESSAGE_TYPE, (message, _options, theme) => {
		const details = message.details?.card;
		if (!details) return undefined;
		return renderToolCard(details as ToolDetails, { expanded: true, commandView: true }, theme);
	});
}
