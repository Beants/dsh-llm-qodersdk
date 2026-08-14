/**
 * `QoderAdapter`: route the harness LLM seam onto a local Qoder CLI account
 * through the qoder-agent-sdk. One warm inner session per host session id
 * carries the conversation (model turns and tool rounds live inside it); host
 * tool schemas are exposed to the inner model through an in-process MCP
 * server whose handlers park until the host delivers tool results on the next
 * request. Side-channel requests (titles, compaction) run cold one-shots.
 * @module dsh-llm-qoder/adapter
 */

import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, QODER_MODELS, resolveQoderModelId,
} from './catalog.ts'
import { DEFAULT_MODEL_CACHE_TTL_MS, QoderModelCatalog } from './models.ts'
import { renderInitialFeed, renderRefreshed, renderUserTurn } from './render.ts'
import { QoderSession, QoderSessionManager } from './session.ts'
import { appendFileSync } from 'node:fs'

/** TEMP debug sink while the MCP tool wiring is being verified. */
function dbg(message: string): void {
  try { appendFileSync('/tmp/qoder-probe/adapter.log', `${new Date().toISOString()} ${message}\n`) } catch { /* ignore */ }
}

/** Options for {@link QoderAdapter}. */
export interface QoderAdapterOptions {
  /** Maximum simultaneously warm inner sessions (default 8). */
  maxSessions?: number
  /** How long a fetched CLI model catalog stays fresh (default 5 min). */
  modelCacheTtlMs?: number
}

/** The single provider route this adapter owns. */
export const QODER_PROVIDER = 'qoder'

function modelInfo(provider: string, entry: { id: string, name: string, description?: string }): LlmModelInfo {
  return {
    provider,
    id: entry.id,
    name: entry.name,
    ...entry.description === undefined ? {} : { description: entry.description },
    inputModalities: ['text'],
  }
}

/**
 * The Qoder-backed adapter. Session continuity, tool parking, and feed
 * planning live here; chunk synthesis lives in the session's consumer.
 */
export class QoderAdapter extends LlmAdapter {
  private readonly sessions: QoderSessionManager
  private readonly catalog: QoderModelCatalog

  constructor(options: QoderAdapterOptions = {}) {
    super()
    this.sessions = new QoderSessionManager(options.maxSessions ?? 8)
    this.catalog = new QoderModelCatalog(options.modelCacheTtlMs ?? DEFAULT_MODEL_CACHE_TTL_MS)
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Qoder CLI' }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return (await this.catalog.models()).map(entry => modelInfo(provider, entry))
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const live = (await this.catalog.liveModels()).find(entry => entry.value === model)
    if (live !== undefined) {
      return {
        provider,
        id: live.value,
        name: live.displayName.length > 0 ? live.displayName : live.value,
        ...live.description.length > 0 ? { description: live.description } : {},
        inputModalities: ['text' as const],
        context: { contextWindow: live.maxInputTokens ?? DEFAULT_CONTEXT_WINDOW },
        defaultMaxTokens: live.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      }
    }
    const configured = QODER_MODELS.find(entry => entry.id === model)
    return Promise.resolve({
      ...configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : modelInfo(provider, configured),
      context: { contextWindow: DEFAULT_CONTEXT_WINDOW },
      defaultMaxTokens: DEFAULT_MAX_TOKENS,
    })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    dbg(`stream provider=${options.provider} model=${options.model} session=${String(options.sessionId ?? '<none>')} purpose=${String(options.purpose ?? '<none>')} tools=${options.tools?.length ?? 0} messages=${options.messages.length}`)
    const model = resolveQoderModelId(options.model)
    if (options.sessionId === undefined || options.purpose !== undefined) {
      const prompt = renderInitialFeed(options.system, options.messages)
        + '\n（这是一次性旁路请求，直接输出下一条助手回复。）'
      yield* this.sessions.coldStream(options, prompt, model)
      return
    }
    const sessionId = String(options.sessionId)
    let session = this.sessions.forSession(sessionId, model)
    if (session.fedMessages === undefined) {
      yield* this.firstTurn(session, options, model)
      return
    }
    session.deliverToolResults(options.messages.slice(session.fedMessages.length))
    const plan = planContinuation(session.fedMessages, options.messages)
    if (plan.rebuild) {
      this.sessions.dispose(sessionId)
      session = this.sessions.forSession(sessionId, model)
      yield* this.firstTurn(session, options, model)
      return
    }
    session.setModel(model)
    session.ensureTools(options.tools ?? [])
    session.fedMessages = options.messages
    session.fedSystem = options.system
    yield* session.stream(options, plan.feed)
  }

  private async *firstTurn(session: QoderSession, options: GenerateOptions, model: string): AsyncGenerator<StreamChunk> {
    session.setModel(model)
    session.setSystem(options.system)
    session.ensureTools(options.tools ?? [])
    session.fedMessages = options.messages
    session.fedSystem = options.system
    yield* session.stream(options, renderInitialFeed(options.system, options.messages))
  }

  /** Tear down every warm inner session (plugin dispose). */
  close(): void {
    this.sessions.closeAll()
  }
}

interface ContinuationPlan {
  /** Text to feed the inner session this turn, or null for a pure continuation. */
  feed: string | null
  /** Whether the warm session must be rebuilt (history diverged past repair). */
  rebuild: boolean
}

/**
 * Decide what to feed on a continuation request. The previous list must be a
 * prefix (same length growth, index 0 untouched, at most two in-place
 * mutations — the host refreshes runtime-context snapshots in place every
 * turn). Tail tool-result messages were already resolved into parked handlers
 * and never feed; fresh user turns and mutated messages do.
 */
function planContinuation(previous: readonly import('@deepseek-ai/dsh-llm').Message[], current: readonly import('@deepseek-ai/dsh-llm').Message[]): ContinuationPlan {
  if (current.length <= previous.length) return { feed: null, rebuild: true }
  const mutated: number[] = []
  for (let i = 0; i < previous.length; i++) {
    if (JSON.stringify(previous[i]) !== JSON.stringify(current[i])) mutated.push(i)
  }
  if (mutated.includes(0) || mutated.length > 2) return { feed: null, rebuild: true }
  const tail = current.slice(previous.length)
  const freshUser = tail.filter(m => m.role === 'user' && m.source.kind !== 'tool')
  if (freshUser.length === 0 && mutated.length === 0) return { feed: null, rebuild: false }
  const parts: string[] = []
  for (const index of mutated) {
    const message = current[index]
    if (message !== undefined) parts.push(renderRefreshed(message))
  }
  for (const message of freshUser) parts.push(renderUserTurn(message.content))
  return { feed: parts.join('\n\n'), rebuild: false }
}
