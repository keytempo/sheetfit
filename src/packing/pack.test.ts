import { describe, expect, it } from 'vitest'
import type { LayoutInput } from '../lib/layout-types.ts'
import { packLayout } from './pack.ts'
import { refineLayout } from './refine.ts'
import { inputOf, SHEETS } from './testing/fixtures.ts'
import { sameLayout } from './testing/helpers.ts'
import { validateLayout } from './testing/validate.ts'

/** Packs, checks every rule, and returns the layout. */
function packed(input: LayoutInput) {
  const layout = packLayout(input)
  expect(validateLayout(input, layout)).toEqual([])
  return layout
}

/** The same, after refinement (which is what finds proofs and perfect tilings). */
async function refined(input: LayoutInput) {
  const { layout } = await refineLayout(input, { maxSteps: 400 })
  expect(layout).not.toBeNull()
  expect(validateLayout(input, layout!)).toEqual([])
  return layout!
}

describe('exact arithmetic', () => {
  it('tiles an A4 sheet with four 105 x 148.5 mm pieces, zero margin and gap', () => {
    const layout = packed(inputOf([{ width: 105, height: 148.5, copies: 4 }], { margin: 0 }))
    expect(layout.sheets).toHaveLength(1)
    expect(layout.sheets[0].stats.fillPercent).toBeCloseTo(100, 9)
    expect(layout.status).toBe('optimal')
  })

  it('tiles with rotation only: the pieces are wider than the sheet is without turning', () => {
    const layout = packed(inputOf([{ width: 148.5, height: 105, copies: 4 }], { margin: 0 }))
    expect(layout.sheets).toHaveLength(1)
    expect(layout.sheets[0].pieces.every((p) => p.rotated)).toBe(true)
  })

  it('does not tile when rotation is off and the pieces cannot sit upright', () => {
    const layout = packed(
      inputOf([{ width: 148.5, height: 105, copies: 4 }], { margin: 0, allowRotation: false }),
    )
    expect(layout.sheets.length).toBeGreaterThan(1)
  })

  it('accepts a piece exactly as big as the usable area', () => {
    const layout = packed(inputOf([{ width: 200, height: 287, copies: 1 }]))
    expect(layout.sheets).toHaveLength(1)
    expect(layout.unplaceable).toEqual([])
  })

  it('rejects a piece one micron too big, and accepts floating-point noise around the limit', () => {
    const over = packed(
      inputOf([{ width: 200.001, height: 287, copies: 1 }], { allowRotation: false }),
    )
    expect(over.sheets).toHaveLength(0)
    expect(over.unplaceable?.map((u) => u.reason)).toEqual(['too-large'])

    for (const noise of [1e-12, -1e-12, 4e-4, -4e-4]) {
      const layout = packed(inputOf([{ width: 200 + noise, height: 287 - noise, copies: 1 }]))
      expect(layout.sheets).toHaveLength(1)
    }
  })

  it('handles fractional sizes such as 37.33 x 49.77 mm', () => {
    const layout = packed(inputOf([{ width: 37.33, height: 49.77, copies: 40 }]))
    expect(layout.totals?.pieceCount).toBe(40)
  })

  it('applies the gap between pieces only, never between a piece and the margin', () => {
    // 3 pieces of 60 mm and a 5 mm gap need 190 mm, which fits the 200 mm usable width exactly.
    const layout = packed(inputOf([{ width: 60, height: 60, copies: 3 }], { gap: 5, margin: 5 }))
    expect(layout.sheets).toHaveLength(1)
    const xs = layout.sheets[0].pieces.map((p) => p.x).sort((a, b) => a - b)
    expect(xs[0]).toBe(5)
  })

  it('leaves exactly the gap between neighbours', () => {
    const layout = packed(
      inputOf([{ width: 99.5, height: 99.5, copies: 4 }], { gap: 1, margin: 5 }),
    )
    const pieces = layout.sheets[0].pieces
    const right = Math.max(...pieces.map((p) => p.x))
    const left = Math.min(...pieces.map((p) => p.x))
    expect(right - left).toBeCloseTo(100.5, 9)
  })
})

