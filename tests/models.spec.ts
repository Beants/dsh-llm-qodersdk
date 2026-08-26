/**
 * QoderModelCatalog: TTL-cached live fetching with a shared in-flight promise,
 * enabled-model filtering, and the static fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QODER_MODELS } from '../src/catalog.ts'
import { QoderModelCatalog } from '../src/models.ts'

const { mockQuery } = vi.hoisted(() => {
  const getAvailableModels = vi.fn()
  const close = vi.fn()
  return { mockQuery: { getAvailableModels, close } }
})

vi.mock('@qoder-ai/qoder-agent-sdk', () => ({
  qodercliAuth: () => ({}),
  query: () => mockQuery,
}))

function liveModel(overrides: Partial<{ value: string, displayName: string, description: string, isEnabled: boolean, source: string, isVl: boolean }> = {}) {
  return {
    value: 'dmodel',
    displayName: 'DeepSeek-V4-Pro',
    description: '',
    isEnabled: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-19T00:00:00Z'))
  mockQuery.getAvailableModels.mockReset()
  mockQuery.getAvailableModels.mockResolvedValue([liveModel()])
  mockQuery.close.mockReset()
  mockQuery.close.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('QoderModelCatalog.liveModels', () => {
  it('fetches once and serves the cached snapshot inside the TTL', async () => {
    const catalog = new QoderModelCatalog(60_000)
    const first = await catalog.liveModels()
    const second = await catalog.liveModels()
    expect(first[0]?.value).toBe('dmodel')
    expect(second).toBe(first)
    expect(mockQuery.getAvailableModels).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after the TTL elapses', async () => {
    const catalog = new QoderModelCatalog(60_000)
    await catalog.liveModels()
    vi.advanceTimersByTime(60_001)
    await catalog.liveModels()
    expect(mockQuery.getAvailableModels).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight fetch across concurrent callers', async () => {
    const catalog = new QoderModelCatalog(60_000)
    const [a, b] = await Promise.all([catalog.liveModels(), catalog.liveModels()])
    expect(a).toBe(b)
    expect(mockQuery.getAvailableModels).toHaveBeenCalledTimes(1)
  })

  it('returns the stale snapshot when a refresh fails', async () => {
    const catalog = new QoderModelCatalog(60_000)
    await catalog.liveModels()
    mockQuery.getAvailableModels.mockRejectedValueOnce(new Error('cli unreachable'))
    vi.advanceTimersByTime(60_001)
    const models = await catalog.liveModels()
    expect(models[0]?.value).toBe('dmodel')
  })

  it('returns an empty list when the first fetch fails', async () => {
    mockQuery.getAvailableModels.mockRejectedValue(new Error('cli unreachable'))
    const catalog = new QoderModelCatalog(60_000)
    expect(await catalog.liveModels()).toEqual([])
  })

  it('closes the inner session after the fetch', async () => {
    const catalog = new QoderModelCatalog(60_000)
    await catalog.liveModels()
    expect(mockQuery.close).toHaveBeenCalledTimes(1)
  })
})

describe('QoderModelCatalog.models', () => {
  it('drops disabled entries and maps the rest to catalog models', async () => {
    mockQuery.getAvailableModels.mockResolvedValue([
      liveModel({ value: 'a', displayName: 'A', description: 'desc a', source: 'user' }),
      liveModel({ value: 'b', displayName: 'B', isEnabled: false }),
      liveModel({ value: 'c', displayName: '', source: 'system' }),
    ])
    const catalog = new QoderModelCatalog(60_000)
    const models = await catalog.models()
    expect(models).toEqual([
      { id: 'a', name: 'A', description: 'desc a', source: 'user' },
      { id: 'c', name: 'c', source: 'system' },
    ])
  })

  it('carries an affirmative isVl flag through the mapping', async () => {
    mockQuery.getAvailableModels.mockResolvedValue([
      liveModel({ value: 'v', isVl: true }),
      liveModel({ value: 'f', isVl: false }),
      liveModel({ value: 'n' }),
    ])
    const catalog = new QoderModelCatalog(60_000)
    const models = await catalog.models()
    expect(models.find(m => m.id === 'v')).toMatchObject({ isVl: true })
    expect(models.find(m => m.id === 'f')).not.toHaveProperty('isVl')
    expect(models.find(m => m.id === 'n')).not.toHaveProperty('isVl')
  })

  it('falls back to the static catalog when the live list is empty', async () => {
    mockQuery.getAvailableModels.mockResolvedValue([])
    const catalog = new QoderModelCatalog(60_000)
    expect(await catalog.models()).toBe(QODER_MODELS)
  })
})
