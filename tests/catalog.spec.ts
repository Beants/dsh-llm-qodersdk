/**
 * Static catalog: model id resolution and the fallback list shape.
 */
import { describe, expect, it } from 'vitest'
import { QODER_MODELS, resolveQoderModelId } from '../src/catalog.ts'

describe('resolveQoderModelId', () => {
  it('expands deepseek aliases case-insensitively', () => {
    expect(resolveQoderModelId('deepseek-v4-pro')).toBe('dmodel')
    expect(resolveQoderModelId('DEEPSEEK-V4-FLASH')).toBe('dfmodel')
  })

  it('strips a qoder- prefix', () => {
    expect(resolveQoderModelId('qoder-ultimate')).toBe('ultimate')
  })

  it('keeps bare ids unchanged', () => {
    expect(resolveQoderModelId('dmodel')).toBe('dmodel')
  })

  it('falls back to auto for a prefix-only id', () => {
    expect(resolveQoderModelId('qoder-')).toBe('auto')
  })

  it('falls back to auto for an empty id', () => {
    expect(resolveQoderModelId('')).toBe('auto')
  })
})

describe('QODER_MODELS', () => {
  it('leads with the auto route and stays non-empty', () => {
    expect(QODER_MODELS[0]?.id).toBe('auto')
    expect(QODER_MODELS.length).toBeGreaterThan(10)
  })

  it('gives every entry a display name', () => {
    for (const entry of QODER_MODELS) {
      expect(entry.name.length).toBeGreaterThan(0)
    }
  })
})
