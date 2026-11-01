import { describe, expect, it } from 'vitest'
import type { LayoutResult } from '../lib/layout-types.ts'
import { packLayout } from './pack.ts'
import { Random } from './random.ts'
import { refineLayout } from './refine.ts'
import { randomInput } from './testing/generators.ts'
import { objectiveOf, sameLayout, strictlyBetter } from './testing/helpers.ts'
import { validateLayout } from './testing/validate.ts'

const SYNC_INSTANCES = 2000
const REFINE_INSTANCES = 300

/** A published update either improves the layout or only upgrades its status to optimal. */
function isValidUpdate(next: LayoutResult, previous: LayoutResult) {
  if (strictlyBetter(next, previous)) return true
  const a = objectiveOf(next)
  const b = objectiveOf(previous)
  return (
    next.status === 'optimal' &&
    previous.status === 'best-found' &&
    a.sheets === b.sheets &&
    Math.abs(a.minUsed - b.minUsed) < 1e-9
  )
}

describe('fuzz: the synchronous packer', () => {
  it(`keeps every rule on ${SYNC_INSTANCES} random instances, deterministically`, () => {
    const failures: string[] = []
    // The generator is only a fair test if it really produces every case it claims to.
    const seen = {
      strict: 0,
      optimize: 0,
      auto: 0,
      noRotation: 0,
      unplaceable: 0,
      noUsableArea: 0,
      multiSheet: 0,
      empty: 0,
    }
    for (let seed = 1; seed <= SYNC_INSTANCES; seed++) {
      const input = randomInput(new Random(seed))
      const layout = packLayout(input)
      const errors = validateLayout(input, layout)
      if (errors.length > 0) failures.push(`seed ${seed}: ${errors[0]}`)
      if (!sameLayout(packLayout(input), layout)) failures.push(`seed ${seed}: not deterministic`)

      seen[input.ordering]++
      if (input.orientation === 'auto') seen.auto++
      if (!input.allowRotation) seen.noRotation++
      if ((layout.unplaceable?.length ?? 0) > 0) seen.unplaceable++
      if (layout.unplaceable?.some((u) => u.reason === 'no-usable-area')) seen.noUsableArea++
      if (layout.sheets.length > 1) seen.multiSheet++
      if (layout.sheets.length === 0) seen.empty++
    }
    expect(failures).toEqual([])
    for (const [name, count] of Object.entries(seen)) expect(count, name).toBeGreaterThan(20)
  }, 120_000)
})

describe('fuzz: refinement', () => {
  it(`publishes only valid, strictly better layouts on ${REFINE_INSTANCES} random instances`, async () => {
    const failures: string[] = []
    let improved = 0
    for (let seed = 9001; seed < 9001 + REFINE_INSTANCES; seed++) {
      const input = randomInput(new Random(seed))
      const sync = packLayout(input)
      let previous = sync
      let updates = 0
      const run = await refineLayout(input, {
        maxSteps: 300,
        onImprovement: (layout) => {
          updates++
          const errors = validateLayout(input, layout)
          if (errors.length > 0) failures.push(`seed ${seed}: invalid update: ${errors[0]}`)
          if (!isValidUpdate(layout, previous))
            failures.push(`seed ${seed}: update #${updates} is no improvement`)
          previous = layout
        },
      })
      const final = run.layout!
      if (validateLayout(input, final).length > 0)
        failures.push(`seed ${seed}: invalid final layout`)
      if (final.sheets.length > sync.sheets.length)
        failures.push(`seed ${seed}: refined layout is worse`)
      if (!sameLayout(final, previous)) failures.push(`seed ${seed}: final is not the last update`)
      if (input.ordering === 'strict' && updates > 0)
        failures.push(`seed ${seed}: strict order was "improved"`)
      if (updates > 0) improved++

      const again = await refineLayout(input, { maxSteps: 300 })
      if (!sameLayout(again.layout!, final))
        failures.push(`seed ${seed}: refinement not deterministic`)
    }
    expect(failures).toEqual([])
    expect(improved).toBeGreaterThan(10)
  }, 300_000)
})
