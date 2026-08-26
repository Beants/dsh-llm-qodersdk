/**
 * `QoderAdapter`: route the harness LLM seam onto a local Qoder CLI account
 * through the qoder-agent-sdk. One warm inner session per host session id
 * carries the conversation (model turns and tool rounds live inside it); host
 * tool schemas are exposed to the inner model through an in-process MCP
 * server whose handlers park until the host delivers tool results on the next
 * request. Side-channel requests (titles, compaction) run cold one-shots.
 * @module dsh-llm-qoder/adapter
 */

import { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock, GenerateOptions, LlmModelInfo, LlmModelReasoningInfo, LlmProviderInfo, LlmResolvedModelInfo,
  Message, StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, QODER_MODELS, resolveQoderModelId,
} from './catalog.ts'
import { DEFAULT_MODEL_CACHE_TTL_MS, QoderModelCatalog } from './models.ts'
import {
  assembleFeed, imageRefs, renderInitialFeed, renderInitialFeedParts, renderRefreshedParts, renderUserTurnParts,
} from './render.ts'
import type { ImageRef, RenderedPart } from './render.ts'
import { QoderSession, QoderSessionManager } from './session.ts'
import type { ChannelContent, ResolvedImages } from './session.ts'

/** Options for {@link QoderAdapter}. */
export interface QoderAdapterOptions {
  /** Maximum simultaneously warm inner sessions (default 8). */
  maxSessions?: number
  /** How long a fetched CLI model catalog stays fresh (default 5 min). */
  modelCacheTtlMs?: number
  /**
   * Override the effective context window (tokens). Reported to the host via
   * resolveModel AND pushed into every inner session's model policy, so the
   * compaction meter and the actual request window never diverge. Clamped by
   * the live model's maxInputTokens ceiling. Absent → CLI default (200K).
   */
  contextWindow?: number
  /**
   * Lazy access to the host attachment store (`ctx.get('attachments')`).
   * Called once per request that carries images; absent or undefined →
   * images degrade to placeholder text instead of failing the turn.
   */
  resolveAttachments?: () => AttachmentStoreLike | undefined
}

/**
 * Structural view of the host attachment store this adapter reads request
 * images from (`AttachmentStore.readImageRequest`).
 */
export interface AttachmentStoreLike {
  readImageRequest(
    ref: ImageRef,
    policy: { maxPixels: number, maxBytes: number },
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array, mediaType: string }>
}

/** Request-image pixel budget, mirroring the dsh-llm-deepseek route defaults. */
const REQUEST_IMAGE_PIXEL_BUDGET = 640_000
/** Request-image encoded-byte cap, mirroring the dsh-llm-deepseek route defaults. */
const REQUEST_IMAGE_MAX_BYTES = 1_048_576

/** The primary provider route (the qoder account's built-in models). */
export const QODER_PROVIDER = 'qoder'
/** Secondary route advertising only the account's custom models. */
export const QODER_BYOK_PROVIDER = 'qoder-byok'

function modelInfo(provider: string, entry: { id: string, name: string, description?: string, isVl?: boolean }): LlmModelInfo {
  return {
    provider,
    id: entry.id,
    name: entry.name,
    ...entry.description === undefined ? {} : { description: entry.description },
    inputModalities: entry.isVl === true ? ['text' as const, 'image' as const] : ['text' as const],
  }
}

/**
 * Default selectable reasoning efforts for a Qoder model. The CLI catalog
 * reports per-model `efforts`; this is the fallback when a model (or the
 * static catalog) discloses none.
 */
const DEFAULT_REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const

/** Human display name for the default effort ids. */
const EFFORT_NAMES: Readonly<Record<string, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

/**
 * Build the `reasoning` metadata block for a resolved model, or undefined
 * when the model does not support reasoning.
 * @param efforts - CLI-reported effort ids (absent for reasoning-less models).
 * @param defaultEffort - CLI-reported default effort id.
 * @param isReasoning - whether the model supports reasoning per the CLI.
 * @returns the harness reasoning metadata, or undefined to omit it.
 */
export function reasoningInfo(
  efforts: readonly string[] | undefined,
  defaultEffort: string | undefined,
  isReasoning: boolean | undefined,
): LlmModelReasoningInfo | undefined {
  if (efforts === undefined && isReasoning === false) return undefined
  const ids = efforts !== undefined && efforts.length > 0
    ? efforts
    : DEFAULT_REASONING_EFFORTS
  return {
    efforts: ids.map(id => ({
      id: ReasoningEffortId(id),
      name: EFFORT_NAMES[id] ?? id,
    })),
    ...defaultEffort !== undefined && ids.includes(defaultEffort)
      ? { defaultEffort: ReasoningEffortId(defaultEffort) }
      : {},
  }
}