describe('edge conditions', () => {
  it('returns no sheets for no pieces, and keeps the sheet geometry', () => {
    const layout = packed(inputOf([]))
    expect(layout.sheets).toHaveLength(0)
    expect(layout.sheetWidth).toBe(210)
    expect(layout.sheetHeight).toBe(297)
    expect(layout.status).toBe('optimal')
    expect(layout.totals?.sheetCount).toBe(0)
  })

  it('treats zero copies as no pieces', () => {
    expect(packed(inputOf([{ width: 50, height: 50, copies: 0 }])).sheets).toHaveLength(0)
  })

  it('places one piece', () => {
    const layout = packed(inputOf([{ width: 50, height: 50, copies: 1 }]))
    expect(layout.sheets).toHaveLength(1)
    expect(layout.sheets[0].pieces[0].x).toBe(5)
    expect(layout.sheets[0].pieces[0].y).toBe(5)
  })

  it('reports a sheet with no usable area instead of crashing', () => {
    for (const margin of [105, 120, 1000]) {
      const layout = packed(inputOf([{ width: 10, height: 10, copies: 3 }], { margin }))
      expect(layout.sheets).toHaveLength(0)
      expect(layout.unplaceable?.map((u) => u.reason)).toEqual(Array(3).fill('no-usable-area'))
    }
  })

  it('copes with a margin that leaves a sliver', () => {
    const layout = packed(inputOf([{ width: 3, height: 3, copies: 4 }], { margin: 104.9 }))
    expect(layout.sheets).toHaveLength(0)
    expect(layout.unplaceable).toHaveLength(4)
  })

  it('lists pieces with no valid size as unplaceable', () => {
    const input = inputOf([{ width: 20, height: 20, copies: 2 }])
    const odd = [0, -3, NaN, Infinity].map((width, i) => ({
      ...input.pieces[0],
      id: `odd:${i}`,
      width,
    }))
    const mixed = { ...input, pieces: [...input.pieces, ...odd] }
    const layout = packed(mixed)
    expect(layout.totals?.pieceCount).toBe(2)
    expect(layout.unplaceable?.map((u) => u.reason)).toEqual(Array(4).fill('invalid-size'))
  })

  it('gives a one micrometre piece one micrometre, not zero', () => {
    const layout = packed(inputOf([{ width: 0.0004, height: 0.0004, copies: 3 }]))
    expect(layout.totals?.pieceCount).toBe(3)
  })

  it('survives a degenerate sheet', () => {
    for (const sheetSize of [
      { width: 0, height: 0 },
      { width: NaN, height: 100 },
      { width: -5, height: 100 },
    ]) {
      const input = inputOf([{ width: 10, height: 10, copies: 2 }], { sheetSize })
      const layout = packLayout(input)
      expect(layout.sheets).toHaveLength(0)
      expect(layout.unplaceable).toHaveLength(2)
    }
  })

  it('packs a gap larger than the pieces', () => {
    const layout = packed(inputOf([{ width: 20, height: 20, copies: 12 }], { gap: 50 }))
    expect(layout.totals?.pieceCount).toBe(12)
  })

  it('packs 500 copies of one image', () => {
    const layout = packed(inputOf([{ width: 50, height: 70, copies: 500 }]))
    expect(layout.totals?.pieceCount).toBe(500)
    expect(layout.status).toBe('optimal')
  })

  it('packs extreme aspect ratios, in both directions', () => {
    for (const [width, height] of [
      [1, 285],
      [285, 1],
      [0.01, 200],
      [200, 0.01],
    ]) {
      const layout = packed(inputOf([{ width, height, copies: 30 }]))
      expect(layout.totals?.pieceCount).toBe(30)
    }
  })

  it('packs tiny pieces together with near-sheet-sized ones', () => {
    const layout = packed(
      inputOf([
        { width: 199, height: 286, copies: 3 },
        { width: 2, height: 3, copies: 80 },
        { width: 100, height: 140, copies: 5 },
      ]),
    )
    expect(layout.totals?.pieceCount).toBe(88)
  })
})

