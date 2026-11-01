import { describe, expect, it } from 'vitest'
import { buildLayoutInput, type LayoutImage } from '../lib/layout-input'
import { DEFAULT_PRINT_OPTIONS, LIMITS, type PrintOptions } from '../lib/print-options'
import { getMaxMargin, getSheetGeometry, SHEET_PRESETS } from '../lib/sheet'
import { packLayout } from './pack.ts'
import { Random } from './random.ts'
import { refineLayout } from './refine.ts'
import { validateLayout } from './testing/validate.ts'

/*
 * These tests run the packer on inputs built by the app's own `buildLayoutInput`, with the app's own
 * sizing and sheet functions, so they follow the app when it changes.
 */

type Image = LayoutImage

function randomOptions(rng: Random): PrintOptions {
  const presets = [...SHEET_PRESETS.map((p) => p.id), 'custom'] as const
  const sheetSize = presets[rng.int(presets.length)]
  const options: PrintOptions = {
    ...DEFAULT_PRINT_OPTIONS,
    sheetSize,
    customWidth: LIMITS.sheetSide.min + rng.next() * (LIMITS.sheetSide.max - LIMITS.sheetSide.min),
    customHeight: LIMITS.sheetSide.min + rng.next() * (LIMITS.sheetSide.max - LIMITS.sheetSide.min),
    orientation: (['portrait', 'landscape', 'auto'] as const)[rng.int(3)],
    baseMode: (['width', 'height', 'longest', 'native'] as const)[rng.int(4)],
    baseLength: 5 + rng.next() * 400,
    baseDpi: LIMITS.dpi.min + rng.next() * 600,
    gap: rng.chance(0.3) ? 0 : rng.next() * LIMITS.gap.max,
    allowRotation: rng.chance(0.6),
    ordering: rng.chance(0.3) ? 'strict' : 'optimize',
  }
  options.margin = rng.next() * getMaxMargin(options)
  return options
}

