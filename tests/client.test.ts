import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { DeepSeekApiError, DeepSeekClient } from "../src/api.ts";
import { DEFAULT_CONFIG, type DeepSeekWebToolsConfig } from "../src/config.ts";

const validSearch = {
	results: [
		{
			rerank_score: 1.5,
			title: "Example",
			url: "https://example.com",
			snippet: "snippet",
			summary: "summary",
			content: "",
			site_name: null,
			site_icon: null,
			date: null,
			authority: 1,
		},
	],
};

interface TestServer {
	baseUrl: string;
	requests: number;
	close: () => Promise<void>;
}

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<TestServer> {
	const state = { requests: 0 };
	const server = createServer((req, res) => {
		state.requests++;
		handler(req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		get requests() {
			return state.requests;
		},
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections?.();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

function configFor(server: TestServer, overrides: Partial<DeepSeekWebToolsConfig> = {}): DeepSeekWebToolsConfig {
	return {
		...DEFAULT_CONFIG,
		baseUrl: server.baseUrl,
		timeoutMs: 2_000,
		maxRetries: 1,
		qps: 50,
		...overrides,
	};
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
	res.writeHead(status, { "Content-Type": "application/json", ...headers });
	res.end(JSON.stringify(body));
}

test("client retries a 429 response and succeeds", async () => {
	const server = await startServer((_req, res) => {
		if (server.requests === 1) {
			json(res, 429, { error: { message: "rate limited", code: "rate_limit" } }, { "Retry-After": "0" });
			return;
		}
		json(res, 200, validSearch);
	});
	try {
		const client = new DeepSeekClient(configFor(server), "test-key");
		const { response } = await client.search({ query: "example" });
		assert.equal(response.results.length, 1);
		assert.equal(server.requests, 2);
	} finally {
		await server.close();
	}
});

test("client does not retry a 400 response", async () => {
	const server = await startServer((_req, res) => {
		json(res, 400, { error: { message: "bad request", code: "invalid_request_error" } });
	});
	try {
		const client = new DeepSeekClient(configFor(server, { maxRetries: 2 }), "test-key");
		await assert.rejects(
			() => client.search({ query: "example" }),
			(error: unknown) => {
				assert.ok(error instanceof DeepSeekApiError);
				assert.equal(error.status, 400);
				assert.equal(error.retryable, false);
				return true;
			},
		);
		assert.equal(server.requests, 1);
	} finally {
		await server.close();
	}
});

test("client retries exhausted 500 responses", async () => {
	const server = await startServer((_req, res) => {
		json(res, 500, { error: { message: "server error" } });
	});
	try {
		const client = new DeepSeekClient(configFor(server, { maxRetries: 1 }), "test-key");
		await assert.rejects(
			() => client.search({ query: "example" }),
			(error: unknown) => {
				assert.ok(error instanceof DeepSeekApiError);
				assert.equal(error.status, 500);
				return true;
			},
		);
		assert.equal(server.requests, 2);
	} finally {
		await server.close();
	}
});

test("client times out a slow response", async () => {
	const server = await startServer((_req, res) => {
		setTimeout(() => json(res, 200, validSearch), 300);
	});
	try {
		const client = new DeepSeekClient(configFor(server, { timeoutMs: 50, maxRetries: 0 }), "test-key");
		await assert.rejects(
			() => client.search({ query: "example" }),
			(error: unknown) => {
				assert.ok(error instanceof DeepSeekApiError);
				assert.match(error.message, /timed out/);
				return true;
			},
		);
		assert.equal(server.requests, 1);
	} finally {
		await server.close();
	}
});

test("client marks a malformed billable 200 response", async () => {
	const server = await startServer((_req, res) => {
		json(res, 200, {
			results: [{ ...validSearch.results[0], title: 42 }],
		});
	});
	try {
		const client = new DeepSeekClient(configFor(server, { maxRetries: 0 }), "test-key");
		await assert.rejects(
			() => client.search({ query: "example" }),
			(error: unknown) => {
				assert.ok(error instanceof DeepSeekApiError);
				assert.equal(error.status, 200);
				assert.equal(error.billable, true);
				assert.equal(error.retryable, false);
				return true;
			},
		);
		assert.equal(server.requests, 1);
	} finally {
		await server.close();
	}
});

test("client honors the caller abort signal", async () => {
	const server = await startServer((_req, res) => {
		setTimeout(() => json(res, 200, validSearch), 300);
	});
	try {
		const client = new DeepSeekClient(configFor(server, { timeoutMs: 5_000 }), "test-key");
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 20);
		await assert.rejects(
			() => client.search({ query: "example" }, { signal: controller.signal }),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.equal(error.name, "AbortError");
				return true;
			},
		);
		assert.equal(server.requests, 1);
	} finally {
		await server.close();
	}
});
