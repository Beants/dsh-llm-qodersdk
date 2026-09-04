/**
 * Register {@link QoderAdapter} for the `qoder` and `qoder-byok` provider
 * routes on `ctx.llm`. The inner sessions ride on the local `qodercli` login
 * state through the qoder-agent-sdk: the advertised model catalog is fetched
 * live from the CLI and split into the account's built-in models (`qoder`)
 * and its custom models (`qoder-byok`), every model is addressable by its SDK
 * value (plus the two `deepseek-v4-*` aliases), and warm inner sessions close
 * with the plugin.
 * @module @jiamingzang/dsh-llm-qoder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSectionCompat, settingsNamespaceCompat } from './compat.ts'
import { QoderAdapter, QODER_BYOK_PROVIDER, QODER_PROVIDER } from './adapter.ts'
import type { AttachmentStoreLike } from './adapter.ts'

export { QoderAdapter, QODER_PROVIDER, QODER_BYOK_PROVIDER } from './adapter.ts'
export { QoderSession, QoderSessionManager } from './session.ts'
export { QODER_MODELS, resolveQoderModelId } from './catalog.ts'
export { QoderModelCatalog } from './models.ts'

export const name = 'llm-qoder'
export const inject = ['llm']

const NS = settingsNamespaceCompat('llm-qoder')

/** Plugin config; the adapter works entirely off local qodercli auth. */
export interface Config {
  /** Maximum simultaneously warm inner qodercli sessions. */
  maxSessions?: number
  /** Seconds a fetched CLI model catalog stays fresh before re-fetching. */
  modelCacheTtlSeconds?: number
  /**
   * Override the effective context window (tokens). Applied on BOTH sides so
   * they never diverge: reported to the host via resolveModel (compaction
   * threshold + context meter) and pushed into every inner session's model
   * policy (warm pull-mode callback and one-shot side channels). Clamped by
   * the live model's maxInputTokens ceiling. Absent → the CLI default (200K).
   */
  contextWindow?: number
}

export const Config: z<Config> = z.object({
  maxSessions: z.number().step(1).min(1).max(64).default(8),
  modelCacheTtlSeconds: z.number().step(1).min(10).max(86_400).default(300),
  contextWindow: z.number().step(1).min(16_384).max(4_000_000),
})

export function apply(ctx: Context, config: Config): void {
  const adapter = new QoderAdapter({
    maxSessions: config.maxSessions ?? 8,
    modelCacheTtlMs: (config.modelCacheTtlSeconds ?? 300) * 1000,
    ...config.contextWindow === undefined ? {} : { contextWindow: config.contextWindow },
    // Lazy lookup per request: 'attachments' is provided by dsh-attachment-local
    // when present; an absent store degrades images to placeholder text
    // instead of failing the turn (and without making it a hard inject).
    resolveAttachments: () => {
      try { return ctx.get('attachments') as unknown as AttachmentStoreLike | undefined } catch { return undefined }
    },
  })
  ctx.llm.registerAdapter([QODER_PROVIDER, QODER_BYOK_PROVIDER], adapter)
  // Declare the routes in the configurable-provider directory so selection
  // surfaces (the composer model seat, the Models settings page) render the
  // Qoder groups with their display names instead of anonymous routes.
  ctx.llm.registerConfigurableProviders([
    { provider: QODER_PROVIDER, displayName: 'Qoder CLI', settingsNs: NS, settingsPath: [] },
    { provider: QODER_BYOK_PROVIDER, displayName: 'Qoder 自定义', settingsNs: NS, settingsPath: [] },
  ])
  let effective: Config = config
  installSettingsSectionCompat(ctx, NS, Config, config, {
    // The settings service is the ONLY bridge for user-layer values: the
    // profile loader hands apply() just the bundle-declared base, so without
    // these hooks a settings.yaml section would never reach the adapter. The
    // hooks fire at attach, on every committed change, and at detach — the
    // chokidar watcher on settings.yaml keeps hand edits live too.
    setSource: (current) => { effective = current() },
    onChange: () => {
      adapter.configure({
        maxSessions: effective.maxSessions ?? 8,
        modelCacheTtlMs: (effective.modelCacheTtlSeconds ?? 300) * 1000,
        ...effective.contextWindow === undefined ? {} : { contextWindow: effective.contextWindow },
      })
    },
  })
  // registerAdapter's disposer only withdraws the routes; the warm qodercli
  // subprocesses are owned by the adapter and must close with the plugin.
  ctx.effect(() => () => adapter.close(), 'llm-qoder.sessions')
}
