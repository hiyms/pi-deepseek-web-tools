# pi-deepseek-web-tools

为 pi 注册两个工具：`deepseek-search` 与 `deepseek-fetch`，直接调用 DeepSeek Search/Fetch API。搜索结果与网页正文以卡片形式显示在交互式会话中，请求费用通过 tool usage 并入 pi 页脚的总费用。

## 功能

- `deepseek-search`：调用 `POST /v1/tools/search`，返回标题、链接、短摘要、长摘要、站点、发布时间、rerank 分数与权威性。
- `deepseek-fetch`：调用 `POST /v1/tools/fetch`，把单个网页转换成 Markdown。
- 卡片展示：请求阶段、耗时、费用、结果分数、权威性、站点、日期、摘要、URL、正文预览、缓存路径、错误详情。
- 实时进度：请求进行中每 250ms 刷新阶段与耗时。
- 会话内查询缓存：相同查询与参数在 TTL 内复用结果，不重复计费。
- 超大正文缓存：Fetch 正文超过模型可读上限时写入缓存文件，结果中给出路径与行数。
- 斜杠命令：`/deepseek-search` 与 `/deepseek-fetch`。
- 计费：Search/Fetch 的成功请求费用并入 pi 页脚总计费，页脚状态行显示 DeepSeek 调用次数与人民币金额。

## 安装

```bash
pi install npm:pi-deepseek-web-tools
```

本地开发时直接加载目录：

```bash
pi -e .
```

## 鉴权

默认读取 pi 中 provider id 为 `deepseek` 的 API Key。使用 `/login` 配置 DeepSeek，或设置 `DEEPSEEK_API_KEY`。

`deepseek` provider 的 Key 解析由 pi 完成，包含 `auth.json` 中的凭据与 `DEEPSEEK_API_KEY` 环境变量。需要改用其他 provider id 时，在配置文件中设置 `provider`。

Search 与 Fetch 使用同一个 DeepSeek API Key，请求头为 `Authorization: Bearer <key>`。

## 工具

### deepseek-search

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

### deepseek-fetch

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `url` | string，必填 | 绝对 HTTP/HTTPS URL，长度不超过 8192，不能包含用户名或密码。 |

## 卡片

交互式模式下，每次工具调用显示一张带边框的卡片。

- 折叠状态显示前 5 条结果：rerank 分数、标题、站点、权威性、发布日期、短摘要。
- `ctrl+o` 展开后显示全部结果的 URL、长摘要与正文大小。
- 请求进行中显示阶段与耗时，失败时显示 HTTP 状态、错误码与是否可重试。
- Fetch 卡片显示标题、URL、正文大小、行数、Markdown 预览；正文被截断时显示缓存文件路径。

卡片内容来自网页，渲染前会移除终端控制序列，避免网页内容影响终端显示。

## 计费

DeepSeek 的价格为每 1,000 次成功请求 ¥5，即每次 ¥0.005。Search 只在结果非空时计费；Fetch 只在返回正文时计费。`count` 不影响单次价格。

pi 页脚的 `$` 总计费以美元显示，扩展按配置的汇率把人民币费用写入 tool result 的 `usage.cost.total`：

```text
usd = cny / cnyPerUsd
```

默认 `cnyPerUsd` 为 `7.2`，可在配置文件中修改。一次 Search 的费用为 `$0.000694`，页脚按 3 位小数显示为 `$0.001`，并与模型 token 费用一起计入页脚总计费。

页脚状态行同时显示 DeepSeek 调用统计：

```text
◆ 2 search 1 cached · 1 fetch · ¥0.015
```

状态行统计包含工具调用与斜杠命令。pi 的内置页脚只累加 tool result 的 `usage`，扩展 API 没有从命令追加 usage entry 的接口，因此斜杠命令产生的费用显示在状态行，不进入内置 `$` 总计费。需要进入总计费时，让模型通过工具调用执行搜索或抓取。

价格与汇率都可以配置，DeepSeek 调整价格后不需要修改代码。

## 配置

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
    "maxEntries": 100
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
| `DEEPSEEK_WEB_TOOLS_TIMEOUT_MS` | 单次工具调用的总超时，默认 `90000`。 |
| `DEEPSEEK_WEB_TOOLS_QPS` | 每个接口的每秒请求上限，默认 `5`。 |
| `DEEPSEEK_WEB_TOOLS_CNY_PER_USD` | 人民币兑美元汇率，默认 `7.2`。 |
| `DEEPSEEK_WEB_TOOLS_CACHE_ENABLED` | 查询缓存开关，`true`/`false`。 |
| `DEEPSEEK_WEB_TOOLS_CACHE_TTL_MS` | 查询缓存有效期，默认 `600000`。 |
| `DEEPSEEK_WEB_TOOLS_SEARCH_MAX_BYTES` | Search 模型输出上限，默认 `49152`。 |

## 斜杠命令

```text
/deepseek-search DeepSeek V4 发布
/deepseek-fetch https://example.com/article
```

不带参数时打开输入框。命令结果以同款卡片写入会话，结果文本也会进入下一次模型请求的上下文。

## 缓存

### 查询缓存

Search 的缓存键包含 `query`、`count`、`ori_question`、`localization`、`need_content`；Fetch 的缓存键为 URL。缓存位于当前 pi 进程内，超过 TTL 或条目上限后自动清理。缓存命中不发送 HTTP 请求，也不计费。

### 正文文件缓存

Fetch 正文超过 `fetch.maxModelBytes` 时，完整正文写入：

```text
~/.pi/agent/cache/deepseek-web-tools/fetch/
```

文件名包含抓取时间、站点路径与内容哈希。模型输出与卡片会给出文件路径和总行数，可以继续使用 `read` 工具读取。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:integration
```

`pnpm test` 运行纯函数与卡片渲染测试。`pnpm test:integration` 使用真实 DeepSeek API 执行一次 Search 与一次 Fetch，需要 `DEEPSEEK_API_KEY` 或 `~/.pi/agent/auth.json` 中的 `deepseek` 凭据。

在 pi 中加载本地目录：

```bash
pi -ne -e . -p --tools deepseek-search --model deepseek/deepseek-flash \
  "Call deepseek-search with query 'DeepSeek V4' and count 2."
```

## 发布

GitHub Actions 工作流：

- `.github/workflows/ci.yml`：push 与 pull request 执行 typecheck 与测试。
- `.github/workflows/publish.yml`：推送 `v*` 标签时校验版本号并发布到 npm。

在仓库 Secrets 中配置 `NPM_TOKEN`。已发布的版本会被跳过，重复推送标签不会失败。

本地发布：

```bash
pnpm release:patch
pnpm release:minor
pnpm release:major
```

这些命令依次执行版本更新、`prepublishOnly` 检查与 `npm publish`。发布目标由 `publishConfig.registry` 固定为 `https://registry.npmjs.org/`。本地发布前运行 `npm login --registry=https://registry.npmjs.org`，或配置 `NPM_TOKEN`。

## 限制

- DeepSeek 对 Search 与 Fetch 分别限制每个账号 5 QPS。扩展在进程内按接口排队；多个 pi 进程同时请求时仍可能触发 HTTP 429，此时按退避策略重试。
- 请求失败、无结果、空正文不计费。HTTP 402 表示账号余额不足，需要充值。
- 搜索与抓取依赖目标站点与 DeepSeek 服务的可用性。
- 斜杠命令的费用只显示在页脚状态行，原因见「计费」。
