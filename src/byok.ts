/**
 * BYOK (Bring Your Own Key) support: configure external third-party models
 * (provider + model + API key) through qodercli, surface them in the harness
 * model picker, and route their calls through the external provider via the
 * SDK's per-call `custom_model` payload. The qodercli itself stores no BYOK
 * state — the provider catalog is server-side and credentials ride each call
 * — so the configured entries live in the plugin settings section.
 * @module dsh-llm-qoder/byok
 */

import { qodercliAuth, query } from '@qoder-ai/qoder-agent-sdk'
import type {
  BYOKModelInfo, BYOKModelValidationInput, BYOKProviderInfo, CustomModel,
} from '@qoder-ai/qoder-agent-sdk'

/** One configured BYOK model: a third-party provider/model pair plus the user's API key. */
export interface ByokModelConfig {
  /** BYOK provider identifier from the qodercli catalog (e.g. "bailian", "kimi", "deepseek"). */
  provider: string
  /** Third-party model key from the provider catalog (e.g. "qwen3.8-max-tp"). */
  model: string
  /** Optional display name shown in the harness picker. */
  name?: string
  /** User-supplied third-party API key. */
  apiKey: string
  /** Optional provider base URL override. */
  url?: string
  /** Provider wire format; the SDK defaults this to "openai" before forwarding. */
  style?: string
}

/** Prefix marking a harness model id as a BYOK model. */
export const BYOK_ID_PREFIX = 'byok:'

/** Stable harness model id for one BYOK configuration. */
export function byokModelId(provider: string, model: string): string {
  return `${BYOK_ID_PREFIX}${provider}:${model}`
}

/** Parse a harness model id back to the BYOK provider/model pair. */
export function parseByokModelId(id: string): { provider: string, model: string } | undefined {
  if (!id.startsWith(BYOK_ID_PREFIX)) return undefined
  const rest = id.slice(BYOK_ID_PREFIX.length)
  const colon = rest.indexOf(':')
  if (colon <= 0 || colon === rest.length - 1) return undefined
  return { provider: rest.slice(0, colon), model: rest.slice(colon + 1) }
}

/** The configured entry backing one harness model id, if it is still present. */
export function byokEntryFor(
  entries: readonly ByokModelConfig[],
  model: string,
): ByokModelConfig | undefined {
  const parsed = parseByokModelId(model)
  if (parsed === undefined) return undefined
  return entries.find(entry => entry.provider === parsed.provider && entry.model === parsed.model)
}

/**
 * Per-call credential payload for one configured entry. Returned from the
 * inner session's `resolveModel` so the CLI dispatches the LLM call through
 * the third-party provider with this API key.
 */
export function customModelFor(entry: ByokModelConfig): CustomModel & { model: string } {
  return {
    provider: entry.provider,
    api_key: entry.apiKey,
    model: entry.model,
    ...entry.url === undefined ? {} : { url: entry.url },
    ...entry.style === undefined ? {} : { style: entry.style },
  }
}

/** Streaming prompt that never yields, so no model turn runs during the fetch. */
async function* inertInput(): AsyncGenerator<never> {
  await new Promise<never>(() => {})
}

/** Give up on one qodercli BYOK request after this long. */
const FETCH_TIMEOUT_MS = 20_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`qoder BYOK request timed out after ${ms}ms`)) }, ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * Fetch the server-side BYOK provider catalog through one short-lived CLI
 * session. Returns `null` when the CLI does not support the request.
 */
export async function fetchByokProviders(): Promise<BYOKProviderInfo[] | null> {
  const q = query({
    prompt: inertInput(),
    options: { auth: qodercliAuth(), tools: [], allowedTools: [], settingSources: [], maxTurns: 1 },
  })
  try {
    return await withTimeout(q.listByokProviders(), FETCH_TIMEOUT_MS)
  } finally {
    await q.close().catch(() => undefined)
  }
}

/**
 * Ask qodercli to validate a BYOK provider/model/API-key combination. Returns
 * `true` for a valid configuration, `false` for a rejected one, and `null`
 * when the running CLI does not support the control request.
 */
export async function validateByokModel(input: BYOKModelValidationInput): Promise<boolean | null> {
  const q = query({
    prompt: inertInput(),
    options: { auth: qodercliAuth(), tools: [], allowedTools: [], settingSources: [], maxTurns: 1 },
  })
  try {
    return await withTimeout(q.validateByokModel(input), FETCH_TIMEOUT_MS)
  } finally {
    await q.close().catch(() => undefined)
  }
}

/** Cached BYOK provider catalog used to enrich configured entries. */
export class QoderByokCatalog {
  private cached: { at: number, providers: readonly BYOKProviderInfo[] } | undefined
  private inflight: Promise<readonly BYOKProviderInfo[]> | undefined

  /** @param ttlMs - how long a fetched catalog stays fresh before a re-fetch. */
  constructor(private readonly ttlMs: number) {}

  /** Raw catalog entries; the stale snapshot when a refresh fails, else nothing. */
  async providers(): Promise<readonly BYOKProviderInfo[]> {
    const cached = this.cached
    if (cached !== undefined && Date.now() - cached.at < this.ttlMs) return cached.providers
    this.inflight ??= this.fetch().finally(() => { this.inflight = undefined })
    try {
      const providers = await this.inflight
      this.cached = { at: Date.now(), providers }
      return providers
    } catch {
      return this.cached?.providers ?? []
    }
  }

  /** Catalog metadata for one BYOK provider/model key, when the catalog knows it. */
  async find(provider: string, model: string): Promise<BYOKModelInfo | undefined> {
    for (const entry of await this.providers()) {
      if (entry.key !== provider) continue
      for (const type of entry.types ?? []) {
        const hit = (type.models ?? []).find(candidate => candidate.key === model)
        if (hit !== undefined) return hit
      }
    }
    return undefined
  }

  private async fetch(): Promise<readonly BYOKProviderInfo[]> {
    return (await fetchByokProviders()) ?? []
  }
}
