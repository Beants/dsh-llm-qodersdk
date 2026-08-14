/**
 * Render harness messages into the plain-text turns fed to the inner Qoder
 * session. Tool calls and results need no protocol here — they travel through
 * the in-process MCP server — so this layer only handles conversational
 * context: the host system prompt, user turns, and (for full rebuilds) prior
 * history as compact text.
 * @module dsh-llm-qoder/render
 */
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
/** Render one content-block list as plain text; non-text blocks get placeholders. */
export declare function renderBlocks(blocks: readonly ContentBlock[]): string;
/** Render one message with its role tag. */
export declare function renderMessage(message: Message): string;
/**
 * Compose the first feed for a fresh session: backend role, the host system
 * prompt, and the existing conversation as compact context.
 */
export declare function renderInitialFeed(system: string | undefined, messages: readonly Message[]): string;
/** Render a brand-new host user turn. */
export declare function renderUserTurn(blocks: readonly ContentBlock[]): string;
/** Render an in-place-updated message (runtime-context snapshots and the like). */
export declare function renderRefreshed(message: Message): string;
/** Render a host system-prompt update mid-session. */
export declare function renderSystemUpdate(system: string): string;
//# sourceMappingURL=render.d.ts.map