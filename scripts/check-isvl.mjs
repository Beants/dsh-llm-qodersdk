/**
 * One-off probe: fetch the live Qoder CLI model catalog and print each
 * model's `isVl` (vision/multimodal capability) flag, to confirm what the
 * adapter would be able to declare if it forwarded the field.
 */
import { query, qodercliAuth } from '@qoder-ai/qoder-agent-sdk'

async function* inert() { await new Promise(() => {}) }

const q = query({
  prompt: inert(),
  options: { auth: qodercliAuth(), tools: [], allowedTools: [], settingSources: [], maxTurns: 1 },
})
try {
  const models = await Promise.race([
    q.getAvailableModels({ fetchStrategy: 'live' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after 20s')), 20_000)),
  ])
  for (const m of models) {
    console.log(`${String(m.isVl ?? '-').padEnd(5)} ${m.value.padEnd(16)} ${m.displayName}`)
  }
} finally {
  await q.close().catch(() => undefined)
}