/**
 * The Qoder-backed adapter. Session continuity, tool parking, and feed
 * planning live here; chunk synthesis lives in the session's consumer.
 */
export class QoderAdapter extends LlmAdapter {
  private readonly sessions: QoderSessionManager
  private readonly catalog: QoderModelCatalog
  private contextWindowOverride: number | undefined
  private readonly resolveAttachments: () => AttachmentStoreLike | undefined

  constructor(options: QoderAdapterOptions = {}) {
    super()
    this.sessions = new QoderSessionManager(options.maxSessions ?? 8)
    this.catalog = new QoderModelCatalog(options.modelCacheTtlMs ?? DEFAULT_MODEL_CACHE_TTL_MS)
    this.contextWindowOverride = options.contextWindow
    this.resolveAttachments = options.resolveAttachments ?? ((): undefined => undefined)
  }

  /**
   * Live settings update, driven by the dsh-settings bridge: called at
   * attach, on every committed settings change, and at detach. The window
   * override reaches resolveModel and every session's model policy on the
   * next request; a capacity shrink evicts least-recently-used warm sessions.
   */
  configure(settings: { maxSessions: number, modelCacheTtlMs: number, contextWindow?: number }): void {
    this.sessions.resize(settings.maxSessions)
    this.catalog.setTtl(settings.modelCacheTtlMs)
    this.contextWindowOverride = settings.contextWindow
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return {
      id: provider,
      name: provider === QODER_BYOK_PROVIDER ? 'Qoder 自定义' : 'Qoder CLI',
    }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const cliModels = await this.catalog.models()
    if (provider === QODER_BYOK_PROVIDER) {
      // Only the account's custom models, which have their own route.
      return cliModels
        .filter(entry => entry.source === 'user')
        .map(entry => modelInfo(provider, entry))
    }
    // The built-in route lists the qoder account's own models, excluding the
    // custom models that have their own route.
    return cliModels
      .filter(entry => entry.source !== 'user')
      .map(entry => modelInfo(provider, entry))
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    // Live entries are keyed by the SDK model VALUE ('dfmodel'); the host may
    // address the model by its own id ('deepseek-v4-flash'), so match both.
    const models = await this.catalog.liveModels()
    const live =
      models.find(entry => entry.value === model)
      ?? models.find(entry => entry.value === resolveQoderModelId(model))
    if (live !== undefined) {
      const reasoning = reasoningInfo(live.efforts, live.defaultEffort, live.isReasoning)
      return {
        provider,
        id: live.value,
        name: live.displayName.length > 0 ? live.displayName : live.value,
        ...live.description.length > 0 ? { description: live.description } : {},
        // Only an affirmative CLI `isVl` declares image input: the harness
        // gates vision tools on this, so an unverifiable claim must not leak.
        inputModalities: live.isVl === true ? ['text' as const, 'image' as const] : ['text' as const],
        context: {
          // The compaction engine and context meter price against the window
          // a request actually uses. An explicit config override wins (both
          // sides get it — see effectiveContextWindow); otherwise prefer the
          // CLI's defaultContextWindow over the maxInputTokens CEILING, since
          // pricing against the ceiling would push the auto-compaction
          // threshold past what the provider accepts.
          contextWindow: this.effectiveContextWindow(live),
          ...live.availableContextWindows !== undefined && live.availableContextWindows.length > 0
            ? { availableContextWindows: live.availableContextWindows }
            : {},
          ...live.defaultContextWindow !== undefined
            ? { defaultContextWindow: live.defaultContextWindow }
            : {},
        },
        defaultMaxTokens: live.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        ...reasoning === undefined ? {} : { reasoning },
      }
    }
    const configured = QODER_MODELS.find(entry => entry.id === model)
    const reasoning = reasoningInfo(undefined, undefined, true)
    return Promise.resolve({
      ...configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : modelInfo(provider, configured),
      context: { contextWindow: this.contextWindowOverride ?? DEFAULT_CONTEXT_WINDOW },
      defaultMaxTokens: DEFAULT_MAX_TOKENS,
      ...reasoning === undefined ? {} : { reasoning },
    })
  }

