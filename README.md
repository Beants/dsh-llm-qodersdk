# dsh-llm-qodersdk

将 DeepSeek Harness 的 LLM 接缝（`ctx.llm`）路由到本机 **Qoder CLI** 的适配器插件（`@deepseek-ai/dsh-llm-qoder`），基于 [`@qoder-ai/qoder-agent-sdk`](https://www.npmjs.com/package/@qoder-ai/qoder-agent-sdk)。

它注册 `qoder` provider 路由，让 harness 的模型请求复用本机 `qodercli` 的登录态——**无需任何凭据或设置项**，包括账号自定义的 BYOK 模型。

## 特性

- **无配置接入**：完全复用本机 `qodercli` 登录态，不需要 API key 或 settings 段。
- **长驻会话**：每个宿主 session id 对应一个 warm 内层 `query()` 子进程，对话延续、工具轮次都发生在会话内部。
- **工具桥接**：宿主工具通过进程内 MCP server（`dsh-host`）暴露给内层模型；qodercli 一次执行一个调用、宿主一次回传整轮结果，二者通过 callId 配对。
- **模型目录**：实时从 CLI 拉取可用模型（含账号自定义模型），TTL 缓存 + 并发共享，失败回退静态目录；另提供 `deepseek-v4-flash` / `deepseek-v4-pro` 别名。
- **思考强度**：`resolveModel` 上报 CLI 的 reasoning efforts 与默认档位，产品模型选择器自动显示思考强度选项；所选档位通过 model-policy 参数随每次请求下发。
- **上下文窗口**：上报 CLI 的 `availableContextWindows` / `defaultContextWindow`，模型选择器可直接切换上下文窗口（如 200K/400K/1M），并通过 model-policy 参数下发。
- **BYOK 外部模型**：把 qodercli 的 BYOK（Bring Your Own Key）配置暴露为原生 harness 设置项——在 Models 设置页填写第三方 provider、模型、API key 即可把外部模型加入模型选择器，调用时凭据按请求经 qodercli 透传，不需要存入 harness。
- **旁路请求**：标题生成、compaction 等 side-channel 请求走冷启动一次性调用，不占用 warm 会话。

## 上下文计量与自动压缩适配（0.1.17 → 0.1.19）

这一节记录在本仓库上做过的**真实适配**：让 harness 的上下文占用显示和自动压缩在 qoder 后端下真正工作。排查起点是一个 8 小时的 goal 循环会话：日志 30MB、surface 按 harness 估算约 645K token，provider 却在 1,037,586 token 处连续拒绝请求（"maximum context length is 1048576 tokens"），而 UI 上下文环一直显示 2% —— 自动压缩从头到尾没有触发过。

### 根因一：qodercli 不上报真实 metering，usage 帧全零

SDK 流事件里 `usage` 帧（`input_tokens` / `output_tokens`）默认是 **0**（qoder CLI 无 metering 数据）。插件退回的估算又只算**当前 turn 喂入的字符**（`turnInputChars / 4`），于是每个 `assistant/message` 上报的 `inputTokens` 都是 1、32 之类的小数字。harness 的 `contextPressure` 投影用最近一次请求的 usage 作为分子（`pressureTokens`），所以 UI 环永远显示 ~2%，自动压缩阈值判断也基于假数字。

> 尝试过 `getContextUsage()`（SDK 的会话级上下文占用接口），实测返回 `totalTokens: 0, maxTokens: 0` —— 当前 qodercli 版本不提供真实值，不可用。`getUsageInfo()` 返回的是**账户 credit 配额**（`isQuotaExceeded`），不是上下文占用。两条路都走不通。

**修复（0.1.17）**：在插件层按 **harness 前端 token-meter 相同的算法**估算每次请求的真实输入。`adapter.stream()` 每次请求调用 `session.recordRequestInput(system, messages)`，用 `renderInitialFeed(system, messages)` 渲染完整会话（系统提示 + 全部消息），按 `rendered.length / 4`（与 harness `estimate.ts` 的 `CHARS_PER_TOKEN = 4` 同口径）估算成 token；`usage()` 优先返回该估算值。这样 UI 环与自动压缩阈值都基于真实发送量。

### 根因二：contextWindow 用了模型上限而非实际窗口

qoder CLI 的 live catalog 对 `deepseek/deepseek-v4-flash-pg` 返回：

```
maxInputTokens: 1000000          ← 模型上限（1M）
availableContextWindows: [200000, 400000, 1000000]
defaultContextWindow: 200000     ← 请求实际使用的窗口
```

插件 `resolveModel()` 原实现是 `contextWindow: live.maxInputTokens ?? DEFAULT`（=1M）。compaction 引擎的自动压缩阈值 = `0.8 × contextWindow`（compaction-basic 默认 `thresholdRatio: 0.8`），于是阈值被算成 **800K** —— 而请求实际窗口只有 200K，真实占用 120K 时 UI 显示 18%（安全），实际已 60%+。等到 harness 认为"达到 800K"时，provider 早已在 1,048,576 处拒绝。

**修复（0.1.18）**：`contextWindow` 优先取 `live.defaultContextWindow`（请求实际使用的窗口），`maxInputTokens` 仅作为上限保留在 `availableContextWindows` 里：

```ts
contextWindow: live.defaultContextWindow ?? live.maxInputTokens ?? DEFAULT_CONTEXT_WINDOW
```

修复后阈值 = `0.8 × 200K = 160K`，与 provider 真实能力对齐。

### 根因三：side-channel（压缩摘要）丢掉了主会话模型

compaction 的 summarizer 通过 `ctx.llm.stream()` 调用，携带 `purpose: 'compaction'` + `sessionId`。qoder 适配器看到 `purpose ≠ undefined` 走 coldStream 分支，原实现是：

```ts
// 旧：side channels cannot carry a per-call custom_model
yield* this.sessions.coldStream(options, prompt, undefined)   // model 被丢成 undefined
```

于是压缩摘要请求实际由 **qodercli 默认路由（auto）** 执行，而 dsh 记录的摘要目标是主会话模型（`latest = session.requestHeader().config`）——两边不一致。默认路由的模型可能上下文限制不同、或 quota 已耗尽（实测报 `You've reached your credit usage limit`），导致 `compaction/end` 记 `Qoder worker runtime exited with code 1`，手动/自动压缩全部失败。

**修复（0.1.19）**：side channel 复用主会话模型：

```ts
yield* this.sessions.coldStream(options, prompt, model)   // model = resolveQoderModelId(options.model)
```

### 修复效果（实测）

修复后，一个占用超过 160K 阈值的会话自动触发了压缩：

```
compaction/start  turn 11
compaction/summary  shadowed=354 tokens=137286 model=deepseek/deepseek-v4-flash-pg
compaction/end      （无 error）
```

- 折叠 354 个 surface 节点 / 137,286 tokens；
- 摘要模型 = 主会话模型（模型错配修复生效）；
- 压缩后占用从 ~183K 降到 ~24.9K（12%），会话继续正常运行。

### 压缩职责分工（dsh vs qoder）

- **压缩由 dsh（harness compaction-basic）做**：决定压缩范围、保留比例（默认 `retainRatio: 0.16` 保留最近 16%）、生成 checkpoint、改写会话 surface。
- **qoder 插件只做 LLM 后端**：把 dsh 的消息喂给 qodercli、取回回复。压缩后的 surface 变化会被 qoder 插件的 `planContinuation` 检测到（`current.length <= previous.length` 或消息被改写 → `rebuild: true`），主动 dispose 旧 warm 会话并按新 surface 冷重建——**不存在"两边都压缩"的冲突**，qodercli 内部缓存会随 dsh 压缩被作废。
- 摘要生成依赖 LLM。默认走主会话路由；若 qoder 账户 quota 不足，可在 `cordis.patch.yml` 给 compaction-basic 配置 `summarizationProvider` / `summarizationModel` 指向其它有额度的模型。

## 安装

在 DeepSeek Harness（dsh）中作为插件加载：

```yaml
# cordis.yml 或 patch 层
- id: llm-qoder
  name: '@deepseek-ai/dsh-llm-qoder'
```

然后选择 `qoder` provider 下的模型即可（在对话框模型选择器或 Models 设置页中）。

## 配置

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `maxSessions` | number | `8` | 同时保持 warm 的内层 qodercli 会话上限（超出按插入序 LRU 淘汰） |
| `modelCacheTtlSeconds` | number | `300` | CLI 模型目录的缓存保鲜秒数 |
| `byok` | `ByokModelConfig[]` | `[]` | 外部模型列表（见下文 BYOK 小节） |

### BYOK 外部模型

qodercli 的 BYOK 能力允许用你自己的第三方 API key 调用外部模型（如阿里云百炼、Kimi、MiniMax 等）。本插件把它暴露为 **Models 设置页**里 `qoder` provider 下的一个表单：每填一条 `byok` 配置，就会在模型选择器里出现一个 `byok:<provider>:<model>` 模型。

```ts
interface ByokModelConfig {
  provider: string   // 第三方 provider 标识，如 "bailian"、"kimi"、"deepseek"
  model: string      // 外部模型标识，如 "qwen3.8-max-tp"
  name?: string      // 选择器里显示的名字（默认取 model）
  apiKey: string     // 你的第三方 API key，按请求经 qodercli 透传，不落盘到 harness
  url?: string       // 可选：覆盖 provider 的 API 地址
  style?: string     // 可选：协议风格，默认 "openai"
}
```

- **可用 provider 清单**：插件实时向 qodercli 查询 `get_byok_config`，返回约 12 个内置 provider（bailian、bailian-intl、zhipu、kimi、minimax、deepseek 等）及每个 provider 支持的模型元数据（`max_input_tokens`、思考档位、是否视觉/推理模型）。providers 与模型元数据通过 `QoderByokCatalog` 缓存。
- **凭据安全**：API key 只随每次调用作为 `custom_model` 参数传给 qodercli，由 qodercli 的 worker 完成请求；harness 侧不存储、不落盘。
- **编程接口**：包还导出 `fetchByokProviders()`、`validateByokModel({provider, model, api_key, url?, style?})`（无效 key 返回 `false`）、`byokModelId(provider, model)` / `parseByokModelId(id)`、`customModelFor(entry)` 与 `QoderByokCatalog`，便于在自己的代码里复用同一套逻辑。

## 源码结构

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 插件入口：`ctx.llm.registerAdapter(['qoder'], adapter)` |
| `src/adapter.ts` | `QoderAdapter`：模型列表/解析/流式生成，warm 会话管理、续轮规划、side-channel 模型传递、请求输入估算 |
| `src/session.ts` | `QoderSession`：内层 `query()` 子进程、MCP 工具桥、SDK 流事件 → harness `StreamChunk`、usage 上报（真实输入估算 + 错误分类） |
| `src/models.ts` | 实时模型目录拉取（TTL 缓存、并发共享、超时、静态回退） |
| `src/byok.ts` | BYOK 外部模型：qodercli providers 目录、校验、`byok:` 模型 id 编解码与设置表单映射 |
| `src/catalog.ts` | 静态模型表与 `deepseek-v4-*` 别名 |
| `src/render.ts` | 宿主消息 → 内层纯文本 feed；身份覆盖 |
| `src/jsonschema.ts` | dsh `ToolSchema.parameters` → zod shape（MCP 工具注册用） |

## 开发与构建

本仓库只存源码（`src/`）；构建产物 `lib/`（`lib/index.js` + `lib/types/*.d.ts`）被 `.gitignore` 忽略，由构建脚本按需生成。

```sh
npm install
npm run build   # tsc 产出 lib/types/*.d.ts，tsdown 产出 lib/index.js
npm publish     # prepublishOnly 自动先构建
```

构建配置已就位（`tsconfig.json` + `tsdown.config.ts`），peer 依赖 `@deepseek-ai/dsh-llm` 和 `@deepseek-ai/cordis` 保持 external。

> **当前限制**：`@deepseek-ai/dsh-llm@^0.1.0-rc.5` 尚未发布到公共 npm（registry 上仅有 `0.0.1-rc.1`），因此 `npm install` 暂时无法解析该 peer 依赖，独立构建也暂不可运行。等它发布后，本仓库即可直接 `npm install && npm run build && npm publish`。在此之前，实际构建/使用仍在 DeepSeek Harness 仓库内的 `plugins/llm-qoder/` 完成（由仓库根配置 `tsc` + `tsdown` 产出 `lib/`）。

## License

[MIT](LICENSE) © 2026 dsh-llm-qodersdk contributors
