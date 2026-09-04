/**
 * Cross-generation shims over the DSH host seam, so one plugin build serves
 * both host lines: dsh-llm 0.1.2-rc.1 renamed the `CallId` brand helper to
 * `ToolCallId`, and dsh-settings 0.1.2-rc.1 dropped the standalone
 * `installSettingsSection`/`settingsNamespace` exports in favor of the
 * settings-service method `installSection` with plain-string namespaces.
 * Types compile against 0.1.2-rc.1; the runtime resolves whichever shape the
 * installed host actually provides (0.1.1-rc.2 included).
 * @module dsh-llm-qoder/compat
 */

import type { Context } from '@deepseek-ai/cordis'
import * as dshLlm from '@deepseek-ai/dsh-llm'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type z from '@deepseek-ai/schemastery'

/** Hooks shape shared by `installSettingsSection` and `SettingsProvider.installSection`. */
export interface SettingsSectionHooksLike<T> {
  /** Receive the authoritative source thunk (settings scope or composition entry). */
  setSource: (current: () => T) => void
  /** Re-derive registration-level facts after attach/detach/committed change. */
  onChange: () => void
  /** Refuse a resolved section the owner could not act on; optional on both lines. */
  validate?: (value: T) => void
}

type BrandModule = {
  ToolCallId?: (id: string) => ToolCallId
  CallId?: (id: string) => ToolCallId
}

const brandModule = dshLlm as unknown as BrandModule
const brandFunction: (id: string) => ToolCallId =
  brandModule.ToolCallId ?? brandModule.CallId ?? ((id: string) => id as ToolCallId)

/**
 * Brand a host tool-call id across host generations: `ToolCallId` on
 * 0.1.2-rc.1+, `CallId` before. Both are identity brands at runtime.
 */
export const brandToolCallId: (id: string) => ToolCallId = brandFunction

/**
 * Brand a settings namespace. 0.1.1-rc.2 required `settingsNamespace()` for
 * the branded type; 0.1.2-rc.1 takes plain strings — the brand is a
 * compile-time notion, so one cast serves both.
 */
export function settingsNamespaceCompat(value: string): SettingsNamespace {
  return value as SettingsNamespace
}

type LegacySettingsModule = {
  installSettingsSection?: <T>(
    ctx: Context, ns: SettingsNamespace, schema: z<T>, entry: T, hooks: SettingsSectionHooksLike<T>,
  ) => void
}

type SettingsServiceLike = {
  installSection?: <T>(
    owner: Context, ns: string, schema: z<T>, entry: T, hooks: SettingsSectionHooksLike<T>,
  ) => void
}

/**
 * Register the plugin's settings section on whichever host line is running:
 * `settingsCtx.settings.installSection` on 0.1.2-rc.1+, the standalone
 * `installSettingsSection` export on 0.1.1-rc.2 (both internally wrap the
 * same `ctx.inject(['settings'], ...)` registration).
 * @throws when the host seam exposes neither entry point.
 */
export function installSettingsSectionCompat<T>(
  ctx: Context, ns: string, schema: z<T>, entry: T, hooks: SettingsSectionHooksLike<T>,
): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const service = (settingsCtx as { settings?: unknown }).settings as SettingsServiceLike | undefined
    if (typeof service?.installSection === 'function') {
      service.installSection(ctx, ns, schema, entry, hooks)
      return
    }
    const legacy = (dshSettings as unknown as LegacySettingsModule).installSettingsSection
    if (typeof legacy === 'function') {
      legacy(ctx, settingsNamespaceCompat(ns), schema, entry, hooks)
      return
    }
    throw new Error('llm-qoder: host settings seam has neither installSection nor installSettingsSection')
  })
}