describe('sheets and settings', () => {
  const images = [
    { width: 41, height: 63, copies: 17 },
    { width: 30, height: 30, copies: 9 },
    { width: 80, height: 55, copies: 6 },
  ]

  it('packs on every preset from A0 to A6, Letter, Legal and Tabloid', () => {
    for (const [name, sheetSize] of Object.entries(SHEETS)) {
      const layout = packed(inputOf(images, { sheetSize, margin: 4, gap: 1 }))
      expect(layout.totals?.pieceCount, name).toBe(32)
    }
  })

  it('packs on custom sheets: tiny, huge, elongated and square', () => {
    for (const sheetSize of [
      { width: 30, height: 30 },
      { width: 30, height: 1500 },
      { width: 1500, height: 1500 },
      { width: 77.7, height: 133.3 },
      { width: 400, height: 400 },
    ]) {
      const layout = packed(inputOf(images, { sheetSize, margin: 2 }))
      const placed = layout.totals?.pieceCount ?? 0
      expect(placed + (layout.unplaceable?.length ?? 0)).toBe(32)
    }
  })

  it('works for every orientation, margin and gap combination', () => {
    for (const orientation of ['portrait', 'landscape', 'auto'] as const) {
      for (const margin of [0, 5, 20, 50, 100, 104]) {
        for (const gap of [0, 3, 30]) {
          packed(inputOf(images, { orientation, margin, gap }))
        }
      }
    }
  })

  it('lays out landscape sheets with the long side across', () => {
    const layout = packed(inputOf(images, { orientation: 'landscape' }))
    expect(layout.orientation).toBe('landscape')
    expect(layout.sheetWidth).toBe(297)
    expect(layout.sheetHeight).toBe(210)
  })

  it('normalises a sheet given the wrong way round', () => {
    const layout = packed(inputOf(images, { sheetSize: { width: 297, height: 210 } }))
    expect(layout.sheetWidth).toBe(210)
  })
})

describe('Automatic orientation', () => {
  it('uses landscape when only landscape can hold the piece', () => {
    const input = inputOf([{ width: 280, height: 100, copies: 2 }], {
      orientation: 'auto',
      allowRotation: false,
    })
    const layout = packed(input)
    expect(layout.orientation).toBe('landscape')
    expect(layout.unplaceable).toEqual([])
  })

  it('prefers portrait on a tie', () => {
    const layout = packed(inputOf([{ width: 40, height: 40, copies: 4 }], { orientation: 'auto' }))
    expect(layout.orientation).toBe('portrait')
  })

  it('keeps the orientation that needs fewer sheets', () => {
    // Three 140 x 90 pieces, no rotation: they stack in portrait, but only two fit per landscape sheet.
    const input = inputOf([{ width: 140, height: 90, copies: 3 }], {
      allowRotation: false,
      margin: 5,
    })
    const portrait = packed({ ...input, orientation: 'portrait' }).sheets.length
    const landscape = packed({ ...input, orientation: 'landscape' }).sheets.length
    const auto = packed({ ...input, orientation: 'auto' })
    expect(auto.sheets.length).toBe(Math.min(portrait, landscape))
  })
})

describe('statistics', () => {
  it('adds up: used + wasted is the usable area, overall figures are sums', () => {
    const layout = packed(
      inputOf([
        { width: 35, height: 45, copies: 60 },
        { width: 100, height: 150, copies: 7 },
      ]),
    )
    const totals = layout.totals
    expect(totals.sheetCount).toBe(layout.sheets.length)
    expect(totals.usedArea + totals.wastedArea).toBeCloseTo(totals.usableArea, 6)
    const usedSum = layout.sheets.reduce((s, sh) => s + sh.stats.usedArea, 0)
    expect(totals.usedArea).toBeCloseTo(usedSum, 6)
    // The overall fill is a ratio of sums. (Sheets are identical, so it equals the mean fill.)
    expect(totals.fillPercent).toBeCloseTo((usedSum / totals.usableArea) * 100, 6)
    expect(layout.sheets.length).toBeGreaterThan(1)
  })

  it('measures the fill of all sheets but the last separately', () => {
    const layout = packed(inputOf([{ width: 50, height: 70, copies: 40 }]))
    const t = layout.totals
    const body = layout.sheets.slice(0, -1)
    const used = body.reduce((s, sh) => s + sh.stats.usedArea, 0)
    const usable = body.reduce((s, sh) => s + sh.stats.usableArea, 0)
    expect(t.fillPercentExceptLast).toBeCloseTo((used / usable) * 100, 6)
  })
})

