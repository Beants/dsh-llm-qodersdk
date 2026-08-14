/**
 * One long-lived inner Qoder CLI session per host session id: a channel-fed
 * `query()` subprocess whose model continuation streams out as harness
 * `StreamChunk`s. Host tool calls travel through an in-process MCP server:
 * the handler parks on a promise, the adapter finishes the turn with
 * `tool-calls`, and the next host request (carrying tool results) resolves
 * the parked promise so the inner model continues with the result in place.
 * @module dsh-llm-qoder/session
 */

import { CallId, EMPTY_RESPONSE_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock, FinishReason, GenerateOptions, Message, StreamChunk, ToolSchema, TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { createSdkMcpServer, qodercliAuth, query } from '@qoder-ai/qoder-agent-sdk'
import type { CanUseTool, Query } from '@qoder-ai/qoder-agent-sdk'
import { jsonSchemaToShape } from './jsonschema.ts'
import { renderIdentityAppend } from './render.ts'

/** MCP server name this adapter exposes host tools under. */
export const MCP_SERVER_NAME = 'dsh-host'
/** Prefix qodercli uses for this server's tools inside `canUseTool`. */
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`

interface ChannelMessage {
  type: 'user'
  message: { role: 'user', content: Array<{ type: 'text', text: string }> }
  parent_tool_use_id: null
}

/** Minimal push-only async channel feeding the SDK's streaming-input mode. */
function createChannel(): AsyncIterable<ChannelMessage> & { push(message: ChannelMessage): void } {
  const queue: ChannelMessage[] = []
  let resolve: ((result: IteratorResult<ChannelMessage>) => void) | null = null
  return {
    push(message: ChannelMessage): void {
      if (resolve !== null) {
        const settle = resolve
        resolve = null
        settle({ value: message, done: false })
      } else {
        queue.push(message)
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<ChannelMessage> {
      return {
        next(): Promise<IteratorResult<ChannelMessage>> {
          const message = queue.shift()
          if (message !== undefined) return Promise.resolve({ value: message, done: false })
          return new Promise(settle => { resolve = settle })
        },
      }
    },
  }
}

type QueueItem =
  | { kind: 'chunk', chunk: StreamChunk }
  | { kind: 'turn-end', reason: FinishReason, usage?: TokenUsage }

/** Unbounded FIFO the consumer pushes into and the active turn pumps out. */
class TurnQueue implements AsyncIterable<QueueItem> {
  private readonly items: QueueItem[] = []
  private resolve: ((result: IteratorResult<QueueItem>) => void) | null = null
  private closed = false

  push(item: QueueItem): void {
    if (this.closed) return
    if (this.resolve !== null) {
      const settle = this.resolve
      this.resolve = null
      settle({ value: item, done: false })
    } else {
      this.items.push(item)
    }
  }

  close(): void {
    this.closed = true
    if (this.resolve !== null) {
      const settle = this.resolve
      this.resolve = null
      settle({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<QueueItem> {
    return {
      next: (): Promise<IteratorResult<QueueItem>> => {
        const item = this.items.shift()
        if (item !== undefined) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise(settle => { this.resolve = settle })
      },
    }
  }
}

interface ParkedResolver { (result: { text: string, isError: boolean }): void }

/** One tool-use block under assembly in the active turn. */
interface ToolUnderAssembly {
  chunkIndex: number
  callId: string
  name: string
  arguments: string
}

/** Structural view of the SDK stream events this consumer cares about. */
interface SdkStreamEvent {
  type: string
  content_block?: { type?: string, id?: string, name?: string, input?: unknown }
  delta?: { type?: string, text?: string, thinking?: string, partial_json?: string }
}

/** Structural view of the SDK messages this consumer cares about. */
interface SdkMessage {
  type: string
  subtype?: string
  event?: SdkStreamEvent
  message?: { content?: Array<{ type?: string, text?: string }> }
  errors?: unknown
}

/**
 * The host tool runtime dispatches by the bare host name; the inner model
 * only ever sees the namespaced MCP form, so strip the prefix on the way out.
 */
function hostToolName(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name
}

/** Deny native tools, allow this adapter's MCP tools. */
async function gateTools(toolName: string, _input: unknown, options: { toolUseID?: string }): Promise<unknown> {
  const echo = options.toolUseID !== undefined ? { toolUseID: options.toolUseID } : {}
  if (toolName.startsWith(MCP_TOOL_PREFIX)) return { behavior: 'allow', ...echo }
  return {
    behavior: 'deny',
    message: '本会话是宿主 agent 的 LLM 后端，不直接执行工具。宿主的工具已通过 MCP 挂入，直接调用它们即可。',
    ...echo,
  }
}

/**
 * One warm inner session. All mutation happens on the consumer fiber except
 * the documented turn lifecycle driven by {@link stream}.
 */
export class QoderSession {
  private readonly channel = createChannel()
  /**
   * Lazy: the MCP SDK refuses tool registration after the transport connects,
   * so the inner process only spawns once {@link ensureTools} has registered
   * the host tools (the adapter does that immediately before each stream).
   */
  private q: Query | null = null
  /**
   * Tool-call pairing state. qodercli executes calls one at a time and only
   * invokes the NEXT handler after the previous MCP round trip completes,
   * while the host delivers ALL results of a turn up front on the next
   * request — so results buffer by callId and handlers claim their callId
   * from the emission-order queue when they fire.
   */
  private readonly parked = new Map<string, ParkedResolver>()
  private readonly pendingResults = new Map<string, { text: string, isError: boolean }>()
  private readonly openCalls: string[] = []
  private readonly mcp = createSdkMcpServer({ name: MCP_SERVER_NAME, tools: [] })
  private readonly registered = new Map<string, string>()
  private queue: TurnQueue | null = null
  private model: string
  private reasoningEffort: string | undefined
  private contextWindow: number | undefined
  private callCounter = 0
  private abortPending = false
  private disposed = false
  /** Previous request's messages for delta feeding. */
  fedMessages: readonly Message[] | undefined
  fedSystem: string | undefined
  /** This turn's fed characters, reset per turn for per-call token accounting. */
  turnInputChars = 0
  /** Host system prompt captured before spawn for the boot-time systemPrompt. */
  private hostSystem: string | undefined

  // Active-turn assembly state, touched only by the consumer fiber.
  private blockIndex = 0
  private textBlock: { index: number, text: string } | undefined
  private reasoningBlock: { index: number, text: string } | undefined
  private openTool: ToolUnderAssembly | undefined
  private toolCalls: ToolUnderAssembly[] = []
  private outputChars = 0
  private reasoningChars = 0

  constructor(readonly sessionId: string, initialModel: string) {
    this.model = initialModel
  }

  /** Spawn the inner process (first stream only) and attach the consumer. */
  private ensureStarted(): Query {
    if (this.q !== null) return this.q
    const q = query({
      prompt: this.channel,
      options: {
        auth: qodercliAuth(),
        tools: [],
        allowedTools: [],
        canUseTool: gateTools as CanUseTool,
        settingSources: [],
        includePartialMessages: true,
        resolveModel: () => ({
          model: this.model,
          ...this.reasoningEffort === undefined && this.contextWindow === undefined
            ? {}
            : {
              parameters: {
                ...this.reasoningEffort === undefined ? {} : { reasoningEffort: this.reasoningEffort },
                ...this.contextWindow === undefined ? {} : { contextWindow: this.contextWindow },
              },
            },
        }),
        mcpServers: { [MCP_SERVER_NAME]: this.mcp },
        allowedMcpServerNames: [MCP_SERVER_NAME],
        systemPrompt: { type: 'preset', preset: 'qodercli', append: renderIdentityAppend(this.hostSystem) },
      },
    })
    this.q = q
    void this.consume(q)
    return q
  }

  /** Point the session at a model and its per-request policy for the next turn. */
  setModel(model: string, policy?: { reasoningEffort?: string, contextWindow?: number }): void {
    this.model = model
    this.reasoningEffort = policy?.reasoningEffort
    this.contextWindow = policy?.contextWindow
  }

  /** Record the host system prompt; effective only before the process spawns. */
  setSystem(system: string | undefined): void { this.hostSystem = system }

  /** Register any host tools whose schema this session's MCP server lacks. */
  ensureTools(tools: readonly ToolSchema[]): void {
    for (const schema of tools) {
      const hash = JSON.stringify(schema.parameters ?? {})
      if (this.registered.get(schema.name) === hash) continue
      const shape = jsonSchemaToShape(schema.parameters ?? {})
      try {
        this.mcp.instance.registerTool(schema.name, {
          description: schema.description.length > 0 ? schema.description : schema.name,
          inputSchema: shape,
        }, async (args: unknown): Promise<{ content: Array<{ type: 'text', text: string }>, isError?: boolean }> => {
          void args
          const callId = this.openCalls.shift()
          let result: { text: string, isError: boolean }
          if (callId !== undefined && this.pendingResults.has(callId)) {
            result = this.pendingResults.get(callId) as { text: string, isError: boolean }
            this.pendingResults.delete(callId)
          } else {
            const key = callId ?? `anon-${this.callCounter}-${this.parked.size}`
            result = await new Promise<{ text: string, isError: boolean }>(resolve => { this.parked.set(key, resolve) })
          }
          return {
            content: [{ type: 'text', text: result.text }],
            ...result.isError ? { isError: true } : {},
          }
        })
      } catch {
        // Re-registration of a changed schema failed: keep the old tool rather
        // than dropping it; nothing else can recover here.
        continue
      }
      this.registered.set(schema.name, hash)
    }
  }

  /** Deliver host tool results to parked/buffered handlers, keyed by callId. */
  deliverToolResults(tail: readonly Message[]): void {
    let freshUserTurn = false
    for (const message of tail) {
      if (message.role === 'user' && message.source.kind !== 'tool') {
        freshUserTurn = true
        continue
      }
      if (message.role !== 'user' || message.source.kind !== 'tool') continue
      const block = message.content[0]
      if (block === undefined || block.type !== 'tool-result') continue
      const callId = String(block.toolCallId)
      const payload = { text: renderResultText(block.content), isError: block.isError === true }
      const resolve = this.parked.get(callId)
      if (resolve !== undefined) {
        this.parked.delete(callId)
        resolve(payload)
      } else {
        this.pendingResults.set(callId, payload)
      }
    }
    // The host started a new user turn while calls were still parked: unstick
    // the inner process with an explicit cancellation result.
    if (freshUserTurn && this.parked.size > 0) {
      const stale = [...this.parked.entries()]
      this.parked.clear()
      for (const [, resolve] of stale) resolve({ text: '[宿主取消了这次工具执行]', isError: true })
    }
  }

  /** Run one inner turn: feed (if any) then pump consumer chunks until finish. */
  async *stream(options: GenerateOptions, feed: string | null): AsyncGenerator<StreamChunk> {
    if (this.queue !== null) throw new LlmError(`qoder session ${this.sessionId} already has a turn in flight`, 'CONFLICT')
    if (this.disposed) throw new LlmError(`qoder session ${this.sessionId} was disposed`, 'TRANSPORT')
    const q = this.ensureStarted()
    this.queue = new TurnQueue()
    this.resetTurnState()
    if (feed !== null) {
      this.turnInputChars += feed.length
      this.channel.push({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: feed }] },
        parent_tool_use_id: null,
      })
    }
    const signal = options.signal
    let abortTimer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      this.abortPending = true
      void q.interrupt()
      // Fallback: end the turn if the inner process does not settle promptly.
      abortTimer = setTimeout(() => this.endTurn({ kind: 'aborted', failure: { message: 'qoder session aborted by host', code: 'ABORTED' } }), 5_000)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for await (const item of this.queue) {
        if (item.kind === 'chunk') {
          yield item.chunk
          continue
        }
        if (item.usage !== undefined) yield { type: 'usage', usage: item.usage }
        yield { type: 'finish', reason: item.reason }
        return
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (abortTimer !== undefined) clearTimeout(abortTimer)
      this.queue = null
      this.abortPending = false
    }
  }

  /** Tear the inner process down; parked calls die with it. */
  close(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.q !== null) void this.q.close().catch(() => undefined)
  }

  private resetTurnState(): void {
    this.blockIndex = 0
    this.textBlock = undefined
    this.reasoningBlock = undefined
    this.openTool = undefined
    this.toolCalls = []
    this.turnInputChars = 0
    this.outputChars = 0
    this.reasoningChars = 0
  }

  private emit(chunk: StreamChunk): void { this.queue?.push({ kind: 'chunk', chunk }) }

  private usage(): TokenUsage {
    return {
      inputTokens: Math.max(1, Math.ceil(this.turnInputChars / 4)),
      outputTokens: Math.max(1, Math.ceil((this.outputChars + this.reasoningChars) / 4)),
      ...this.reasoningChars > 0 ? { reasoningTokens: Math.ceil(this.reasoningChars / 4) } : {},
    }
  }

  private endTurn(reason: FinishReason, usage?: TokenUsage): void {
    if (this.queue === null) return
    if (this.textBlock !== undefined) {
      this.emit({ type: 'block-end', index: this.textBlock.index, block: { type: 'text', text: this.textBlock.text } })
    }
    if (this.reasoningBlock !== undefined) {
      this.emit({ type: 'block-end', index: this.reasoningBlock.index, block: { type: 'reasoning', text: this.reasoningBlock.text } })
    }
    this.queue.push({ kind: 'turn-end', reason, usage: usage ?? this.usage() })
    this.queue.close()
  }

  private async consume(q: Query): Promise<void> {
    try {
      const iterator = q[Symbol.asyncIterator]()
      while (true) {
        const next = await iterator.next()
        if (next.done) break
        try {
          this.handle(next.value as SdkMessage)
        } catch (error) {
          this.endTurn({ kind: 'error', failure: { message: `qoder session consumer failed: ${String(error)}`, code: 'BACKEND_ERROR' } })
        }
      }
      this.endTurn({ kind: 'error', failure: { message: 'qoder session stream ended unexpectedly', code: 'STREAM_CLOSED' } })
    } catch (error) {
      this.endTurn({ kind: 'error', failure: { message: `qoder session died: ${String(error)}`, code: 'TRANSPORT' } })
    }
  }

  private handle(message: SdkMessage): void {
    if (message.type === 'stream_event') {
      const event = message.event
      if (event === undefined) return
      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block
          if (block?.type === 'tool_use') {
            const callId = `qoder-${++this.callCounter}`
            this.openCalls.push(callId)
            const chunkIndex = this.blockIndex++
            this.openTool = {
              chunkIndex,
              callId,
              name: hostToolName(block.name ?? ''),
              arguments: block.input !== undefined && block.input !== null && Object.keys(block.input as object).length > 0
                ? JSON.stringify(block.input)
                : '',
            }
            this.emit({ type: 'block-start', index: chunkIndex, blockType: 'tool-call' })
            this.emit({
              type: 'tool-call-delta',
              index: chunkIndex,
              id: CallId(callId),
              name: this.openTool.name,
              argumentsDelta: '',
            })
          }
          break
        }
        case 'content_block_delta': {
          const delta = event.delta
          if (delta === undefined) return
          if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
            if (this.textBlock === undefined) {
              this.textBlock = { index: this.blockIndex++, text: '' }
              this.emit({ type: 'block-start', index: this.textBlock.index, blockType: 'text' })
            }
            this.textBlock.text += delta.text
            this.outputChars += delta.text.length
            this.emit({ type: 'text-delta', index: this.textBlock.index, text: delta.text })
          } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
            if (this.reasoningBlock === undefined) {
              this.reasoningBlock = { index: this.blockIndex++, text: '' }
              this.emit({ type: 'block-start', index: this.reasoningBlock.index, blockType: 'reasoning' })
            }
            this.reasoningBlock.text += delta.thinking
            this.reasoningChars += delta.thinking.length
            this.emit({ type: 'reasoning-delta', index: this.reasoningBlock.index, text: delta.thinking })
          } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && this.openTool !== undefined) {
            this.openTool.arguments += delta.partial_json
            this.emit({
              type: 'tool-call-delta',
              index: this.openTool.chunkIndex,
              id: CallId(this.openTool.callId),
              argumentsDelta: delta.partial_json,
            })
          }
          break
        }
        case 'content_block_stop': {
          if (this.openTool !== undefined) {
            this.emit({
              type: 'block-end',
              index: this.openTool.chunkIndex,
              block: {
                type: 'tool-call',
                id: CallId(this.openTool.callId),
                name: this.openTool.name,
                arguments: this.openTool.arguments,
              },
            })
            this.toolCalls.push(this.openTool)
            this.openTool = undefined
          }
          break
        }
        case 'message_stop': {
          if (this.toolCalls.length > 0) this.endTurn({ kind: 'tool-calls' })
          break
        }
        default: break
      }
      return
    }
    if (message.type === 'assistant') {
      // Fallback for turns that streamed no partial events.
      if (this.textBlock === undefined && this.toolCalls.length === 0) {
        const text = (message.message?.content ?? [])
          .filter(block => block.type === 'text')
          .map(block => block.text ?? '')
          .join('')
        if (text.length > 0) {
          this.textBlock = { index: this.blockIndex++, text }
          this.outputChars += text.length
          this.emit({ type: 'block-start', index: this.textBlock.index, blockType: 'text' })
          this.emit({ type: 'text-delta', index: this.textBlock.index, text })
        }
      }
      return
    }
    if (message.type === 'result') {
      if (this.abortPending) {
        this.endTurn({ kind: 'aborted', failure: { message: 'qoder turn aborted by host', code: 'ABORTED' } })
        return
      }
      if (this.toolCalls.length > 0) {
        this.endTurn({ kind: 'tool-calls' })
        return
      }
      if (message.subtype === 'success' || message.subtype === undefined) {
        if (this.textBlock === undefined && this.reasoningBlock === undefined) {
          this.endTurn({
            kind: 'error',
            failure: { message: 'qoder model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
          })
        } else {
          this.endTurn({ kind: 'stop' })
        }
        return
      }
      this.endTurn({
        kind: 'error',
        failure: { message: `qoder turn failed: ${message.subtype} ${safeErrors(message.errors)}`, code: 'BACKEND_TURN_ERROR' },
      })
    }
  }
}

/** Render tool-result content blocks into the single text the inner model reads. */
function renderResultText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'image') parts.push('[图片结果]')
    else parts.push(JSON.stringify(block))
  }
  return parts.join('\n')
}

function safeErrors(errors: unknown): string {
  if (errors === undefined) return ''
  if (typeof errors === 'string') return errors
  try { return JSON.stringify(errors) } catch { return String(errors) }
}

/**
 * Warm-session registry with insertion-order LRU eviction, plus the cold
 * one-shot path for side-channel requests (titles, compaction).
 */
export class QoderSessionManager {
  private readonly sessions = new Map<string, QoderSession>()

  constructor(readonly maxSessions = 8) {}

  /** Existing or fresh warm session for one host session id. */
  forSession(sessionId: string, model: string): QoderSession {
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) {
      this.sessions.delete(sessionId)
      this.sessions.set(sessionId, existing)
      return existing
    }
    const session = new QoderSession(sessionId, model)
    this.sessions.set(sessionId, session)
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next()
      if (oldest.done === true) break
      const victim = this.sessions.get(oldest.value)
      this.sessions.delete(oldest.value)
      victim?.close()
    }
    return session
  }

  /** Drop one session (history diverged); the next request rebuilds it cold. */
  dispose(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    this.sessions.delete(sessionId)
    session.close()
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.close()
    this.sessions.clear()
  }

  /** One-shot turn with no warm state: side channels and cold rebuilds. */
  async *coldStream(options: GenerateOptions, prompt: string, model: string): AsyncGenerator<StreamChunk> {
    const q = query({
      prompt,
      options: {
        auth: qodercliAuth(),
        tools: [],
        allowedTools: [],
        canUseTool: gateTools as CanUseTool,
        settingSources: [],
        maxTurns: 4,
        model,
      },
    })
    const signal = options.signal
    const onAbort = (): void => { void q.interrupt() }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      let text = ''
      let failure: { message: string, code: string } | undefined
      for await (const message of q) {
        const msg = message as SdkMessage
        if (msg.type === 'assistant') {
          const chunk = (msg.message?.content ?? [])
            .filter(block => block.type === 'text')
            .map(block => block.text ?? '')
            .join('')
          if (chunk.length > 0) text += chunk
        } else if (msg.type === 'result' && msg.subtype !== 'success' && msg.subtype !== undefined) {
          failure = { message: `qoder side-channel turn failed: ${msg.subtype} ${safeErrors(msg.errors)}`, code: 'BACKEND_TURN_ERROR' }
        }
      }
      if (signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted by host', code: 'ABORTED' } } }
        return
      }
      if (failure !== undefined && text.length === 0) {
        yield { type: 'finish', reason: { kind: 'error', failure } }
        return
      }
      if (text.length === 0) {
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: { message: 'qoder side-channel returned no content', code: EMPTY_RESPONSE_CODE } },
        }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      for (let i = 0; i < text.length; i += 192) {
        yield { type: 'text-delta', index: 0, text: text.slice(i, i + 192) }
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield {
        type: 'usage',
        usage: {
          inputTokens: Math.max(1, Math.ceil(prompt.length / 4)),
          outputTokens: Math.max(1, Math.ceil(text.length / 4)),
        },
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      await q.close().catch(() => undefined)
    }
  }
}
