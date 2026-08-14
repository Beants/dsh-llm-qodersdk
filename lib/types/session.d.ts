/**
 * One long-lived inner Qoder CLI session per host session id: a channel-fed
 * `query()` subprocess whose model continuation streams out as harness
 * `StreamChunk`s. Host tool calls travel through an in-process MCP server:
 * the handler parks on a promise, the adapter finishes the turn with
 * `tool-calls`, and the next host request (carrying tool results) resolves
 * the parked promise so the inner model continues with the result in place.
 * @module dsh-llm-qoder/session
 */
import type { GenerateOptions, Message, StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm';
/** MCP server name this adapter exposes host tools under. */
export declare const MCP_SERVER_NAME = "dsh-host";
/**
 * One warm inner session. All mutation happens on the consumer fiber except
 * the documented turn lifecycle driven by {@link stream}.
 */
export declare class QoderSession {
    readonly sessionId: string;
    private readonly channel;
    /**
     * Lazy: the MCP SDK refuses tool registration after the transport connects,
     * so the inner process only spawns once {@link ensureTools} has registered
     * the host tools (the adapter does that immediately before each stream).
     */
    private q;
    /**
     * Tool-call pairing state. qodercli executes calls one at a time and only
     * invokes the NEXT handler after the previous MCP round trip completes,
     * while the host delivers ALL results of a turn up front on the next
     * request — so results buffer by callId and handlers claim their callId
     * from the emission-order queue when they fire.
     */
    private readonly parked;
    private readonly pendingResults;
    private readonly openCalls;
    private readonly mcp;
    private readonly registered;
    private queue;
    private model;
    private callCounter;
    private abortPending;
    private disposed;
    /** Previous request's messages for delta feeding. */
    fedMessages: readonly Message[] | undefined;
    fedSystem: string | undefined;
    fedChars: number;
    private blockIndex;
    private textBlock;
    private reasoningBlock;
    private openTool;
    private toolCalls;
    private outputChars;
    private reasoningChars;
    constructor(sessionId: string, initialModel: string);
    /** Spawn the inner process (first stream only) and attach the consumer. */
    private ensureStarted;
    /** Point the session at a model for the next turn (SDK re-resolves per request). */
    setModel(model: string): void;
    /** Register any host tools not yet known to this session's MCP server. */
    ensureTools(tools: readonly ToolSchema[]): void;
    /** Deliver host tool results to parked/buffered handlers, keyed by callId. */
    deliverToolResults(tail: readonly Message[]): void;
    /** Run one inner turn: feed (if any) then pump consumer chunks until finish. */
    stream(options: GenerateOptions, feed: string | null): AsyncGenerator<StreamChunk>;
    /** Tear the inner process down; parked calls die with it. */
    close(): void;
    private resetTurnState;
    private emit;
    private usage;
    private endTurn;
    private consume;
    private handle;
}
/**
 * Warm-session registry with insertion-order LRU eviction, plus the cold
 * one-shot path for side-channel requests (titles, compaction).
 */
export declare class QoderSessionManager {
    readonly maxSessions: number;
    private readonly sessions;
    constructor(maxSessions?: number);
    /** Existing or fresh warm session for one host session id. */
    forSession(sessionId: string, model: string): QoderSession;
    /** Drop one session (history diverged); the next request rebuilds it cold. */
    dispose(sessionId: string): void;
    closeAll(): void;
    /** One-shot turn with no warm state: side channels and cold rebuilds. */
    coldStream(options: GenerateOptions, prompt: string, model: string): AsyncGenerator<StreamChunk>;
}
//# sourceMappingURL=session.d.ts.map