describe('ordering of the result', () => {
  it('puts the emptiest sheet last', () => {
    const layout = packed(
      inputOf([
        { width: 35, height: 45, copies: 50 },
        { width: 90, height: 130, copies: 5 },
      ]),
    )
    const used = layout.sheets.map((s) => s.stats.usedArea)
    expect(used.at(-1)).toBe(Math.min(...used))
  })

  it('deals pieces to slots in list order, so copies stay together and earlier images come first', () => {
    // Two images of the same size are interchangeable; the first one must take the earlier slots.
    const input = inputOf([
      { width: 60, height: 60, copies: 7 },
      { width: 60, height: 60, copies: 7 },
    ])
    const layout = packed(input)
    const order = layout.sheets.flatMap((sheet) =>
      [...sheet.pieces]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((p) => `${p.piece.imageId}:${p.piece.copy}`),
    )
    expect(order).toEqual([
      ...Array.from({ length: 7 }, (_, i) => `img0:${i + 1}`),
      ...Array.from({ length: 7 }, (_, i) => `img1:${i + 1}`),
    ])
  })

  it('lists the pieces of every sheet in list order, as the same objects', () => {
    const input = inputOf([
      { width: 33, height: 44, copies: 20 },
      { width: 70, height: 50, copies: 9 },
    ])
    const layout = packed(input)
    for (const sheet of layout.sheets) {
      const indices = sheet.pieces.map((p) => input.pieces.indexOf(p.piece))
      expect(indices).toEqual([...indices].sort((a, b) => a - b))
    }
  })
})

describe('determinism', () => {
  it('returns the same layout for the same input, whatever else ran in between', () => {
    const input = inputOf([
      { width: 35, height: 45, copies: 37 },
      { width: 62, height: 88, copies: 23 },
      { width: 100, height: 148, copies: 9 },
    ])
    const first = packLayout(input)
    packLayout(inputOf([{ width: 10, height: 10, copies: 100 }]))
    expect(sameLayout(packLayout(input), first)).toBe(true)
  })

  it('does not depend on the seed for the synchronous result', () => {
    const input = inputOf([
      { width: 41, height: 52, copies: 33 },
      { width: 70, height: 70, copies: 5 },
    ])
    expect(sameLayout(packLayout(input, { seed: 1 }), packLayout(input, { seed: 99 }))).toBe(true)
  })
})

describe('perfect packings', () => {
  it('finds a recursive-cut tiling of one sheet', async () => {
    // A 200 x 280 sheet cut into eight rectangles.
    const images = [
      [200, 70],
      [100, 70],
      [100, 70],
      [120, 70],
      [80, 70],
      [50, 70],
      [90, 70],
      [60, 70],
    ].map(([width, height]) => ({ width, height, copies: 1 }))
    const input = inputOf(images, { sheetSize: { width: 200, height: 280 }, margin: 0 })
    const layout = await refined(input)
    expect(layout.sheets).toHaveLength(1)
    expect(layout.status).toBe('optimal')
    expect(layout.sheets[0].stats.fillPercent).toBeCloseTo(100, 6)
  })

  it('finds a tiling that needs rotation', async () => {
    // 2x1 dominoes tile a 6 x 4 board only if some are turned.
    const input = inputOf([{ width: 2, height: 1, copies: 12 }], {
      sheetSize: { width: 6, height: 4 },
      margin: 0,
    })
    const layout = await refined(input)
    expect(layout.sheets).toHaveLength(1)
  })
})
