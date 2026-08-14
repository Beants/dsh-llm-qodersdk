/**
 * Static Qoder model catalog (from `getAvailableModels()` on the account,
 * 2026-08). Advisory only: requests carry any model id through to the SDK's
 * per-session `resolveModel`, and unknown ids fall back to `auto`.
 * @module dsh-llm-qoder/catalog
 */
/** One Qoder CLI model entry. */
export interface QoderCatalogModel {
    id: string;
    name: string;
    description?: string;
}
/** Default combined context capacity assumed for Qoder-backed models. */
export declare const DEFAULT_CONTEXT_WINDOW = 200000;
/** Default per-request output cap assumed for Qoder-backed models. */
export declare const DEFAULT_MAX_TOKENS = 32000;
/** Every model the account exposed at capture time, in SDK display order. */
export declare const QODER_MODELS: readonly QoderCatalogModel[];
/**
 * Convenience aliases so a dsh deployment can keep using its own DeepSeek
 * model names against the Qoder route.
 */
export declare const MODEL_ALIASES: Readonly<Record<string, string>>;
/**
 * Map a dsh-side model id onto a Qoder SDK model value.
 * @param model - model id from {@link import('@deepseek-ai/dsh-llm').GenerateOptions.model}.
 * @returns the Qoder model value: a catalog hit, an alias expansion, or `auto`.
 */
export declare function resolveQoderModelId(model: string): string;
//# sourceMappingURL=catalog.d.ts.map