/**
 * `QoderAdapter`: route the harness LLM seam onto a local Qoder CLI account
 * through the qoder-agent-sdk. One warm inner session per host session id
 * carries the conversation (model turns and tool rounds live inside it); host
 * tool schemas are exposed to the inner model through an in-process MCP
 * server whose handlers park until the host delivers tool results on the next
 * request. Side-channel requests (titles, compaction) run cold one-shots.
 * @module dsh-llm-qoder/adapter
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
/** Options for {@link QoderAdapter}. */
export interface QoderAdapterOptions {
    /** Maximum simultaneously warm inner sessions (default 8). */
    maxSessions?: number;
}
/** The single provider route this adapter owns. */
export declare const QODER_PROVIDER = "qoder";
/**
 * The Qoder-backed adapter. Session continuity, tool parking, and feed
 * planning live here; chunk synthesis lives in the session's consumer.
 */
export declare class QoderAdapter extends LlmAdapter {
    private readonly sessions;
    constructor(options?: QoderAdapterOptions);
    providerInfo(provider: string): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private firstTurn;
    /** Tear down every warm inner session (plugin dispose). */
    close(): void;
}
//# sourceMappingURL=adapter.d.ts.map