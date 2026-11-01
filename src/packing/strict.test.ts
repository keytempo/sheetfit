import { describe, expect, it } from 'vitest'
import { packLayout } from './pack.ts'
import { Random } from './random.ts'
import { inputOf } from './testing/fixtures.ts'
import { bestShelves } from './testing/shelves.ts'
import { validateLayout } from './testing/validate.ts'

describe('Strict order', () => {
  it('keeps the list order on a mixed list', () => {
    const input = inputOf(
      [
        { width: 35, height: 45, copies: 17 },
        { width: 100, height: 150, copies: 3 },
        { width: 60, height: 40, copies: 11 },
        { width: 35, height: 45, copies: 9 },
      ],
      { ordering: 'strict', gap: 2 },
    )
    const layout = packLayout(input)
    expect(validateLayout(input, layout)).toEqual([])
  })

  it('never lets the sheet index decrease along the list', () => {
    const rng = new Random(7)
    for (let trial = 0; trial < 40; trial++) {
      const images = Array.from({ length: 1 + rng.int(5) }, () => ({
        width: 10 + rng.int(90),
        height: 10 + rng.int(120),
        copies: 1 + rng.int(12),
      }))
      const input = inputOf(images, { ordering: 'strict', orientation: 'auto', gap: rng.int(4) })
      const layout = packLayout(input)
      expect(validateLayout(input, layout)).toEqual([])
      let sheet = 0
      for (const piece of input.pieces) {
        const found = layout.sheets.findIndex((s) => s.pieces.some((p) => p.piece === piece))
        expect(found).toBeGreaterThanOrEqual(sheet)
        sheet = found
      }
    }
  })

  it('matches an exhaustive search of the same layout family on small lists', () => {
    // Integer sizes on a small sheet, no margin: the packer works in micrometres, the oracle in units.
    const rng = new Random(2024)
    let compared = 0
    for (let trial = 0; trial < 300; trial++) {
      const width = 5 + rng.int(8)
      const height = width + rng.int(8)
      const gap = rng.chance(0.3) ? 1 : 0
      const rotate = rng.chance(0.6)
      const pieces = Array.from({ length: 2 + rng.int(6) }, () => ({
        w: 1 + rng.int(width - gap),
        h: 1 + rng.int(height - gap),
      }))
      const input = inputOf(
        pieces.map((p) => ({ width: p.w, height: p.h, copies: 1 })),
        {
          sheetSize: { width, height },
          margin: 0,
          gap,
          allowRotation: rotate,
          ordering: 'strict',
        },
      )
      const layout = packLayout(input)
      expect(validateLayout(input, layout)).toEqual([])

      const oracle = bestShelves(
        width + gap,
        height + gap,
        pieces.map((p) => ({ w: p.w + gap, h: p.h + gap })),
        rotate,
      )
      const last = layout.sheets.at(-1)!
      const lastHeight = Math.max(...last.pieces.map((p) => p.y + p.height)) + gap
      expect({ sheets: layout.sheets.length, lastHeight }).toEqual({
        sheets: oracle.sheets,
        lastHeight: oracle.lastHeight,
      })
      compared++
    }
    expect(compared).toBe(300)
  })

  it('chooses the better orientation under Automatic', () => {
    const images = [{ width: 140, height: 90, copies: 5 }]
    const base = { ordering: 'strict' as const, allowRotation: false }
    const portrait = packLayout(inputOf(images, { ...base, orientation: 'portrait' })).sheets.length
    const landscape = packLayout(inputOf(images, { ...base, orientation: 'landscape' })).sheets
      .length
    const auto = packLayout(inputOf(images, { ...base, orientation: 'auto' }))
    expect(auto.sheets.length).toBe(Math.min(portrait, landscape))
  })

  it('stays fast on 2000 pieces that are all different', () => {
    const rng = new Random(11)
    const images = Array.from({ length: 2000 }, () => ({
      width: 8 + rng.next() * 90,
      height: 8 + rng.next() * 120,
      copies: 1,
    }))
    const input = inputOf(images, { ordering: 'strict' })
    const started = performance.now()
    const layout = packLayout(input)
    expect(performance.now() - started).toBeLessThan(3000)
    expect(validateLayout(input, layout)).toEqual([])
  })
})