  /**
   * Effective per-session window: an explicit config override wins, clamped
   * by the model's ceiling (maxInputTokens, or the largest selectable
   * availableContextWindows entry); otherwise fall back to the CLI default.
   */
  private effectiveContextWindow(
    live?: {
      defaultContextWindow?: number
      maxInputTokens?: number
      availableContextWindows?: readonly number[]
    },
  ): number {
    if (this.contextWindowOverride !== undefined) {
      const bounds = [live?.maxInputTokens, ...(live?.availableContextWindows ?? [])]
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
      const ceiling = bounds.length > 0 ? Math.max(...bounds) : undefined
      return ceiling === undefined ? this.contextWindowOverride : Math.min(this.contextWindowOverride, ceiling)
    }
    return live?.defaultContextWindow ?? live?.maxInputTokens ?? DEFAULT_CONTEXT_WINDOW
  }

  /**
   * Whether the resolved model declares vision input per the live catalog.
   * Catalog fetch failures fall back to text-only (images degrade to
   * placeholders) rather than advertising unverified capability.
   */
  private async modelIsVl(model: string): Promise<boolean> {
    try {
      const models = await this.catalog.liveModels()
      const live = models.find(entry => entry.value === model)
      return live?.isVl === true
    } catch {
      return false
    }
  }

  /** Resolve image references to base64 request bytes; failures degrade per-image. */
  private async resolveImageRefs(refs: readonly ImageRef[], signal?: AbortSignal): Promise<ResolvedImages> {
    const store = this.resolveAttachments?.()
    if (store === undefined) return new Map()
    return resolveImageRefsFrom(store, refs, signal)
  }

  /**
   * Turn a rendered feed into channel content by resolving image parts into
   * base64 image blocks. Text-only feeds pass through as the historical
   * string; non-vision feeds degrade images to placeholder text, as do
   * references missing from {@link images} (unreadable or no attachment store).
   */
  private async resolveFeed(
    feed: string | RenderedPart[],
    vision: boolean,
    signal?: AbortSignal,
  ): Promise<string | ChannelContent[]> {
    if (typeof feed === 'string') return feed
    if (!vision) return feedToChannelContent(feed, false, new Map())
    const images = await this.resolveImageRefs(
      feed.filter((part): part is Extract<RenderedPart, { type: 'image' }> => part.type === 'image').map(part => part.attachment),
      signal,
    )
    return feedToChannelContent(feed, true, images)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const model = resolveQoderModelId(options.model)
    if (options.sessionId === undefined || options.purpose !== undefined) {
      const prompt = renderInitialFeed(options.system, options.messages)
        + '\n（这是一次性旁路请求，直接输出下一条助手回复。）'
      // Side channels (titles, compaction summaries) reuse the main session's
      // model so dsh's recorded summarization target matches what qodercli
      // actually runs — a different default route could have different
      // context limits or quota, silently failing the compaction.
      yield* this.sessions.coldStream(options, prompt, model, this.contextWindowOverride)
      return
    }
    const sessionId = String(options.sessionId)
    const policy = {
      ...options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort },
      ...this.contextWindowOverride === undefined ? {} : { contextWindow: this.contextWindowOverride },
    }
    const vision = await this.modelIsVl(model)
    let session = this.sessions.forSession(sessionId, model)
    if (session.fedMessages === undefined) {
      yield* this.firstTurn(session, options, model, policy, vision)
      return
    }
    const tail = options.messages.slice(session.fedMessages.length)
    session.deliverToolResults(
      tail,
      vision ? await this.resolveImageRefs(collectResultImageRefs(tail), options.signal) : undefined,
    )
    const plan = planContinuation(session.fedMessages, options.messages)
    if (plan.rebuild) {
      this.sessions.dispose(sessionId)
      session = this.sessions.forSession(sessionId, model)
      yield* this.firstTurn(session, options, model, policy, vision)
      return
    }
    session.setModel(model, policy)
    session.ensureTools(options.tools ?? [])
    session.recordRequestInput(options.system, options.messages)
    session.fedMessages = options.messages
    session.fedSystem = options.system
    yield* session.stream(options, plan.feed === null ? null : await this.resolveFeed(plan.feed, vision, options.signal))
  }

  private async *firstTurn(
    session: QoderSession,
    options: GenerateOptions,
    model: string,
    policy: { reasoningEffort?: string, contextWindow?: number },
    vision = false,
  ): AsyncGenerator<StreamChunk> {
    session.setModel(model, policy)
    session.setSystem(options.system)
    // Older dsh-llm releases lack the cwd field on GenerateOptions; read it
    // through the widened view so this adapter compiles against the peer range.
    const cwd = (options as GenerateOptions & { cwd?: string }).cwd
    session.setCwd(cwd)
    session.ensureTools(options.tools ?? [])
    session.recordRequestInput(options.system, options.messages)
    session.fedMessages = options.messages
    session.fedSystem = options.system
    yield* session.stream(
      options,
      await this.resolveFeed(renderInitialFeedParts(options.system, options.messages), vision, options.signal),
    )
  }

  /** Tear down every warm inner session (plugin dispose). */
  close(): void {
    this.sessions.closeAll()
  }
}

