/**
 * Render harness messages into the plain-text turns fed to the inner Qoder
 * session. Tool calls and results need no protocol here — they travel through
 * the in-process MCP server — so this layer only handles conversational
 * context: the host system prompt, user turns, and (for full rebuilds) prior
 * history as compact text.
 * @module dsh-llm-qoder/render
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'

/** Render one content-block list as plain text; non-text blocks get placeholders. */
export function renderBlocks(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text': parts.push(block.text); break
      case 'reasoning': break
      case 'image': parts.push('[图片附件]'); break
      case 'tool-call': parts.push(`[调用了工具 ${block.name}(${block.arguments})]`); break
      case 'tool-result': {
        parts.push(`[工具结果 ${block.toolCallId}] ${renderBlocks(block.content)}`)
        break
      }
      default: parts.push(JSON.stringify(block))
    }
  }
  return parts.join('\n')
}

/** Durable image reference carried by one image content block. */
export type ImageRef = Extract<ContentBlock, { type: 'image' }>['attachment']

/**
 * One feed element: literal text, or an image awaiting byte resolution.
 * Text-only conversations always render as the historical single-string
 * protocol (byte-identical wire format); parts only appear where an image
 * block actually occurs, interleaved in block order.
 */
export type RenderedPart =
  | { type: 'text', text: string }
  | { type: 'image', attachment: ImageRef }

/** Whether a block list contains an image, looking through tool-result content. */
export function contentHasImage(blocks: readonly ContentBlock[]): boolean {
  for (const block of blocks) {
    if (block.type === 'image') return true
    if (block.type === 'tool-result' && contentHasImage(block.content)) return true
  }
  return false
}

/** Render one content-block list as parts; image blocks keep their references. */
export function blockParts(blocks: readonly ContentBlock[]): RenderedPart[] {
  const parts: RenderedPart[] = []
  const texts: string[] = []
  const flush = (): void => {
    if (texts.length > 0) {
      parts.push({ type: 'text', text: texts.join('\n') })
      texts.length = 0
    }
  }
  for (const block of blocks) {
    switch (block.type) {
      case 'text': texts.push(block.text); break
      case 'reasoning': break
      case 'image': flush(); parts.push({ type: 'image', attachment: block.attachment }); break
      case 'tool-call': texts.push(`[调用了工具 ${block.name}(${block.arguments})]`); break
      case 'tool-result': {
        // Mirror renderBlocks' single-line label; tool-result images nest one
        // level deeper, so recurse and flush around them.
        if (contentHasImage(block.content)) {
          flush()
          parts.push({ type: 'text', text: `[工具结果 ${block.toolCallId}]` }, ...blockParts(block.content))
        } else {
          texts.push(`[工具结果 ${block.toolCallId}] ${renderBlocks(block.content)}`)
        }
        break
      }
      default: texts.push(JSON.stringify(block))
    }
  }
  flush()
  return parts
}

/**
 * Assemble feed sections (plain strings or part lists) into the final feed:
 * a single string when no section carries an image — byte-identical to the
 * historical protocol — otherwise parts with text merged around each image.
 */
export function assembleFeed(sections: ReadonlyArray<string | RenderedPart[]>): string | RenderedPart[] {
  const texts: string[] = []
  const parts: RenderedPart[] = []
  let hasImage = false
  for (const section of sections) {
    if (typeof section === 'string') {
      if (section.length > 0) texts.push(section)
      continue
    }
    for (const part of section) {
      if (part.type === 'text') {
        if (part.text.length > 0) texts.push(part.text)
      } else {
        hasImage = true
        if (texts.length > 0) parts.push({ type: 'text', text: texts.splice(0).join('\n\n') })
        parts.push(part)
      }
    }
  }
  if (!hasImage) return texts.join('\n\n')
  if (texts.length > 0) parts.push({ type: 'text', text: texts.join('\n\n') })
  return parts
}

/** Prefix a label onto a part list, merging into its first text part when possible. */
function labeledParts(label: string, parts: RenderedPart[]): RenderedPart[] {
  const [first, ...rest] = parts
  if (first === undefined) return [{ type: 'text', text: label }]
  if (first.type === 'text') return [{ type: 'text', text: `${label}${first.text}` }, ...rest]
  return [{ type: 'text', text: label }, ...parts]
}

/** Render one message as parts (role tag + block parts). */
export function messageParts(message: Message): RenderedPart[] {
  const tag = message.role === 'system' ? '[系统提示] ' : message.role === 'user' ? '[用户] ' : '[助手] '
  return labeledParts(tag, blockParts(message.content))
}

/** Count image references in a block list, looking through tool-result content. */
export function imageRefCount(blocks: readonly ContentBlock[]): number {
  let count = 0
  for (const block of blocks) {
    if (block.type === 'image') count += 1
    else if (block.type === 'tool-result') count += imageRefCount(block.content)
  }
  return count
}

