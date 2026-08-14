/**
 * Register {@link QoderAdapter} for the `qoder` provider route on `ctx.llm`.
 * The inner sessions ride on the local `qodercli` login state through the
 * qoder-agent-sdk, so this plugin needs no credentials or settings section:
 * the advertised model catalog is fetched live from the CLI (including the
 * account's custom models), every model is addressable by its SDK value
 * (plus the two `deepseek-v4-*` aliases), and warm inner sessions close
 * with the plugin.
 * @module @deepseek-ai/dsh-llm-qoder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { QoderAdapter, QODER_PROVIDER } from './adapter.ts'

export { QoderAdapter, QODER_PROVIDER } from './adapter.ts'
export { QoderSession, QoderSessionManager } from './session.ts'
export { QODER_MODELS, resolveQoderModelId } from './catalog.ts'
export { QoderModelCatalog } from './models.ts'

export const name = 'llm-qoder'
export const inject = ['llm']

/** Plugin config; the adapter works entirely off local qodercli auth. */
export interface Config {
  /** Maximum simultaneously warm inner qodercli sessions. */
  maxSessions?: number
  /** Seconds a fetched CLI model catalog stays fresh before re-fetching. */
  modelCacheTtlSeconds?: number
}

export const Config: z<Config> = z.object({
  maxSessions: z.number().step(1).min(1).max(64).default(8),
  modelCacheTtlSeconds: z.number().step(1).min(10).max(86_400).default(300),
})

export function apply(ctx: Context, config: Config): void {
  const adapter = new QoderAdapter({
    maxSessions: config.maxSessions ?? 8,
    modelCacheTtlMs: (config.modelCacheTtlSeconds ?? 300) * 1000,
  })
  ctx.llm.registerAdapter([QODER_PROVIDER], adapter)
  // Declare the route in the configurable-provider directory so selection
  // surfaces (the composer model seat, the Models settings page) render the
  // Qoder group with its display name instead of an anonymous route.
  ctx.llm.registerConfigurableProviders([
    { provider: QODER_PROVIDER, displayName: 'Qoder CLI', settingsNs: 'llm-qoder', settingsPath: [] },
  ])
  // registerAdapter's disposer only withdraws the routes; the warm qodercli
  // subprocesses are owned by the adapter and must close with the plugin.
  ctx.effect(() => () => adapter.close(), 'llm-qoder.sessions')
}
