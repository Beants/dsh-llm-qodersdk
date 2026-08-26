/**
 * QoderAdapter: provider listing, model resolution, reasoning metadata, and
 * the continuation plan for warm sessions. The model catalog is mocked; the
 * pure decision helpers are tested directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CallId, MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import {
  QODER_BYOK_PROVIDER, QODER_PROVIDER, QoderAdapter, feedToChannelContent, planContinuation,
  reasoningInfo, resolveImageRefsFrom,
} from '../src/adapter.ts'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from '../src/catalog.ts'

const { catalogInstances } = vi.hoisted(() => ({
  catalogInstances: [] as Array<{
    liveModels: ReturnType<typeof vi.fn>
    models: ReturnType<typeof vi.fn>
    setTtl: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('../src/models.ts', () => ({
  DEFAULT_MODEL_CACHE_TTL_MS: 300_000,
  QoderModelCatalog: class {
    liveModels = vi.fn()
    models = vi.fn()
    setTtl = vi.fn()
    constructor() {
      catalogInstances.push(this)
    }
  },
}))

function text(content: string): ContentBlock {
  return { type: 'text', text: content }
}

function message(role: Message['role'], content: ContentBlock[], overrides: Partial<Message> = {}): Message {
  return {
    id: MessageId('m1'),
    role,
    content,
    source: { kind: 'user' },
    ...overrides,
  }
}

function liveEntry(overrides: Record<string, unknown> = {}) {
  return {
    value: 'dmodel',
    displayName: 'DeepSeek-V4-Pro',
    description: 'desc',
    isEnabled: true,
    source: 'system',
    maxInputTokens: 1_000_000,
    maxOutputTokens: 64_000,
    defaultContextWindow: 200_000,
    availableContextWindows: [200_000, 1_000_000],
    efforts: ['low', 'high'],
    defaultEffort: 'low',
    isReasoning: true,
    ...overrides,
  }
}

beforeEach(() => {
  catalogInstances.length = 0
})

describe('reasoningInfo', () => {
  it('returns undefined for a non-reasoning model without efforts', () => {
    expect(reasoningInfo(undefined, undefined, false)).toBeUndefined()
  })

  it('falls back to the default efforts when the CLI reports none', () => {
    const info = reasoningInfo(undefined, undefined, true)
    expect(info?.efforts.map(e => e.id)).toEqual(['low', 'medium', 'high', 'max'])
    expect(info?.defaultEffort).toBeUndefined()
  })

  it('carries the CLI efforts and a known default effort', () => {
    const info = reasoningInfo(['low', 'max'], 'max', true)
    expect(info?.efforts.map(e => e.id)).toEqual(['low', 'max'])
    expect(info?.defaultEffort).toBe('max')
  })

  it('omits a default effort outside the reported ids', () => {
    const info = reasoningInfo(['low'], 'high', true)
    expect(info?.efforts.map(e => e.id)).toEqual(['low'])
    expect(info?.defaultEffort).toBeUndefined()
  })
})

describe('planContinuation', () => {
  it('rebuilds when the current list is not longer', () => {
    const previous = [message('user', [text('a')])]
    expect(planContinuation(previous, previous)).toEqual({ feed: null, rebuild: true })
    expect(planContinuation(previous, [])).toEqual({ feed: null, rebuild: true })
  })

  it('rebuilds when the head message mutated', () => {
    const previous = [message('user', [text('a')]), message('user', [text('b')])]
    const current = [message('user', [text('a!')]), message('user', [text('b')])]
    expect(planContinuation(previous, current)).toEqual({ feed: null, rebuild: true })
  })

  it('rebuilds when more than two messages mutated', () => {
    const previous = [message('user', [text('a')]), message('user', [text('b')]), message('user', [text('c')])]
    const current = [
      message('user', [text('a!')]),
      message('user', [text('b!')]),
      message('user', [text('c!')]),
      message('user', [text('d')]),
    ]
    expect(planContinuation(previous, current)).toEqual({ feed: null, rebuild: true })
  })

  it('continues silently when only tool results arrived', () => {
    const previous = [message('user', [text('a')])]
    const current = [
      ...previous,
      message('user', [{ type: 'tool-result', toolCallId: CallId('c1'), content: [text('ok')] }], {
        source: { kind: 'tool', callId: CallId('c1') },
      }),
    ]
    expect(planContinuation(previous, current)).toEqual({ feed: null, rebuild: false })
  })

  it('feeds fresh user turns', () => {
    const previous = [message('user', [text('a')])]
    const current = [...previous, message('user', [text('hi')])]
    const plan = planContinuation(previous, current)
    expect(plan.rebuild).toBe(false)
    expect(plan.feed).toContain('[用户] hi')
  })

  it('keeps image references as parts when a fresh turn carries one', () => {
    const imageBlock = {
      type: 'image',
      attachment: { attachmentId: 'i1', mediaType: 'image/png' as const, bytes: 3, width: 2, height: 2 },
    }
    const previous = [message('user', [text('a')])]
    const current = [...previous, message('user', [text('look'), imageBlock as ContentBlock])]
    const plan = planContinuation(previous, current)
    expect(plan.rebuild).toBe(false)
    expect(Array.isArray(plan.feed)).toBe(true)
    const parts = plan.feed as Array<{ type: string, text?: string, attachment?: unknown }>
    expect(parts[0]).toEqual({ type: 'text', text: '[用户] look' })
    expect(parts[1]).toEqual({ type: 'image', attachment: imageBlock.attachment })
  })

  it('feeds in-place mutations with the refresh marker', () => {
    const previous = [message('user', [text('a')]), message('user', [text('b')])]
    const current = [message('user', [text('a')]), message('user', [text('b!')]), message('user', [text('c')])]
    const plan = planContinuation(previous, current)
    expect(plan.rebuild).toBe(false)
    expect(plan.feed).toContain('（宿主原位刷新了这条消息）')
  })
})

describe('QoderAdapter.listModels', () => {
  it('lists built-in models on the qoder route', async () => {
    const adapter = new QoderAdapter()
    catalogInstances[0]?.models.mockResolvedValue([
      { id: 'dmodel', name: 'DeepSeek-V4-Pro', source: 'system' },
      { id: 'custom1', name: 'My Model', source: 'user' },
    ])
    const models = await adapter.listModels(QODER_PROVIDER)
    expect(models.map(m => m.id)).toEqual(['dmodel'])
    expect(models[0]?.provider).toBe(QODER_PROVIDER)
  })

  it('lists only custom models on the qoder-byok route', async () => {
    const adapter = new QoderAdapter()
    catalogInstances[0]?.models.mockResolvedValue([
      { id: 'dmodel', name: 'DeepSeek-V4-Pro', source: 'system' },
      { id: 'custom1', name: 'My Model', source: 'user' },
    ])
    const models = await adapter.listModels(QODER_BYOK_PROVIDER)
    expect(models.map(m => m.id)).toEqual(['custom1'])
  })
})

describe('QoderAdapter.configure', () => {
  it('applies and clears the live context-window override', async () => {
    const adapter = new QoderAdapter()
    catalogInstances[0]?.liveModels.mockResolvedValue([liveEntry()])
    const windowOf = async (): Promise<number | undefined> =>
      (await adapter.resolveModel(QODER_PROVIDER, 'dmodel')).context?.contextWindow
    expect(await windowOf()).toBe(200_000)
    adapter.configure({ maxSessions: 2, modelCacheTtlMs: 60_000, contextWindow: 400_000 })
    expect(await windowOf()).toBe(400_000)
    adapter.configure({ maxSessions: 2, modelCacheTtlMs: 60_000 })
    expect(await windowOf()).toBe(200_000)
    expect(catalogInstances[0]?.setTtl).toHaveBeenCalledWith(60_000)
  })
})

describe('QoderAdapter.resolveModel', () => {
  it('prefers the default context window over the input ceiling', async () => {
    const adapter = new QoderAdapter()
    catalogInstances[0]?.liveModels.mockResolvedValue([liveEntry()])
    const resolved = await adapter.resolveModel(QODER_PROVIDER, 'dmodel')
    expect(resolved.context?.contextWindow).toBe(200_000)
    expect(resolved.context?.availableContextWindows).toEqual([200_000, 1_000_000])
    expect(resolved.context?.defaultContextWindow).toBe(200_000)
    expect(resolved.defaultMaxTokens).toBe(64_000)
  })

  it('falls back to the input ceiling without a default window', async () => {
    const adapter = new QoderAdapter()
    catalogInstances[0]?.liveModels.mockResolvedValue([
      liveEntry({ defaultContextWindow: undefined, availableContextWindows: undefined }),
    ])
    const resolved = await adapter.resolveModel(QODER_PROVIDER, 'dmodel')
    expect(resolved.context?.contextWindow).toBe(1_000_000)
    expect(resolved.context?.availableContextWindows).toBeUndefined()
  })

  it('carries reasoning metadata from the live entry', async () => {
    const adapter = new QoderAdapter()
    catalogInstances[0]?.liveModels.mockResolvedValue([liveEntry()])
    const resolved = await adapter.resolveModel(QODER_PROVIDER, 'dmodel')
    expect(resolved.reasoning?.efforts.map(e => e.id)).toEqual(['low', 'high'])
    expect(resolved.reasoning?.defaultEffort).toBe('low')
  })

  it('resolves unknown live entries against the static catalog', async () => {
    const adapter = new QoderAdapter()
    catalogInstances[0]?.liveModels.mockResolvedValue([])
    const resolved = await adapter.resolveModel(QODER_PROVIDER, 'dmodel')
    expect(resolved.name).toBe('DeepSeek-V4-Pro')
    expect(resolved.context?.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(resolved.defaultMaxTokens).toBe(DEFAULT_MAX_TOKENS)
  })

  it('passes through unknown model ids with defaults', async () => {
    const adapter = new QoderAdapter()
    catalogInstances[0]?.liveModels.mockResolvedValue([])
    const resolved = await adapter.resolveModel(QODER_PROVIDER, 'totally-unknown')
    expect(resolved.id).toBe('totally-unknown')
    expect(resolved.name).toBe('totally-unknown')
    expect(resolved.context?.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('declares image input only for a live isVl model', async () => {
    const adapter = new QoderAdapter()
    catalogInstances[0]?.liveModels.mockResolvedValue([
      liveEntry({ value: 'kmodel_latest' }),
      liveEntry({ value: 'lite', isVl: false }),
      liveEntry({ value: 'vmodel', isVl: true }),
    ])
    expect((await adapter.resolveModel(QODER_PROVIDER, 'kmodel_latest')).inputModalities).toEqual(['text'])
    expect((await adapter.resolveModel(QODER_PROVIDER, 'vmodel')).inputModalities).toEqual(['text', 'image'])
    expect((await adapter.resolveModel(QODER_PROVIDER, 'lite')).inputModalities).toEqual(['text'])
  })
})

describe('feedToChannelContent', () => {
  const ref = { attachmentId: 'i1', mediaType: 'image/png' as const, bytes: 3, width: 2, height: 2 }
  const parts = [
    { type: 'text' as const, text: '[用户] look' },
    { type: 'image' as const, attachment: ref },
  ]

  it('degrades to placeholder text when the model lacks vision', () => {
    expect(feedToChannelContent(parts, false, new Map())).toBe('[用户] look\n\n[图片附件]')
  })

  it('emits the SDK base64 image shape for resolved bytes', () => {
    const images = new Map([['i1', { data: 'QUJD', mediaType: 'image/png' }]])
    expect(feedToChannelContent(parts, true, images)).toEqual([
      { type: 'text', text: '[用户] look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
    ])
  })

  it('degrades unreadable images to placeholder text on vision models', () => {
    expect(feedToChannelContent(parts, true, new Map())).toEqual([
      { type: 'text', text: '[用户] look' },
      { type: 'text', text: '[图片附件（本次未能读取，请基于文字内容继续）]' },
    ])
  })
})

describe('resolveImageRefsFrom', () => {
  const ref = (id: string) => ({ attachmentId: id, mediaType: 'image/png' as const, bytes: 3, width: 2, height: 2 })

  function fakeStore(results: Record<string, { data: Uint8Array, mediaType: string } | Error>) {
    const calls: Array<{ ref: unknown, options: { maxPixels: number, maxBytes: number } }> = []
    return {
      calls,
      async readImageRequest(imageRef: { attachmentId: unknown }, options: { maxPixels: number, maxBytes: number }) {
        calls.push({ ref: imageRef, options })
        const result = results[String(imageRef.attachmentId)]
        if (result instanceof Error) throw result
        if (result === undefined) throw new Error('unknown attachment')
        return result
      },
    }
  }

  it('base64-encodes each reference once with the request budgets', async () => {
    const store = fakeStore({ a: { data: new Uint8Array([65, 66, 67]), mediaType: 'image/png' } })
    const images = await resolveImageRefsFrom(store, [ref('a'), ref('a')])
    expect(images.get('a')).toEqual({ data: 'QUJD', mediaType: 'image/png' })
    expect(store.calls).toHaveLength(1)
    expect(store.calls[0]?.options).toEqual({ maxPixels: 640_000, maxBytes: 1_048_576 })
  })

  it('degrades per-image failures while resolving the rest', async () => {
    const store = fakeStore({
      bad: new Error('deleted from disk'),
      good: { data: new Uint8Array([65]), mediaType: 'image/jpeg' },
    })
    const images = await resolveImageRefsFrom(store, [ref('bad'), ref('good')])
    expect(images.has('bad')).toBe(false)
    expect(images.get('good')).toEqual({ data: 'QQ==', mediaType: 'image/jpeg' })
  })
})