/** Collect image references in block order, looking through tool-result content. */
export function imageRefs(blocks: readonly ContentBlock[]): ImageRef[] {
  const refs: ImageRef[] = []
  for (const block of blocks) {
    if (block.type === 'image') refs.push(block.attachment)
    else if (block.type === 'tool-result') refs.push(...imageRefs(block.content))
  }
  return refs
}

/** Render one message with its role tag. */
export function renderMessage(message: Message): string {
  const text = renderBlocks(message.content)
  switch (message.role) {
    case 'system': return `[系统提示] ${text}`
    case 'user': return `[用户] ${text}`
    case 'assistant': return `[助手] ${text}`
  }
}

/** Preamble establishing the inner model's role as this agent's LLM backend. */
const BACKEND_ROLE = [
  '你在为一个编码 agent（宿主）充当 LLM API 后端：宿主把它的对话喂给你，你只输出"下一条助手回复"本身。',
  '宿主的工具已经通过 MCP 挂进来，需要用工具时直接调用，不要描述你会在别的环境里怎么调。',
  '不要复述对话，不要解释你的角色。',
].join('\n')

/**
 * Compose the first feed for a fresh session: backend role, the host system
 * prompt, and the existing conversation as compact context.
 */
export function renderInitialFeed(system: string | undefined, messages: readonly Message[]): string {
  const parts: string[] = [BACKEND_ROLE]
  if (system !== undefined && system.length > 0) {
    parts.push(`---- 宿主系统提示（作为你的行为准则） ----\n${system}`)
  }
  const history = messages.map(renderMessage).filter(part => part.length > 0)
  if (history.length > 0) parts.push(`---- 宿主对话记录 ----\n${history.join('\n\n')}`)
  parts.push('---- 以上是背景。输出下一条助手回复。 ----')
  return parts.join('\n\n')
}

/**
 * Parts-aware first feed: identical to {@link renderInitialFeed} as a plain
 * string when no history message carries an image; otherwise the history's
 * image references ride as image parts interleaved with the surrounding text.
 */
export function renderInitialFeedParts(system: string | undefined, messages: readonly Message[]): string | RenderedPart[] {
  const sections: Array<string | RenderedPart[]> = [
    BACKEND_ROLE,
    ...system !== undefined && system.length > 0
      ? [`---- 宿主系统提示（作为你的行为准则） ----\n${system}`]
      : [],
  ]
  const history: Array<string | RenderedPart[]> = []
  for (const message of messages) {
    if (contentHasImage(message.content)) {
      history.push(messageParts(message))
    } else {
      const text = renderMessage(message)
      if (text.length > 0) history.push(text)
    }
  }
  const first = history[0]
  if (first !== undefined) {
    history[0] = typeof first === 'string'
      ? `---- 宿主对话记录 ----\n${first}`
      : labeledParts('---- 宿主对话记录 ----\n', first)
    sections.push(...history)
  }
  sections.push('---- 以上是背景。输出下一条助手回复。 ----')
  return assembleFeed(sections)
}

/** Render a brand-new host user turn. */
export function renderUserTurn(blocks: readonly ContentBlock[]): string {
  return `[用户] ${renderBlocks(blocks)}`
}

/** Parts-aware user turn; plain string (identical to renderUserTurn) without images. */
export function renderUserTurnParts(blocks: readonly ContentBlock[]): string | RenderedPart[] {
  if (!contentHasImage(blocks)) return renderUserTurn(blocks)
  return labeledParts('[用户] ', blockParts(blocks))
}

/** Render an in-place-updated message (runtime-context snapshots and the like). */
export function renderRefreshed(message: Message): string {
  return `${renderMessage(message)}\n（宿主原位刷新了这条消息）`
}

/** Parts-aware in-place refresh; plain string (identical to renderRefreshed) without images. */
export function renderRefreshedParts(message: Message): string | RenderedPart[] {
  if (!contentHasImage(message.content)) return renderRefreshed(message)
  return [...messageParts(message), { type: 'text', text: '（宿主原位刷新了这条消息）' }]
}

/** Render a host system-prompt update mid-session. */
export function renderSystemUpdate(system: string): string {
  return `[系统提示(更新)] ${system}`
}

/**
 * Identity override appended to the qodercli preset system prompt: the inner
 * model answers as the host's agent, never as Qoder itself.
 */
export function renderIdentityAppend(hostSystem: string | undefined): string {
  const parts: string[] = [
    '你当前作为一个宿主编码 agent 的内置 LLM 后端运行：对外身份以宿主的设定为准。',
    '当被问及“你是谁”这类身份问题时，按宿主系统提示中的身份回答；不要自称 Qoder，不要提及 qodercli、SDK 或你作为内部后端的事实。',
  ]
  if (hostSystem !== undefined && hostSystem.length > 0) {
    parts.push(`---- 宿主系统提示（作为你的行为准则与对外身份） ----\n${hostSystem}`)
  }
  return parts.join('\n\n')
}
