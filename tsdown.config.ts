import { defineConfig } from 'tsdown'

/**
 * Bundle the plugin to the runtime entry the package.json exports point at
 * (lib/index.js). Peer and runtime dependencies stay external; the .d.ts
 * declarations come from `tsc` (see tsconfig.json).
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/schemastery',
    '@qoder-ai/qoder-agent-sdk',
    'zod',
  ],
})
