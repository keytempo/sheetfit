import type { LayoutInput } from '../../lib/layout-types.ts'
import { Random } from '../random.ts'
import { inputOf, SHEETS, type ImageSpec } from './fixtures.ts'

/** A uniform float in [low, high]. */
const between = (rng: Random, low: number, high: number) => low + (high - low) * rng.next()
const integer = (rng: Random, low: number, high: number) => low + rng.int(high - low + 1)

/** Millimetre sizes with up to three decimals, so values are never round numbers. */
const fractional = (value: number) => Math.round(value * 1000) / 1000

const PRESETS = Object.values(SHEETS)

/** Any sheet the app could make: a preset or a custom size from 30 to 1500 mm. */
export function randomSheet(rng: Random) {
  if (rng.chance(0.5)) return PRESETS[rng.int(PRESETS.length)]
  const a = rng.chance(0.2) ? integer(rng, 30, 45) : fractional(between(rng, 30, 1500))
  const b = rng.chance(0.2) ? integer(rng, 30, 45) : fractional(between(rng, 30, 1500))
  return { width: Math.min(a, b), height: Math.max(a, b) }
}

/** Sizes that mostly fit, sometimes tiny, extreme in aspect ratio, or larger than the sheet. */
function randomImage(rng: Random, sheetW: number, sheetH: number): ImageSpec {
  const copies = rng.chance(0.1) ? 0 : rng.chance(0.3) ? integer(rng, 10, 60) : integer(rng, 1, 12)
  const roll = rng.next()
  const side = Math.max(sheetW, sheetH)
  let width: number
  let height: number
  if (roll < 0.1) {
    width = fractional(between(rng, 0.001, 2))
    height = fractional(between(rng, 0.001, 2))
  } else if (roll < 0.2) {
    width = fractional(between(rng, 1, 5))
    height = fractional(between(rng, side * 0.3, side))
  } else if (roll < 0.28) {
    width = fractional(between(rng, side * 0.5, side * 1.2))
    height = fractional(between(rng, side * 0.5, side * 1.2))
  } else {
    width = fractional(between(rng, 5, side * 0.45))
    height = fractional(between(rng, 5, side * 0.45))
  }
  return { width, height, copies }
}

/** A random but reproducible input, covering every option the app can produce. */
export function randomInput(rng: Random): LayoutInput {
  const sheet = randomSheet(rng)
  const margin = rng.chance(0.2)
    ? 0
    : fractional(between(rng, 0, Math.min(50, sheet.width / 2 + 3)))
  const gap = rng.chance(0.4) ? 0 : fractional(between(rng, 0, rng.chance(0.2) ? 60 : 30))
  const count = integer(rng, 1, 6)
  const images = Array.from({ length: count }, () => randomImage(rng, sheet.width, sheet.height))
  return inputOf(images, {
    sheetSize: sheet,
    orientation: (['portrait', 'landscape', 'auto'] as const)[rng.int(3)],
    margin,
    gap,
    allowRotation: rng.chance(0.7),
    ordering: rng.chance(0.3) ? 'strict' : 'optimize',
  })
}

/**
 * Cuts a W x H sheet recursively into exactly `pieces` rectangles, so the pieces tile the sheet
 * and the optimum is one sheet. Cuts land on a grid of `step` millimetres.
 */
export function perfectCut(
  rng: Random,
  width: number,
  height: number,
  pieces: number,
  step = 1,
): ImageSpec[] {
  const parts = [{ w: width, h: height }]
  while (parts.length < pieces) {
    const index = rng.int(parts.length)
    const { w, h } = parts[index]
    const cutsW = Math.floor(w / step) - 1
    const cutsH = Math.floor(h / step) - 1
    if (cutsW < 1 && cutsH < 1) {
      if (parts.every((p) => Math.floor(p.w / step) < 2 && Math.floor(p.h / step) < 2)) break
      continue
    }
    const vertical = cutsH < 1 || (cutsW >= 1 && rng.chance(w / (w + h)))
    parts.splice(index, 1)
    if (vertical) {
      const at = integer(rng, 1, cutsW) * step
      parts.push({ w: at, h }, { w: w - at, h })
    } else {
      const at = integer(rng, 1, cutsH) * step
      parts.push({ w, h: at }, { w, h: h - at })
    }
  }
  return parts.map((p) => ({ width: p.w, height: p.h, copies: 1 }))
}

/**
 * The Berkey-Wang (I-VI) and Martello-Vigo (VII-X) classes for two-dimensional bin packing. Sizes
 * are in bin units; `scale` turns them into millimetres. Every piece is its own image.
 */
export function martelloVigo(
  cls: number,
  n: number,
  rng: Random,
): { images: ImageSpec[]; bin: number } {
  const bins = [10, 30, 40, 100, 100, 300, 100, 100, 100, 100]
  const sizes = [10, 10, 35, 35, 100, 100]
  const bin = bins[cls - 1]
  const unit = (low: number, high: number) =>
    integer(rng, Math.ceil(low), Math.max(Math.ceil(low), Math.floor(high)))
  const images = Array.from({ length: n }, (): ImageSpec => {
    if (cls <= 6)
      return { width: unit(1, sizes[cls - 1]), height: unit(1, sizes[cls - 1]), copies: 1 }
    const dominant = cls - 7
    const roll = rng.next()
    const type = roll < 0.7 ? dominant : (dominant + 1 + Math.floor(((roll - 0.7) / 0.3) * 3)) % 4
    switch (type) {
      case 0:
        return { width: unit((2 * bin) / 3, bin), height: unit(1, bin / 2), copies: 1 }
      case 1:
        return { width: unit(1, bin / 2), height: unit((2 * bin) / 3, bin), copies: 1 }
      case 2:
        return { width: unit(bin / 2, bin), height: unit(bin / 2, bin), copies: 1 }
      default:
        return { width: unit(1, bin / 2), height: unit(1, bin / 2), copies: 1 }
    }
  })
  return { images, bin }
}

/** Common photo sets, in millimetres, with copy counts that make several sheets. */
export const PHOTO_SETS: Record<string, readonly ImageSpec[]> = {
  'ID photos 35x45': [{ width: 35, height: 45, copies: 80 }],
  'passport 2x2 inch': [{ width: 50.8, height: 50.8, copies: 24 }],
  'prints 4x6 and 5x7 inch': [
    { width: 101.6, height: 152.4, copies: 14 },
    { width: 127, height: 177.8, copies: 10 },
  ],
  'wallets 2.5x3.5 inch': [{ width: 63.5, height: 88.9, copies: 60 }],
  'mixed event set': [
    { width: 35, height: 45, copies: 40 },
    { width: 50.8, height: 50.8, copies: 12 },
    { width: 101.6, height: 152.4, copies: 8 },
    { width: 127, height: 177.8, copies: 6 },
    { width: 63.5, height: 88.9, copies: 20 },
  ],
}
