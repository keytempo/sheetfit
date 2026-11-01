import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Runs the evidence reports in src/packing/bench. They print tables and take a few minutes. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.report.ts'],
    environment: 'node',
    testTimeout: 20 * 60 * 1000,
  },
})
