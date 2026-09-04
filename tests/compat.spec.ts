import { describe, expect, it, vi } from 'vitest'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import { brandToolCallId, installSettingsSectionCompat, settingsNamespaceCompat } from '../src/compat.ts'
import type { SettingsSectionHooksLike } from '../src/compat.ts'

const legacyInstall = (dshSettings as { installSettingsSection?: unknown }).installSettingsSection

function makeCtx(settingsService: unknown) {
  const ctx = {
    inject: vi.fn((_deps: string[], cb: (c: unknown) => void) => cb({ settings: settingsService })),
  }
  return ctx as unknown as Parameters<typeof installSettingsSectionCompat>[0]
}

describe('compat shims across DSH host generations', () => {
  it('brandToolCallId is an identity brand', () => {
    expect(brandToolCallId('call-7')).toBe('call-7')
  })

  it('settingsNamespaceCompat returns the literal for both generations', () => {
    expect(settingsNamespaceCompat('llm-qoder')).toBe('llm-qoder')
  })

  it('installSettingsSectionCompat routes to the settings-service method when present', () => {
    const installSection = vi.fn()
    const ctx = makeCtx({ installSection })
    const schema = { kind: 'object' }
    const hooks: SettingsSectionHooksLike<{ a: number }> = { setSource: () => {}, onChange: () => {} }
    installSettingsSectionCompat(ctx, 'llm-qoder', schema as never, { a: 1 }, hooks)
    expect(installSection).toHaveBeenCalledOnce()
    expect(installSection).toHaveBeenCalledWith(ctx, 'llm-qoder', schema, { a: 1 }, hooks)
  })

  it.skipIf(typeof legacyInstall !== 'function')(
    'installSettingsSectionCompat falls back to the standalone export on 0.1.1-rc.2',
    () => {
      const register = vi.fn(() => ({ watch: () => {}, get: () => ({ a: 1 }) }))
      const effect = vi.fn()
      const ctx = {
        inject: vi.fn((_deps: string[], cb: (c: unknown) => void) => cb({ settings: { register }, effect })),
      } as unknown as Parameters<typeof installSettingsSectionCompat>[0]
      const onChange = vi.fn()
      const hooks: SettingsSectionHooksLike<{ a: number }> = { setSource: () => {}, onChange }
      expect(() => installSettingsSectionCompat(ctx, 'llm-qoder', { kind: 'object' } as never, { a: 1 }, hooks)).not.toThrow()
      expect(register).toHaveBeenCalledOnce()
      expect(register).toHaveBeenCalledWith('llm-qoder', expect.anything(), expect.objectContaining({ base: { a: 1 } }))
      expect(onChange).toHaveBeenCalled()
    },
  )

  it.skipIf(typeof legacyInstall === 'function')(
    'installSettingsSectionCompat throws when the host seam has neither entry point',
    () => {
      const ctx = makeCtx({})
      expect(() => installSettingsSectionCompat(ctx, 'llm-qoder', {} as never, {}, { setSource: () => {}, onChange: () => {} }))
        .toThrow(/neither installSection nor installSettingsSection/)
    },
  )
})
