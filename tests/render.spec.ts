/**
 * Feed rendering: block, message, and feed composition pure functions.
 */
import { describe, expect, it } from 'vitest'
import { CallId, MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import {
  assembleFeed, blockParts, contentHasImage, imageRefCount, imageRefs, renderBlocks, renderIdentityAppend,
  renderInitialFeed, renderInitialFeedParts, renderMessage, renderRefreshed, renderRefreshedParts,
  renderSystemUpdate, renderUserTurn, renderUserTurnParts,
} from '../src/render.ts'

function text(content: string): ContentBlock {
  return { type: 'text', text: content }
}

function image(id: string): ContentBlock {
  return {
    type: 'image',
    attachment: { attachmentId: id, mediaType: 'image/png', bytes: 3, width: 2, height: 2 },
  } as ContentBlock
}

function userMessage(content: ContentBlock[], extra: Partial<Message> = {}): Message {
  return {
    id: MessageId('m1'),
    role: 'user',
    content,
    source: { kind: 'user' },
    ...extra,
  }
}

describe('renderBlocks', () => {
  it('joins text blocks with newlines', () => {
    expect(renderBlocks([text('a'), text('b')])).toBe('a\nb')
  })

  it('skips reasoning blocks', () => {
    expect(renderBlocks([text('a'), { type: 'reasoning', text: 'think' }])).toBe('a')
  })

  it('renders image blocks as placeholders', () => {
    expect(renderBlocks([{ type: 'image', attachment: { attachmentId: 'x', mimeType: 'image/png', byteLength: 1, width: 1, height: 1 } }])).toBe('[图片附件]')
  })

  it('renders tool calls as placeholders', () => {
    expect(renderBlocks([{ type: 'tool-call', id: CallId('c1'), name: 'read', arguments: '{"path":"a"}' }]))
      .toBe('[调用了工具 read({"path":"a"})]')
  })

  it('renders tool results recursively', () => {
    expect(renderBlocks([{ type: 'tool-result', toolCallId: CallId('c1'), content: [text('ok')] }]))
      .toBe('[工具结果 c1] ok')
  })

  it('serializes unknown blocks as JSON', () => {
    expect(renderBlocks([{ type: 'bogus' } as unknown as ContentBlock])).toBe('{"type":"bogus"}')
  })
})

describe('renderMessage', () => {
  it('tags system, user, and assistant roles', () => {
    const system = userMessage([text('s')], { role: 'system', source: { kind: 'plugin', plugin: 'test' } })
    const assistant = userMessage([text('a')], {
      role: 'assistant',
      source: { kind: 'model', provider: 'qoder', model: 'dmodel' },
    })
    expect(renderMessage(system)).toBe('[系统提示] s')
    expect(renderMessage(userMessage([text('u')]))).toBe('[用户] u')
    expect(renderMessage(assistant)).toBe('[助手] a')
  })
})

describe('renderInitialFeed', () => {
  it('includes the backend role even without system or history', () => {
    const feed = renderInitialFeed(undefined, [])
    expect(feed).toContain('你在为一个编码 agent（宿主）充当 LLM API 后端')
    expect(feed).toContain('输出下一条助手回复')
  })

  it('embeds the host system prompt when present', () => {
    const feed = renderInitialFeed('你是 Qoder', [])
    expect(feed).toContain('---- 宿主系统提示（作为你的行为准则） ----\n你是 Qoder')
  })

  it('renders prior history as compact context', () => {
    const feed = renderInitialFeed(undefined, [userMessage([text('hi')])])
    expect(feed).toContain('---- 宿主对话记录 ----\n[用户] hi')
  })
})

describe('turn rendering', () => {
  it('renders a brand-new user turn', () => {
    expect(renderUserTurn([text('hi')])).toBe('[用户] hi')
  })

  it('marks an in-place refresh', () => {
    expect(renderRefreshed(userMessage([text('x')]))).toBe('[用户] x\n（宿主原位刷新了这条消息）')
  })

  it('marks a mid-session system update', () => {
    expect(renderSystemUpdate('new rules')).toBe('[系统提示(更新)] new rules')
  })
})

describe('renderIdentityAppend', () => {
  it('forbids Qoder self-identification without a host system', () => {
    const append = renderIdentityAppend(undefined)
    expect(append).toContain('不要自称 Qoder')
    expect(append).not.toContain('---- 宿主系统提示（作为你的行为准则与对外身份） ----')
  })

  it('embeds the host system when present', () => {
    const append = renderIdentityAppend('你是宿主')
    expect(append).toContain('---- 宿主系统提示（作为你的行为准则与对外身份） ----\n你是宿主')
  })
})

describe('vision part rendering', () => {
  it('detects images, nested in tool results', () => {
    expect(contentHasImage([text('a')])).toBe(false)
    expect(contentHasImage([image('i1')])).toBe(true)
    expect(contentHasImage([{ type: 'tool-result', toolCallId: CallId('c1'), content: [image('i1')] }])).toBe(true)
    expect(imageRefCount([text('a'), image('i1'), image('i2')])).toBe(2)
    expect(imageRefs([{ type: 'tool-result', toolCallId: CallId('c1'), content: [image('i2'), text('t')] }, image('i1')])
      .map(ref => String(ref.attachmentId))).toEqual(['i2', 'i1'])
  })

  it('keeps image references as parts in block order', () => {
    expect(blockParts([text('look'), image('i1'), text('here')])).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', attachment: { attachmentId: 'i1', mediaType: 'image/png', bytes: 3, width: 2, height: 2 } },
      { type: 'text', text: 'here' },
    ])
  })

  it('labels a user turn around the image', () => {
    expect(renderUserTurnParts([text('look'), image('i1')])).toEqual([
      { type: 'text', text: '[用户] look' },
      { type: 'image', attachment: { attachmentId: 'i1', mediaType: 'image/png', bytes: 3, width: 2, height: 2 } },
    ])
  })

  it('assembles all-text sections back into the identical string', () => {
    expect(assembleFeed(['a', 'b'])).toBe('a\n\nb')
    expect(assembleFeed(['a', [], 'b'])).toBe('a\n\nb')
  })

  it('assembles image sections as interleaved parts', () => {
    expect(assembleFeed([
      'role',
      [{ type: 'text', text: '[用户] look' }, { type: 'image', attachment: { attachmentId: 'i1', mediaType: 'image/png', bytes: 3, width: 2, height: 2 } }],
      'closing',
    ])).toEqual([
      { type: 'text', text: 'role\n\n[用户] look' },
      { type: 'image', attachment: { attachmentId: 'i1', mediaType: 'image/png', bytes: 3, width: 2, height: 2 } },
      { type: 'text', text: 'closing' },
    ])
  })

  it('renders the initial feed as a plain string without images', () => {
    expect(renderInitialFeedParts('sys', [userMessage([text('hi')])]))
      .toBe(renderInitialFeed('sys', [userMessage([text('hi')])]))
  })

  it('keeps history images as parts in the initial feed', () => {
    const feed = renderInitialFeedParts(undefined, [userMessage([text('look'), image('i1')])])
    expect(Array.isArray(feed)).toBe(true)
    const parts = feed as ReturnType<typeof blockParts>
    expect(parts.some(part => part.type === 'image')).toBe(true)
    expect(JSON.stringify(parts)).toContain('---- 宿主对话记录 ----')
    expect(JSON.stringify(parts)).toContain('look')
  })

  it('marks a refreshed message with images as parts', () => {
    const feed = renderRefreshedParts(userMessage([image('i1')]))
    expect(Array.isArray(feed)).toBe(true)
    expect((feed as ReturnType<typeof blockParts>).at(-1)).toEqual({ type: 'text', text: '（宿主原位刷新了这条消息）' })
  })
})
