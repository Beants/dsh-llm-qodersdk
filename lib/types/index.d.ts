/**
 * Register {@link QoderAdapter} for the `qoder` provider route on `ctx.llm`.
 * The inner sessions ride on the local `qodercli` login state through the
 * qoder-agent-sdk, so this plugin needs no credentials or settings section:
 * every Qoder account model is addressable by its SDK value (plus the two
 * `deepseek-v4-*` aliases), and warm inner sessions close with the plugin.
 * @module @deepseek-ai/dsh-llm-qoder
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { QoderAdapter, QODER_PROVIDER } from './adapter.ts';
export { QoderSession, QoderSessionManager } from './session.ts';
export { QODER_MODELS, resolveQoderModelId } from './catalog.ts';
export declare const name = "llm-qoder";
export declare const inject: string[];
/** Plugin config; the adapter works entirely off local qodercli auth. */
export interface Config {
    /** Maximum simultaneously warm inner qodercli sessions. */
    maxSessions?: number;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map