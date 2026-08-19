/**
 * JSON Schema → zod conversion: recognized constructs, loose fallbacks, and
 * the requirement split between required and optional properties.
 */
import { describe, expect, it } from 'vitest'
import { jsonSchemaToShape, jsonSchemaToZod } from '../src/jsonschema.ts'

describe('jsonSchemaToZod', () => {
  it('maps undefined to unknown', () => {
    expect(jsonSchemaToZod(undefined).safeParse('anything').success).toBe(true)
  })

  it('caps recursion depth', () => {
    const nested: Record<string, unknown> = { type: 'object', properties: {} }
    let schema: Record<string, unknown> = nested
    for (let i = 0; i < 10; i++) {
      schema = { type: 'object', properties: { next: nested } }
      nested.properties = schema
    }
    expect(jsonSchemaToZod(schema, 6).safeParse({ next: { next: { next: {} } } }).success).toBe(true)
  })

  it('converts string enums into enum schemas', () => {
    const schema = jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] })
    expect(schema.safeParse('a').success).toBe(true)
    expect(schema.safeParse('c').success).toBe(false)
  })

  it('falls back to unknown for mixed or empty enums', () => {
    expect(jsonSchemaToZod({ enum: ['a', 1] }).safeParse(1).success).toBe(true)
    expect(jsonSchemaToZod({ enum: [] }).safeParse('anything').success).toBe(true)
  })

  it('converts scalar types with their value rules', () => {
    expect(jsonSchemaToZod({ type: 'string' }).safeParse('s').success).toBe(true)
    expect(jsonSchemaToZod({ type: 'number' }).safeParse(1.5).success).toBe(true)
    expect(jsonSchemaToZod({ type: 'integer' }).safeParse(1.5).success).toBe(false)
    expect(jsonSchemaToZod({ type: 'integer' }).safeParse(1).success).toBe(true)
    expect(jsonSchemaToZod({ type: 'boolean' }).safeParse(true).success).toBe(true)
  })

  it('recurses into array items', () => {
    const schema = jsonSchemaToZod({ type: 'array', items: { type: 'integer' } })
    expect(schema.safeParse([1, 2]).success).toBe(true)
    expect(schema.safeParse([1.5]).success).toBe(false)
  })

  it('handles arrays without items', () => {
    expect(jsonSchemaToZod({ type: 'array' }).safeParse([1, 'x']).success).toBe(true)
  })

  it('maps unknown types to unknown', () => {
    expect(jsonSchemaToZod({ type: 'file' }).safeParse({ path: '/x' }).success).toBe(true)
  })

  it('attaches the description', () => {
    const schema = jsonSchemaToZod({ type: 'string', description: 'the name' })
    expect(schema.description).toBe('the name')
  })
})

describe('jsonSchemaToShape', () => {
  it('returns an empty shape without properties', () => {
    expect(jsonSchemaToShape({ type: 'object' })).toEqual({})
    expect(jsonSchemaToShape({})).toEqual({})
  })

  it('keeps required properties required', () => {
    const shape = jsonSchemaToShape({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })
    const object = shape.name !== undefined ? shape.name.safeParse('x') : undefined
    expect(object?.success).toBe(true)
    const missing = shape.name !== undefined ? shape.name.safeParse(undefined) : undefined
    expect(missing?.success).toBe(false)
  })

  it('makes unlisted properties optional', () => {
    const shape = jsonSchemaToShape({
      type: 'object',
      properties: { note: { type: 'string' } },
    })
    const optional = shape.note
    expect(optional?.safeParse(undefined).success).toBe(true)
    expect(optional?.safeParse('n').success).toBe(true)
  })
})
