import { describe, expect, it } from 'vitest'
import type { LayoutInput } from '../lib/layout-types.ts'
import { packLayout } from './pack.ts'
import { refineLayout } from './refine.ts'
import { Random } from './random.ts'
import { type Box, minSheets } from './testing/bruteforce.ts'
import { inputOf } from './testing/fixtures.ts'
import { validateLayout } from './testing/validate.ts'

interface Tiny {
  input: LayoutInput
  /** The true fewest sheets, from the exhaustive solver. */
  optimum: number
}

/**
 * A small instance with integer sizes, a tiny sheet and no margin, so the exhaustive solver can
 * decide it. The gap is added the way the problem is defined (every piece and the sheet grow by
 * it), written out again here independently of the packer.
 */
function tiny(seed: number, harder: boolean): Tiny | null {
  const rng = new Random(seed * 7919)
  const width = 4 + rng.int(harder ? 5 : 6)
  const height = width + rng.int(harder ? 5 : 6)
  const gap = rng.chance(0.3) ? 1 : 0
  const rotate = rng.chance(0.55)
  const count = harder ? 6 + rng.int(4) : 1 + rng.int(7)
  const low = (side: number) => (harder ? 1 + Math.floor(side / 4) : 1)
  const boxes: Box[] = Array.from({ length: count }, () => {
    const lowW = low(width - gap)
    const lowH = low(height - gap)
    return {
      w: lowW + rng.int(Math.max(1, width - gap - lowW + 1)),
      h: lowH + rng.int(Math.max(1, height - gap - lowH + 1)),
    }
  })
  const fitting = boxes.filter(
    (b) => (b.w <= width && b.h <= height) || (rotate && b.h <= width && b.w <= height),
  )
  if (fitting.length === 0) return null
  const optimum = minSheets(
    width + gap,
    height + gap,
    fitting.map((b) => ({ w: b.w + gap, h: b.h + gap })),
    rotate,
  )
  const input = inputOf(
    fitting.map((b) => ({ width: b.w, height: b.h, copies: 1 })),
    { sheetSize: { width, height }, margin: 0, gap, allowRotation: rotate },
  )
  return { input, optimum }
}

describe('against an exhaustive solver on tiny instances', () => {
  it('never claims a lower bound above the true optimum', () => {
    let checked = 0
    let gaps = 0
    let beyondArea = 0
    for (let seed = 1; seed <= 1200; seed++) {
      const instance = tiny(seed, seed % 2 === 0)
      if (!instance) continue
      const layout = packLayout(instance.input)
      const { sheetSize, gap } = instance.input
      const cell = (sheetSize.width + gap) * (sheetSize.height + gap)
      const area = instance.input.pieces.reduce(
        (sum, p) => sum + (p.width + gap) * (p.height + gap),
        0,
      )
      if (layout.lowerBound > Math.ceil(area / cell - 1e-9)) beyondArea++
      expect(layout.lowerBound, `seed ${seed}`).toBeLessThanOrEqual(instance.optimum)
      expect(layout.sheets.length, `seed ${seed}`).toBeGreaterThanOrEqual(instance.optimum)
      if (layout.lowerBound < instance.optimum) gaps++
      checked++
    }
    expect(checked).toBeGreaterThan(1000)
    // The check only means something if some instances have a bound that is not already tight.
    expect(gaps).toBeGreaterThan(20)
    // ... and only means something for the stronger bounds if they actually beat plain area here.
    expect(beyondArea).toBeGreaterThan(80)
  }, 120_000)

  it('finds the true optimum and proves it, with the exact solver', async () => {
    let proofs = 0
    for (let seed = 1; seed <= 600; seed++) {
      const instance = tiny(seed, seed % 2 === 0)
      if (!instance) continue
      const { layout } = await refineLayout(instance.input, { maxSteps: 400 })
      expect(validateLayout(instance.input, layout!)).toEqual([])
      expect(layout!.sheets.length, `seed ${seed}`).toBe(instance.optimum)
      expect(layout!.status).toBe('optimal')
      proofs++
    }
    expect(proofs).toBeGreaterThan(500)
  }, 120_000)

  it('reaches the optimum with the heuristics alone almost always', async () => {
    let tried = 0
    let reached = 0
    for (let seed = 1; seed <= 500; seed++) {
      const instance = tiny(seed, true)
      if (!instance) continue
      const { layout } = await refineLayout(instance.input, { maxSteps: 400, exactLimit: 0 })
      tried++
      if (layout!.sheets.length === instance.optimum) reached++
      expect(layout!.status === 'optimal' ? layout!.sheets.length : instance.optimum).toBe(
        instance.optimum,
      )
    }
    // A measured property, not a guarantee: a drop would mean the search has regressed.
    expect(reached / tried).toBeGreaterThan(0.97)
  }, 120_000)

  it('does not call a result optimal unless it is', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const instance = tiny(seed, true)
      if (!instance) continue
      const sync = packLayout(instance.input)
      if (sync.status === 'optimal')
        expect(sync.sheets.length, `seed ${seed}`).toBe(instance.optimum)
    }
  })
})