describe('with the app’s own sizing', () => {
  it('places every piece the UI shows, whatever the sheet, base size and options', () => {
    const rng = new Random(2026)
    for (let trial = 0; trial < 250; trial++) {
      const options = randomOptions(rng)
      const images: Image[] = Array.from({ length: 1 + rng.int(6) }, (_, i) => ({
        id: `image-${i}`,
        width: 50 + Math.floor(rng.next() * 9000),
        height: 50 + Math.floor(rng.next() * 9000),
        copies: rng.chance(0.1) ? 0 : 1 + rng.int(30),
        percent: LIMITS.percent.min + rng.next() * (LIMITS.percent.max - LIMITS.percent.min),
      }))
      const input = buildLayoutInput(images, options)
      const layout = packLayout(input)
      expect(validateLayout(input, layout), `trial ${trial}`).toEqual([])
      // The size limit in the UI keeps every piece inside the sheet, so nothing is left over.
      expect(layout.unplaceable, `trial ${trial}`).toEqual([])
      expect(layout.totals?.pieceCount).toBe(input.pieces.length)
    }
  })

  it('keeps the same piece ids and copy numbers the app expects', () => {
    const options = { ...DEFAULT_PRINT_OPTIONS, baseMode: 'width' as const, baseLength: 40 }
    const images: Image[] = [{ id: 'a', width: 600, height: 800, copies: 3, percent: 100 }]
    const input = buildLayoutInput(images, options)
    const layout = packLayout(input)
    const ids = layout.sheets.flatMap((s) =>
      s.pieces.map((p) => `${p.piece.id}/${p.piece.copy}/${p.piece.copies}`),
    )
    expect(ids).toEqual(['a:1/1/3', 'a:2/2/3', 'a:3/3/3'])
  })

  it('packs a size pushed past the sheet, at the size the UI limits it to', () => {
    const options = { ...DEFAULT_PRINT_OPTIONS, baseMode: 'width' as const, baseLength: 500 }
    const images: Image[] = [{ id: 'huge', width: 1000, height: 1500, copies: 2, percent: 300 }]
    const input = buildLayoutInput(images, options)
    const geometry = getSheetGeometry(options)
    expect(input.pieces[0].height).toBeLessThanOrEqual(geometry.usableHeight)
    const layout = packLayout(input)
    expect(layout.unplaceable).toEqual([])
    expect(layout.sheets).toHaveLength(2)
  })

  it('finds the better orientation when the app asks for Automatic', async () => {
    const options = {
      ...DEFAULT_PRINT_OPTIONS,
      orientation: 'auto' as const,
      allowRotation: false,
      baseMode: 'width' as const,
      baseLength: 90,
    }
    const images: Image[] = [{ id: 'wide', width: 900, height: 500, copies: 7, percent: 100 }]
    const input = buildLayoutInput(images, options)
    const auto = await refineLayout(input, { maxSteps: 50 })
    const portrait = packLayout({ ...input, orientation: 'portrait' })
    const landscape = packLayout({ ...input, orientation: 'landscape' })
    expect(auto.layout!.sheets.length).toBe(
      Math.min(portrait.sheets.length, landscape.sheets.length),
    )
  })

  it('never leaves a photo unplaceable on a landscape sheet with rotation off', () => {
    // The size limit is measured on the landscape sheet when it is chosen explicitly, so a tall
    // photo is shrunk to fit the sheet's short side instead of being too tall to place.
    const rng = new Random(77)
    for (const orientation of ['landscape', 'auto'] as const) {
      for (let trial = 0; trial < 120; trial++) {
        const options = { ...randomOptions(rng), orientation, allowRotation: false }
        const tall = trial % 2 === 0
        const images: Image[] = Array.from({ length: 1 + rng.int(4) }, (_, i) => ({
          id: `image-${i}`,
          width: tall ? 100 + rng.int(400) : 3000 + rng.int(6000),
          height: tall ? 3000 + rng.int(6000) : 100 + rng.int(400),
          copies: 1 + rng.int(8),
          percent: LIMITS.percent.max,
        }))
        const input = buildLayoutInput(images, options)
        const layout = packLayout(input)
        expect(validateLayout(input, layout), `${orientation} ${trial}`).toEqual([])
        expect(layout.unplaceable, `${orientation} ${trial}`).toEqual([])
      }
    }
  })

  it('shows the size that prints: every piece is placed at exactly the size it was given', () => {
    const options = {
      ...DEFAULT_PRINT_OPTIONS,
      orientation: 'landscape' as const,
      allowRotation: false,
      baseMode: 'width' as const,
      baseLength: 200,
    }
    const images: Image[] = [{ id: 'tall', width: 1000, height: 3000, copies: 3, percent: 300 }]
    const input = buildLayoutInput(images, options)
    const geometry = getSheetGeometry(options)
    expect(input.pieces[0].height).toBeLessThanOrEqual(geometry.usableHeight)
    const layout = packLayout(input)
    for (const sheet of layout.sheets) {
      for (const placed of sheet.pieces) {
        expect(placed.width).toBeCloseTo(placed.piece.width, 2)
        expect(placed.height).toBeCloseTo(placed.piece.height, 2)
      }
    }
  })

  it('places a photo limited to the sheet however sizes round to micrometres', () => {
    // Regression: the packer rounds the margin, the sheet and every photo to whole micrometres. A
    // photo limited to the usable area, rounded down to 0.01 %, could end up one micrometre wider
    // than the area the packer saw, and then count as too large although the UI showed it fitting.
    const rng = new Random(459)
    for (let trial = 0; trial < 4000; trial++) {
      const options = {
        ...DEFAULT_PRINT_OPTIONS,
        sheetSize: 'a3' as const,
        orientation: rng.chance(0.5) ? ('landscape' as const) : ('portrait' as const),
        allowRotation: false,
        baseMode: 'native' as const,
        baseDpi: LIMITS.dpi.min + rng.next() * (LIMITS.dpi.max - LIMITS.dpi.min),
        margin: rng.next() * 50,
      }
      const wide = rng.chance(0.5)
      const long = 3000 + rng.int(6000)
      const short = 100 + rng.int(400)
      const images: Image[] = [
        {
          id: 'photo',
          width: wide ? long : short,
          height: wide ? short : long,
          copies: 2,
          percent: LIMITS.percent.max,
        },
      ]
      const input = buildLayoutInput(images, options)
      expect(packLayout(input).unplaceable, `trial ${trial}`).toEqual([])
    }
  })
})
