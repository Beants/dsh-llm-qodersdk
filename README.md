# dsh-llm-qoder

将 DeepSeek Harness 的 LLM 接缝（`ctx.llm`）路由到本机 **Qoder CLI** 的适配器插件（`@deepseek-ai/dsh-llm-qoder`），基于 [`@qoder-ai/qoder-agent-sdk`](https://www.npmjs.com/package/@qoder-ai/qoder-agent-sdk)。

插件注册 `qoder` 与 `qoder-byok` 两个 provider 路由，让 harness 的模型请求复用本机 `qodercli` 的登录态——**无需任何凭据或设置项**。

## 特性

- **无配置接入**：完全复用本机 `qodercli` 登录态，不需要 API key 或 settings 段。
- **双路由**：`qoder` 广告账号内置模型；`qoder-byok` 只广告账号自定义模型（各自独立路由）。
- **长驻会话**：每个宿主 session id 对应一个 warm 内层 `query()` 子进程，对话延续、工具轮次都发生在会话内部；`maxSessions` 上限内按插入序 LRU 淘汰。
- **工具桥接**：宿主工具通过进程内 MCP server（`dsh-host`）暴露给内层模型；qodercli 一次执行一个调用、宿主一次回传整轮结果，二者通过 callId 配对（120s 内未回传则超时取消）。
- **模型目录**：实时从 CLI 拉取可用模型（含账号自定义模型），TTL 缓存 + 并发共享 + 超时保护，失败回退静态目录；另提供 `deepseek-v4-flash` → `dfmodel`、`deepseek-v4-pro` → `dmodel` 别名。
- **思考强度与上下文窗口**：`resolveModel` 上报 CLI 的 reasoning efforts、默认档位与 `availableContextWindows` / `defaultContextWindow`，模型选择器可直接切换；所选值随每次请求下发。
- **旁路请求**：标题生成、compaction 等 side-channel 请求走冷启动一次性调用，不占用 warm 会话。
- **溢出可恢复**：内层模型因上下文超限失败时（如 `maximum context length ... you requested N tokens`），按 dsh-llm 的 `isContextWindowExceededError` 分类为 `CONTEXT_WINDOW_EXCEEDED` 上报，harness 的溢出自动恢复（配合 `compaction-basic`）可以接管而不是让轮次直接报废。

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

## 上下文管理与压缩

warm 内层会话会累积整段宿主历史：首轮喂入全量历史（`renderInitialFeed`），之后每轮只喂增量（新用户消息、原位刷新）。内层上下文因此随对话增长，模型有硬上限（如 1048576 tokens）。

- **溢出自动恢复**：内层模型报上下文超限时，插件上报 `CONTEXT_WINDOW_EXCEEDED`。harness 的溢出恢复（`dsh-compaction-basic` 的 `agent/request-error` 处理器）会压缩宿主历史并重试；压缩后宿主历史变短，下个请求插件检测到历史回退，自动重建内层会话、冷喂压缩后的历史。
- **前提**：部署里必须加载 `dsh-compaction-basic`（`auto` 默认 `true`）和 `dsh-token-meter`。没装压缩插件时，超限轮次仍会失败——只能新开会话或手动压缩。
- **建议把压力阈值调低**：默认 `thresholdRatio` 0.8 × 模型 contextWindow（1048576 → 约 838k）可能偏晚，尤其宿主侧 token 估算与内层真实用量有偏差时。建议调低到 0.6，让压力压缩远早于溢出触发：

  ```yaml
  - id: compaction-basic
    config:
      auto: true
      thresholdRatio: 0.6
      retainRatio: 0.16
  ```

  也可用 `modelPolicies` 给 `qoder` 路由单独配置。
- **手动压缩**：加载 `dsh-command-compact` 后，对话中输入 `/compact` 立即压缩一次。
- **已超限的会话**：历史已经超过模型上限时，"继续"只会带着更长历史重试失败；先 `/compact` 压缩（或调低阈值后等压力压缩触发），否则新开会话。

## 源码结构

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 插件入口：注册 `qoder` / `qoder-byok` 路由、配置化 provider 目录与 settings 段 |
| `src/adapter.ts` | `QoderAdapter`：模型列表/解析/流式生成，warm 会话管理与续轮规划（`planContinuation`） |
| `src/session.ts` | `QoderSession`：内层 `query()` 子进程、MCP 工具桥、SDK 流事件 → harness `StreamChunk`、失败分类 |
| `src/models.ts` | 实时模型目录拉取（TTL 缓存、并发共享、超时、静态回退） |
| `src/catalog.ts` | 静态模型表与 `deepseek-v4-*` 别名 |
| `src/render.ts` | 宿主消息 → 内层纯文本 feed；身份覆盖 |
| `src/jsonschema.ts` | dsh `ToolSchema.parameters` → zod shape（MCP 工具注册用） |

## 开发与构建

```sh
npm install
npm run build   # tsc 产出 lib/types/*.d.ts，tsdown 产出 lib/index.js
npm pack        # 生成 deepseek-ai-dsh-llm-qoder-<version>.tgz
npm publish     # prepublishOnly 自动先构建
```

peer 依赖 `@deepseek-ai/dsh-llm`（`^0.1.0-rc.5`）与 `@deepseek-ai/cordis` 保持 external。

## License

[MIT](LICENSE) © 2026 dsh-llm-qodersdk contributors
