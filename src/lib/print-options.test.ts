import { describe, expect, it } from 'vitest'
import { Random } from '../packing/random'
import { packLayout } from '../packing/pack'
import { sanitizePanelLayout } from '../store/ui-slice'
import { REFINEMENT_BUDGET_MS } from '../packing/refine'
import { buildLayoutInput } from './layout-input'
import { DEFAULT_PRINT_OPTIONS, LIMITS, sanitizeOptions } from './print-options'

describe('sanitizeOptions', () => {
  it('keeps valid options exactly as they are', () => {
    const options = {
      ...DEFAULT_PRINT_OPTIONS,
      unit: 'in' as const,
      sheetSize: 'custom' as const,
      customWidth: 123.5,
      customHeight: 456,
      orientation: 'auto' as const,
      baseMode: 'width' as const,
      baseLength: 42,
      baseDpi: 600,
      margin: 12.5,
      gap: 3,
      allowRotation: false,
      ordering: 'strict' as const,
      timeLimit: 45,
      cutGuides: true,
      showMargins: false,
      showSheetNumbers: false,
    }
    expect(sanitizeOptions(options)).toEqual(options)
  })

  it('falls back to the defaults for nothing, nonsense and the wrong kind of thing', () => {
    for (const saved of [undefined, null, 'text', 7, [], true]) {
      expect(sanitizeOptions(saved)).toEqual(DEFAULT_PRINT_OPTIONS)
    }
  })

  it('replaces a value that is not valid and keeps the others', () => {
    const result = sanitizeOptions({
      sheetSize: 'a9',
      orientation: 'sideways',
      ordering: 3,
      margin: 8,
      cutGuides: 'yes',
    })
    expect(result.sheetSize).toBe(DEFAULT_PRINT_OPTIONS.sheetSize)
    expect(result.orientation).toBe(DEFAULT_PRINT_OPTIONS.orientation)
    expect(result.ordering).toBe(DEFAULT_PRINT_OPTIONS.ordering)
    expect(result.cutGuides).toBe(DEFAULT_PRINT_OPTIONS.cutGuides)
    expect(result.margin).toBe(8)
  })

  it('brings numbers inside their limits and rejects what is not a number', () => {
    const result = sanitizeOptions({
      customWidth: 5,
      customHeight: 99999,
      baseDpi: 0,
      baseLength: '50',
      margin: -4,
      gap: Number.NaN,
    })
    expect(result.customWidth).toBe(LIMITS.sheetSide.min)
    expect(result.customHeight).toBe(LIMITS.sheetSide.max)
    expect(result.baseDpi).toBe(LIMITS.dpi.min)
    expect(result.baseLength).toBe(DEFAULT_PRINT_OPTIONS.baseLength)
    expect(result.margin).toBe(0)
    expect(result.gap).toBe(DEFAULT_PRINT_OPTIONS.gap)
    expect(sanitizeOptions({ margin: Infinity }).margin).toBe(DEFAULT_PRINT_OPTIONS.margin)
  })

  it('keeps the packing time the app has always used as the default', () => {
    expect(DEFAULT_PRINT_OPTIONS.timeLimit * 1000).toBe(REFINEMENT_BUDGET_MS)
  })

  it('gives options saved before the time limit existed the default time limit', () => {
    const older: Partial<typeof DEFAULT_PRINT_OPTIONS> = { ...DEFAULT_PRINT_OPTIONS }
    delete older.timeLimit
    expect(sanitizeOptions({ ...older, margin: 8 }).timeLimit).toBe(DEFAULT_PRINT_OPTIONS.timeLimit)
  })

  it('keeps the time limit a whole number of seconds inside its limits', () => {
    const limit = (timeLimit: unknown) => sanitizeOptions({ timeLimit }).timeLimit
    expect(limit(30)).toBe(30)
    expect(limit(2.6)).toBe(3)
    expect(limit(0)).toBe(LIMITS.timeLimit.min)
    expect(limit(-5)).toBe(LIMITS.timeLimit.min)
    expect(limit(0.4)).toBe(LIMITS.timeLimit.min)
    expect(limit(100_000)).toBe(LIMITS.timeLimit.max)
    for (const bad of ['30', null, undefined, NaN, Infinity, {}, [], true])
      expect(limit(bad)).toBe(DEFAULT_PRINT_OPTIONS.timeLimit)
  })

  it('whatever was saved, the sheets can be packed and every copy is placed', () => {
    const random = new Random(5)
    const garbage = () => {
      const pool: unknown[] = [
        0,
        -1,
        1e9,
        NaN,
        Infinity,
        'a9',
        'x',
        null,
        undefined,
        {},
        [],
        true,
        3.7,
        'native',
        'custom',
        'landscape',
      ]
      return pool[random.int(pool.length)]
    }
    const keys = Object.keys(DEFAULT_PRINT_OPTIONS)
    for (let trial = 0; trial < 400; trial++) {
      const saved = Object.fromEntries(
        keys.map((key) => [
          key,
          random.chance(0.6)
            ? garbage()
            : (DEFAULT_PRINT_OPTIONS as unknown as Record<string, unknown>)[key],
        ]),
      )
      const options = sanitizeOptions(saved)
      const images = [
        { id: 'a', width: 4000, height: 3000, copies: 3, percent: 100 },
        { id: 'b', width: 600, height: 6000, copies: 2, percent: 300 },
      ]
      const input = buildLayoutInput(images, options)
      for (const piece of input.pieces) {
        expect(Number.isFinite(piece.width) && piece.width > 0, `trial ${trial}`).toBe(true)
        expect(Number.isFinite(piece.height) && piece.height > 0, `trial ${trial}`).toBe(true)
      }
      expect(packLayout(input).unplaceable, `trial ${trial}`).toEqual([])
    }
  })
})

describe('sanitizePanelLayout', () => {
  it('keeps a good split and replaces a bad one with the default', () => {
    expect(sanitizePanelLayout({ images: 30, preview: 70 })).toEqual({ images: 30, preview: 70 })
    for (const bad of [
      undefined,
      null,
      {},
      { images: 'a', preview: 62 },
      { images: 10, preview: 10 },
      { images: 0, preview: 100 },
      { images: NaN, preview: NaN },
    ]) {
      expect(sanitizePanelLayout(bad)).toEqual({ images: 38, preview: 62 })
    }
  })
})
