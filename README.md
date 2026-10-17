# pi-deepseek-web-tools

[English](#english) · [中文](#中文)

## English

Registers `deepseek-search` and `deepseek-fetch` in pi, calling the DeepSeek Search/Fetch API directly. Search results and page bodies are shown as cards in interactive sessions, and request fees are folded into the pi footer total cost through tool usage.

### Requirements

- pi 1.3.0 or newer
- Node.js 22.19 or newer

### Install

```bash
pi install npm:pi-deepseek-web-tools
```

### Authentication

Reads the API key of the pi provider whose id is `deepseek` by default. Configure DeepSeek with `/login`, or set `DEEPSEEK_API_KEY`.

To use another provider id, set `provider` in the configuration file. Search and Fetch share one DeepSeek API key, sent as `Authorization: Bearer <key>`.

### Tools

#### deepseek-search

Calls `POST /v1/tools/search` and returns title, URL, snippet, long summary, site, publication date, rerank score, and authority.

| Parameter | Type | Description |
| --- | --- | --- |
| `query` | string, required | Search terms, 1–128 characters. Supports `site:`, `-site:`, `lang:`, `after:`, `before:`, quoted phrases, and excluded words. |
| `count` | integer, optional | Number of results, 1–50, defaults to `search.count` from the configuration. |
| `ori_question` | string, optional | The user's original question that triggered the search, at most 128 characters. |
| `localization` | string, optional | IP address used to prefer localized results, usually omitted. |
| `need_content` | boolean, optional | Include page bodies in the model-facing output. The request price stays the same; model context usage increases. |

Query syntax examples:

```text
DeepSeek V4 site:github.com OR site:huggingface.co lang:zh,en after:2025-01-01
DeepSeek "exact phrase" -site:example.com -广告
```

#### deepseek-fetch

Calls `POST /v1/tools/fetch`, converts one web page to Markdown, and returns the page title and body.

| Parameter | Type | Description |
| --- | --- | --- |
| `url` | string, required | Absolute HTTP/HTTPS URL, at most 8192 characters, must not contain a user name or password. |

### Cards

In interactive mode every tool call shows one bordered card.

- The collapsed state shows the first 5 results: rerank score, title, site, authority, publication date, and snippet.
- After `ctrl+o` expands the card, results show URL, long summary, and body size; command cards show at most 8 results.
- While a request is running the card shows the stage and elapsed time; on failure it shows the HTTP status, error code, and whether the request is retryable.
- Fetch cards show title, URL, body size, line count, and a Markdown preview; when the body was truncated the card shows the cached file path.

Card content comes from web pages; terminal control sequences are stripped before rendering so page content cannot disturb terminal display.

### Billing

DeepSeek charges ¥5 per 1,000 successful requests, which is ¥0.005 per request. Search is billed only when results are non-empty; Fetch is billed only when a body is returned. `count` does not affect the per-request price.

The `$` total in the pi footer is displayed in US dollars; the extension converts the CNY cost to USD with the configured exchange rate and adds it to the footer total:

```text
usd = cny / cnyPerUsd
```

`cnyPerUsd` defaults to `7.2` and can be changed in the configuration file. One Search costs `$0.000694`, the footer displays it as `$0.001` at 3 decimals, and adds it to the footer total together with model token costs.

The footer status line also shows DeepSeek call statistics:

```text
◆ 2 search 1 cached · 1 fetch · ¥0.015
```

Status line statistics include tool calls and slash commands. Slash command costs are displayed in the status line and do not enter the built-in `$` total; for costs to enter the total, let the model run the search or fetch through a tool call.

Prices and the exchange rate are both configurable, so a DeepSeek price change requires no code change.

### Configuration

Configuration file path: `~/.pi/agent/deepseek-web-tools.json`. The file may contain only the fields you want to override.

```json
{
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "timeoutMs": 90000,
  "maxRetries": 2,
  "qps": 5,
  "cnyPerUsd": 7.2,
  "showStatus": true,
  "pricing": {
    "searchCny": 0.005,
    "fetchCny": 0.005
  },
  "cache": {
    "enabled": true,
    "ttlMs": 600000,
    "maxEntries": 100,
    "maxBytes": 33554432
  },
  "search": {
    "count": 10,
    "needContent": false,
    "localization": "",
    "maxModelBytes": 49152
  },
  "fetch": {
    "maxModelBytes": 49152,
    "previewChars": 4000
  }
}
```

Environment variable overrides:

| Variable | Description |
| --- | --- |
| `DEEPSEEK_WEB_TOOLS_CONFIG` | Configuration file path. |
| `DEEPSEEK_WEB_TOOLS_PROVIDER` | provider id, defaults to `deepseek`. |
| `DEEPSEEK_WEB_TOOLS_BASE_URL` | API root URL, defaults to `https://api.deepseek.com`. |
| `DEEPSEEK_WEB_TOOLS_TIMEOUT_MS` | Timeout of one HTTP request, timed separately for each retry, defaults to `90000`. |
| `DEEPSEEK_WEB_TOOLS_QPS` | Requests per second per endpoint, defaults to `5`. |
| `DEEPSEEK_WEB_TOOLS_CNY_PER_USD` | CNY to USD exchange rate, defaults to `7.2`. |
| `DEEPSEEK_WEB_TOOLS_CACHE_ENABLED` | Query cache switch, `true`/`false`. |
| `DEEPSEEK_WEB_TOOLS_CACHE_TTL_MS` | Query cache lifetime, defaults to `600000`. |
| `DEEPSEEK_WEB_TOOLS_CACHE_MAX_BYTES` | Query cache memory limit, defaults to `33554432`. |
| `DEEPSEEK_WEB_TOOLS_SEARCH_MAX_BYTES` | Search model output limit, defaults to `49152`. |

### Slash commands

```text
/deepseek-search DeepSeek V4 发布
/deepseek-fetch https://example.com/article
```

Without an argument the input box opens. While a command runs a cancellable loader is shown and `Esc` cancels the request. Command results are written into the session as the same kind of card, `ctrl+o` toggles the collapsed state, and the result text also enters the context of the next model request.

### Cache

#### Query cache

The Search cache key contains `query`, `count`, `ori_question`, `localization`, and `need_content`; the Fetch cache key is the URL. The cache lives inside the current pi process and is cleaned automatically once the TTL, the entry limit, or the memory limit is exceeded. A cache hit sends no HTTP request and is not billed.

#### Body file cache

When a fetched body exceeds `fetch.maxModelBytes`, the full body is written to:

```text
~/.pi/agent/cache/deepseek-web-tools/fetch/
```

The file name contains the fetch time, the site path, and a content hash. The model output and the card give the file path and the total line count, so the `read` tool can continue from there. The directory is not cleaned automatically and can be deleted by hand.

### Limitations

- DeepSeek limits Search and Fetch to 5 QPS per account each. The extension queues per endpoint inside the process; concurrent requests from several pi processes can still trigger HTTP 429, which is then retried with backoff.
- Failed requests, empty results, and empty bodies are not billed. HTTP 402 means an insufficient account balance and requires a top-up.
- Search and fetch depend on the availability of the target site and of the DeepSeek service.
- Slash command costs are displayed in the footer status line and do not enter the built-in `$` total.

### Development

```bash
pnpm install
pnpm check
pnpm test:integration
```

`pnpm check` runs typecheck and unit tests. `pnpm test:integration` verifies Search and Fetch against the real DeepSeek API and needs `DEEPSEEK_API_KEY` or the `deepseek` credentials in `~/.pi/agent/auth.json`.

Loading the local directory in pi:

```bash
pi -e .
```

The release process is described in `RELEASING.md` at the repository root.

### Contributing

Open an issue or a pull request. Run `pnpm check` before submitting.

### License

MIT, see [LICENSE](LICENSE).

## 中文

为 pi 注册 `deepseek-search` 与 `deepseek-fetch`，直接调用 DeepSeek Search/Fetch API。搜索结果与网页正文以卡片形式显示在交互式会话中，请求费用通过 tool usage 并入 pi 页脚总计费。

### 要求

- pi 1.3.0 或更高
- Node.js 22.19 或更高

### 安装

```bash
pi install npm:pi-deepseek-web-tools
```

### 鉴权

默认读取 pi 中 provider id 为 `deepseek` 的 API Key。使用 `/login` 配置 DeepSeek，或设置 `DEEPSEEK_API_KEY`。

需要改用其他 provider id 时，在配置文件中设置 `provider`。Search 与 Fetch 使用同一个 DeepSeek API Key，请求头为 `Authorization: Bearer <key>`。

### 工具

#### deepseek-search

调用 `POST /v1/tools/search`，返回标题、链接、短摘要、长摘要、站点、发布时间、rerank 分数与权威性。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `query` | string，必填 | 搜索词，1～128 个字符。支持 `site:`、`-site:`、`lang:`、`after:`、`before:`、引号短语、排除词。 |
| `count` | integer，可选 | 返回条数，1～50，默认取配置中的 `search.count`。 |
| `ori_question` | string，可选 | 触发搜索的用户原始问题，提供时最多 128 个字符。 |
| `localization` | string，可选 | 用于优先返回本地化结果的 IP 地址，通常省略。 |
| `need_content` | boolean，可选 | 在模型输出中包含网页正文。请求费用不变，模型上下文占用会增加。 |

查询语法示例：

```text
DeepSeek V4 site:github.com OR site:huggingface.co lang:zh,en after:2025-01-01
DeepSeek "exact phrase" -site:example.com -广告
```

#### deepseek-fetch

调用 `POST /v1/tools/fetch`，把单个网页转换成 Markdown，返回页面标题与正文。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `url` | string，必填 | 绝对 HTTP/HTTPS URL，长度不超过 8192，不能包含用户名或密码。 |

### 卡片

交互式模式下，每次工具调用显示一张带边框的卡片。

- 折叠状态显示前 5 条结果：rerank 分数、标题、站点、权威性、发布日期、短摘要。
- `ctrl+o` 展开后显示结果的 URL、长摘要与正文大小；命令卡片最多显示 8 条。
- 请求进行中显示阶段与耗时，失败时显示 HTTP 状态、错误码与是否可重试。
- Fetch 卡片显示标题、URL、正文大小、行数、Markdown 预览；正文被截断时显示缓存文件路径。

卡片内容来自网页，渲染前会移除终端控制序列，避免网页内容影响终端显示。

### 计费

DeepSeek 的价格为每 1,000 次成功请求 ¥5，即每次 ¥0.005。Search 只在结果非空时计费；Fetch 只在返回正文时计费。`count` 不影响单次价格。

pi 页脚的 `$` 总计费以美元显示，扩展按配置的汇率把人民币费用换算为美元并计入页脚总计费：

```text
usd = cny / cnyPerUsd
```

默认 `cnyPerUsd` 为 `7.2`，可在配置文件中修改。一次 Search 的费用为 `$0.000694`，页脚按 3 位小数显示为 `$0.001`，并与模型 token 费用一起计入页脚总计费。

页脚状态行同时显示 DeepSeek 调用统计：

```text
◆ 2 search 1 cached · 1 fetch · ¥0.015
```

状态行统计包含工具调用与斜杠命令。斜杠命令的费用显示在状态行，不进入内置 `$` 总计费；需要进入总计费时，让模型通过工具调用执行搜索或抓取。

价格与汇率都可以配置，DeepSeek 调整价格后不需要修改代码。

### 配置

配置文件路径：`~/.pi/agent/deepseek-web-tools.json`。文件可以只写需要覆盖的字段。

```json
{
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com",
  "timeoutMs": 90000,
  "maxRetries": 2,
  "qps": 5,
  "cnyPerUsd": 7.2,
  "showStatus": true,
  "pricing": {
    "searchCny": 0.005,
    "fetchCny": 0.005
  },
  "cache": {
    "enabled": true,
    "ttlMs": 600000,
    "maxEntries": 100,
    "maxBytes": 33554432
  },
  "search": {
    "count": 10,
    "needContent": false,
    "localization": "",
    "maxModelBytes": 49152
  },
  "fetch": {
    "maxModelBytes": 49152,
    "previewChars": 4000
  }
}
```

环境变量覆盖：

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_WEB_TOOLS_CONFIG` | 配置文件路径。 |
| `DEEPSEEK_WEB_TOOLS_PROVIDER` | provider id，默认 `deepseek`。 |
| `DEEPSEEK_WEB_TOOLS_BASE_URL` | API 根地址，默认 `https://api.deepseek.com`。 |
| `DEEPSEEK_WEB_TOOLS_TIMEOUT_MS` | 单次 HTTP 请求超时，每次重试独立计时，默认 `90000`。 |
| `DEEPSEEK_WEB_TOOLS_QPS` | 每个接口的每秒请求上限，默认 `5`。 |
| `DEEPSEEK_WEB_TOOLS_CNY_PER_USD` | 人民币兑美元汇率，默认 `7.2`。 |
| `DEEPSEEK_WEB_TOOLS_CACHE_ENABLED` | 查询缓存开关，`true`/`false`。 |
| `DEEPSEEK_WEB_TOOLS_CACHE_TTL_MS` | 查询缓存有效期，默认 `600000`。 |
| `DEEPSEEK_WEB_TOOLS_CACHE_MAX_BYTES` | 查询缓存内存上限，默认 `33554432`。 |
| `DEEPSEEK_WEB_TOOLS_SEARCH_MAX_BYTES` | Search 模型输出上限，默认 `49152`。 |

### 斜杠命令

```text
/deepseek-search DeepSeek V4 发布
/deepseek-fetch https://example.com/article
```

不带参数时打开输入框。命令执行时显示可取消的加载框，`Esc` 取消请求。命令结果以同款卡片写入会话，`ctrl+o` 切换折叠状态，结果文本也会进入下一次模型请求的上下文。

### 缓存

#### 查询缓存

Search 的缓存键包含 `query`、`count`、`ori_question`、`localization`、`need_content`；Fetch 的缓存键为 URL。缓存位于当前 pi 进程内，超过 TTL、条目上限或内存上限后自动清理。缓存命中不发送 HTTP 请求，也不计费。

#### 正文文件缓存

Fetch 正文超过 `fetch.maxModelBytes` 时，完整正文写入：

```text
~/.pi/agent/cache/deepseek-web-tools/fetch/
```

文件名包含抓取时间、站点路径与内容哈希。模型输出与卡片会给出文件路径和总行数，可以继续使用 `read` 工具读取。该目录不会自动清理，可以手动删除。

### 限制

- DeepSeek 对 Search 与 Fetch 分别限制每个账号 5 QPS。扩展在进程内按接口排队；多个 pi 进程同时请求时仍可能触发 HTTP 429，此时按退避策略重试。
- 请求失败、无结果、空正文不计费。HTTP 402 表示账号余额不足，需要充值。
- 搜索与抓取依赖目标站点与 DeepSeek 服务的可用性。
- 斜杠命令的费用显示在页脚状态行，不进入内置 `$` 总计费。

### 开发

```bash
pnpm install
pnpm check
pnpm test:integration
```

`pnpm check` 执行 typecheck 与单元测试。`pnpm test:integration` 使用真实 DeepSeek API 验证 Search 与 Fetch，需要 `DEEPSEEK_API_KEY` 或 `~/.pi/agent/auth.json` 中的 `deepseek` 凭据。

在 pi 中加载本地目录：

```bash
pi -e .
```

发布流程见仓库根目录的 `RELEASING.md`。

### 贡献

提交 issue 或 pull request。提交前运行 `pnpm check`。

### License

MIT，见 [LICENSE](LICENSE)。
