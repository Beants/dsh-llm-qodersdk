/**
 * Register {@link QoderAdapter} for the `qoder` provider route on `ctx.llm`.
 * The inner sessions ride on the local `qodercli` login state through the
 * qoder-agent-sdk: the advertised model catalog is fetched live from the CLI
 * (including the account's custom models), every model is addressable by its
 * SDK value (plus the two `deepseek-v4-*` aliases), and warm inner sessions
 * close with the plugin. The `llm-qoder` settings section additionally
 * carries the BYOK (external model) list, so the harness Models page can add
 * third-party models backed by the user's own API keys.
 * @module @deepseek-ai/dsh-llm-qoder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { QoderAdapter, QODER_BYOK_PROVIDER, QODER_PROVIDER } from './adapter.ts'
import type { ByokModelConfig } from './byok.ts'

export { QoderAdapter, QODER_PROVIDER, QODER_BYOK_PROVIDER } from './adapter.ts'
export { QoderSession, QoderSessionManager } from './session.ts'
export { QODER_MODELS, resolveQoderModelId } from './catalog.ts'
export { QoderModelCatalog } from './models.ts'
export {
  BYOK_ID_PREFIX, QoderByokCatalog, byokModelId, customModelFor, fetchByokProviders,
  parseByokModelId, validateByokModel,
} from './byok.ts'
export type { ByokModelConfig } from './byok.ts'

export const name = 'llm-qoder'
export const inject = ['llm']

const NS = settingsNamespace('llm-qoder')

/** One BYOK entry's settings shape (provider/model/api key). */
const byokModel: z<ByokModelConfig> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  name: z.string(),
  apiKey: z.string().required(),
  url: z.string(),
  style: z.string(),
})

/** Plugin config; the adapter works entirely off local qodercli auth. */
export interface Config {
  /** Maximum simultaneously warm inner qodercli sessions. */
  maxSessions?: number
  /** Seconds a fetched CLI model catalog stays fresh before re-fetching. */
  modelCacheTtlSeconds?: number
  /** External (BYOK) models configured through qodercli. */
  byok?: ByokModelConfig[]
}

export const Config: z<Config> = z.object({
  maxSessions: z.number().step(1).min(1).max(64).default(8),
  modelCacheTtlSeconds: z.number().step(1).min(10).max(86_400).default(300),
  byok: z.array(byokModel).default([]),
})

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  const adapter = new QoderAdapter({
    maxSessions: config.maxSessions ?? 8,
    modelCacheTtlMs: (config.modelCacheTtlSeconds ?? 300) * 1000,
    byokModels: () => current().byok ?? [],
  })
  ctx.llm.registerAdapter([QODER_PROVIDER, QODER_BYOK_PROVIDER], adapter)
  // Declare the routes in the configurable-provider directory so selection
  // surfaces (the composer model seat, the Models settings page) render the
  // Qoder groups with their display names instead of anonymous routes.
  ctx.llm.registerConfigurableProviders([
    { provider: QODER_PROVIDER, displayName: 'Qoder CLI', settingsNs: NS, settingsPath: [] },
    { provider: QODER_BYOK_PROVIDER, displayName: 'Qoder 自定义', settingsNs: NS, settingsPath: [] },
  ])
  // Live BYOK entries: the settings section replaces the source thunk, so the
  // picker and per-call routing see edits without a restart.
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
  })
  // registerAdapter's disposer only withdraws the routes; the warm qodercli
  // subprocesses are owned by the adapter and must close with the plugin.
  ctx.effect(() => () => adapter.close(), 'llm-qoder.sessions')
}