interface ContinuationPlan {
  /** Feed for the inner session this turn (text or text+image parts), or null for a pure continuation. */
  feed: string | RenderedPart[] | null
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
export function planContinuation(previous: readonly Message[], current: readonly Message[]): ContinuationPlan {
  if (current.length <= previous.length) return { feed: null, rebuild: true }
  const mutated: number[] = []
  for (let i = 0; i < previous.length; i++) {
    if (JSON.stringify(previous[i]) !== JSON.stringify(current[i])) mutated.push(i)
  }
  if (mutated.includes(0) || mutated.length > 2) return { feed: null, rebuild: true }
  const tail = current.slice(previous.length)
  const freshUser = tail.filter(m => m.role === 'user' && m.source.kind !== 'tool')
  if (freshUser.length === 0 && mutated.length === 0) return { feed: null, rebuild: false }
  const sections: Array<string | RenderedPart[]> = []
  for (const index of mutated) {
    const message = current[index]
    if (message !== undefined) sections.push(renderRefreshedParts(message))
  }
  for (const message of freshUser) sections.push(renderUserTurnParts(message.content))
  const feed = assembleFeed(sections)
  return { feed: feed === '' ? null : feed, rebuild: false }
}

/**
 * Read image references through an attachment store into base64 request
 * bytes. Each reference resolves independently; a failing read leaves that
 * reference absent so it degrades to placeholder text instead of failing the
 * turn. Duplicate ids resolve once.
 */
export async function resolveImageRefsFrom(
  store: AttachmentStoreLike,
  refs: readonly ImageRef[],
  signal?: AbortSignal,
): Promise<ResolvedImages> {
  const map = new Map<string, { data: string, mediaType: string }>()
  for (const ref of refs) {
    const key = String(ref.attachmentId)
    if (map.has(key)) continue
    try {
      const image = await store.readImageRequest(
        ref,
        { maxPixels: REQUEST_IMAGE_PIXEL_BUDGET, maxBytes: REQUEST_IMAGE_MAX_BYTES },
        signal,
      )
      map.set(key, { data: Buffer.from(image.data).toString('base64'), mediaType: image.mediaType })
    } catch {
      // Deliberately swallow: one unreadable image degrades, the rest resolve.
    }
  }
  return map
}

/**
 * Collect image references from the tool-result blocks of one host message
 * tail, so the adapter can resolve their bytes before delivery.
 */
function collectResultImageRefs(tail: readonly Message[]): ImageRef[] {
  const refs: ImageRef[] = []
  for (const message of tail) {
    if (message.role !== 'user' || message.source.kind !== 'tool') continue
    const block: ContentBlock | undefined = message.content[0]
    if (block !== undefined && block.type === 'tool-result') refs.push(...imageRefs(block.content))
  }
  return refs
}

/**
 * Flatten rendered parts into channel content. Text parts ride verbatim
 * (zero-length ones drop); image parts resolve from {@link images} into the
 * SDK's base64 vision shape, degrading to placeholder text when the model
 * lacks vision or the bytes could not be read.
 */
export function feedToChannelContent(
  feed: readonly RenderedPart[],
  vision: boolean,
  images: ResolvedImages,
): string | ChannelContent[] {
  if (!vision) return feed.map(part => part.type === 'text' ? part.text : '[图片附件]').join('\n\n')
  const content: ChannelContent[] = []
  for (const part of feed) {
    if (part.type === 'text') {
      if (part.text.length > 0) content.push({ type: 'text', text: part.text })
    } else {
      const resolved = images.get(String(part.attachment.attachmentId))
      if (resolved !== undefined) {
        content.push({ type: 'image', source: { type: 'base64', media_type: resolved.mediaType, data: resolved.data } })
      } else {
        content.push({ type: 'text', text: '[图片附件（本次未能读取，请基于文字内容继续）]' })
      }
    }
  }
  return content
}
