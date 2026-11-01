import { describe, expect, it } from 'vitest'
import { packLayout } from './pack.ts'
import { Random } from './random.ts'
import { refineLayout } from './refine.ts'
import { inputOf, SHEETS, type ImageSpec } from './testing/fixtures.ts'
import { sameLayout } from './testing/helpers.ts'
import { validateLayout } from './testing/validate.ts'

/** Packs, checks every rule, and returns the layout and how long it took. */
function timed(input: Parameters<typeof packLayout>[0]) {
  const started = performance.now()
  const layout = packLayout(input)
  const ms = performance.now() - started
  expect(validateLayout(input, layout)).toEqual([])
  return { layout, ms }
}

const randomImages = (count: number, seed: number, maxSide: number): ImageSpec[] => {
  const rng = new Random(seed)
  return Array.from({ length: count }, () => ({
    width: 3 + rng.next() * maxSide,
    height: 3 + rng.next() * maxSide,
    copies: 1,
  }))
}

describe('size', () => {
  it('packs 2000 pieces that are all different sizes', () => {
    const { layout, ms } = timed(inputOf(randomImages(2000, 1, 90)))
    expect(layout.totals?.pieceCount).toBe(2000)
    expect(ms).toBeLessThan(4000)
  })

  it('packs the most the app allows: ten images of 999 copies', () => {
    const images = Array.from({ length: 10 }, (_, i) => ({
      width: 20 + i * 7.3,
      height: 25 + i * 5.1,
      copies: 999,
    }))
    const { layout, ms } = timed(inputOf(images))
    expect(layout.totals?.pieceCount).toBe(9990)
    expect(ms).toBeLessThan(8000)
  })

  it('packs thousands of identical tiny pieces onto a few sheets', () => {
    const { layout, ms } = timed(inputOf([{ width: 2.5, height: 2.5, copies: 3000 }], { gap: 0.5 }))
    expect(layout.totals?.pieceCount).toBe(3000)
    expect(ms).toBeLessThan(4000)
  })

  it('packs hundreds of sheets where every piece needs one of its own', () => {
    const { layout, ms } = timed(inputOf([{ width: 200, height: 287, copies: 600 }]))
    expect(layout.sheets).toHaveLength(600)
    expect(layout.status).toBe('optimal')
    expect(ms).toBeLessThan(4000)
  })

  it('stays fast in Strict order on a long list of different pieces', () => {
    const { ms } = timed(
      inputOf(randomImages(2000, 2, 120), { ordering: 'strict', orientation: 'auto' }),
    )
    expect(ms).toBeLessThan(4000)
  })
})

describe('shape', () => {
  it('copes with sizes spanning six orders of magnitude in one list', () => {
    const { layout } = timed(
      inputOf(
        [
          { width: 0.001, height: 0.002, copies: 5 },
          { width: 1500, height: 1500, copies: 1 },
          { width: 0.5, height: 1400, copies: 3 },
          { width: 700, height: 3, copies: 4 },
        ],
        { sheetSize: { width: 1500, height: 1500 }, margin: 0 },
      ),
    )
    expect(layout.totals?.pieceCount).toBe(13)
  })

  it('handles squares with rotation on (a turn changes nothing)', () => {
    const { layout } = timed(inputOf([{ width: 50, height: 50, copies: 30 }]))
    expect(layout.sheets.flatMap((s) => s.pieces).every((p) => !p.rotated)).toBe(true)
  })

  it('handles pieces that fit only one way round, with rotation on', () => {
    const { layout } = timed(
      inputOf([{ width: 280, height: 190, copies: 3 }], { orientation: 'landscape', margin: 5 }),
    )
    expect(layout.totals?.pieceCount).toBe(3)
    expect(layout.sheets).toHaveLength(3)
  })

  it('handles a sheet so narrow that only a column fits', () => {
    const { layout } = timed(
      inputOf([{ width: 20, height: 20, copies: 50 }], {
        sheetSize: { width: 30, height: 1500 },
        margin: 5,
      }),
    )
    expect(layout.totals?.pieceCount).toBe(50)
  })

  it('handles a gap bigger than the sheet', () => {
    const { layout } = timed(inputOf([{ width: 10, height: 10, copies: 3 }], { gap: 400 }))
    expect(layout.sheets).toHaveLength(3)
  })

  it('treats a missing or non-numeric margin and gap as zero rather than failing', () => {
    for (const bad of [NaN, -5, Infinity]) {
      const input = inputOf([{ width: 40, height: 40, copies: 6 }], { margin: bad, gap: bad })
      const layout = packLayout(input)
      expect(layout.totals?.pieceCount).toBe(6)
    }
  })

  it('packs on a sheet larger than the supported maximum without breaking', () => {
    const layout = packLayout(
      inputOf([{ width: 100, height: 100, copies: 5 }], {
        sheetSize: { width: 50_000, height: 50_000 },
      }),
    )
    expect(layout.totals?.pieceCount).toBe(5)
  })
})

describe('termination and determinism', () => {
  it('stops refining within the budget even on a large instance', async () => {
    const input = inputOf(randomImages(1500, 3, 80))
    const started = performance.now()
    const run = await refineLayout(input, { budgetMs: 300 })
    expect(performance.now() - started).toBeLessThan(1500)
    expect(validateLayout(input, run.layout!)).toEqual([])
  })

  it('gives identical layouts on repeated runs of a hard instance', () => {
    const input = inputOf(randomImages(300, 4, 70), { orientation: 'auto', gap: 1.5 })
    const first = packLayout(input)
    for (let i = 0; i < 3; i++) expect(sameLayout(packLayout(input), first)).toBe(true)
  })

  it('does not depend on the order of the preset or on object identity', () => {
    const images = randomImages(60, 5, 60)
    const a = packLayout(inputOf(images, { sheetSize: { ...SHEETS.a4 } }))
    const b = packLayout(
      inputOf(
        images.map((i) => ({ ...i })),
        { sheetSize: { ...SHEETS.a4 } },
      ),
    )
    expect(sameLayout(a, b)).toBe(true)
  })

  it('does not change its input', () => {
    const input = inputOf(randomImages(80, 6, 60), { orientation: 'auto' })
    const before = JSON.stringify(input)
    packLayout(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('refines pieces that all fit one sheet to a proof quickly', async () => {
    const input = inputOf([{ width: 40, height: 40, copies: 8 }])
    const started = performance.now()
    const run = await refineLayout(input, { budgetMs: 5000 })
    expect(performance.now() - started).toBeLessThan(500)
    expect(run.layout!.status).toBe('optimal')
  })
})
