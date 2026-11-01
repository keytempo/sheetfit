import { test } from 'vitest'
import { packLayout } from '../pack.ts'
import { suite } from './suite.ts'

/** Time to the first (synchronous) result, for the families the report uses, at three sizes. */
for (const pieces of [100, 500, 2000]) {
  test(`first result, about ${pieces} pieces`, { timeout: 600_000 }, async ({ bench }) => {
    const registrations = suite(pieces).map(({ family, input }) =>
      bench(`${family} (${input.pieces.length})`, () => {
        packLayout(input)
      }),
    )
    await bench.compare(...registrations)
  })
}
