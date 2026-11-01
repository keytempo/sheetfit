import type { UnplaceableReason } from '../lib/layout-types.ts'
import type { ResolvedOrientation } from '../lib/sheet.ts'
import type { EngineInput } from './types.ts'
import { lengthToUm, sizeToUm } from './units.ts'

/**
 * A class of interchangeable pieces. With rotation allowed, a piece and its 90° turn are the same
 * class, so the sides are stored with width >= height. Placement decisions are made per class;
 * a final pass hands real pieces to the slots in list order.
 */
export interface ItemType {
  /** Sides including the gap (the "inflated" size). */
  w: number
  h: number
  /** Real area without the gap, in square micrometres. */
  area: number
  count: number
  /** Indices into the input's piece list, ascending. */
  pieces: number[]
}

export interface Unplaced {
  index: number
  reason: UnplaceableReason
}

/**
 * The problem in the packer's own terms, for one sheet orientation. The gap applies between pieces
 * only: inflating every piece and the usable area by the gap gives an equivalent problem with no
 * gap at all, and a piece touching the margin line is then legal.
 */
export interface Instance {
  /** Portrait or landscape, as solved here. */
  orientation: ResolvedOrientation
  sheetW: number
  sheetH: number
  margin: number
  gap: number
  /** The usable area, inflated by the gap: the bin the pieces are packed into. */
  binW: number
  binH: number
  /** The real usable area in square micrometres (zero when there is none). */
  usableArea: number
  rotate: boolean
  types: ItemType[]
  /** The pieces that cannot be placed, with the reason. */
  unplaceable: Unplaced[]
  /** How many pieces are in `types`. */
  placeableCount: number
  /** Each input piece's own [width, height] in micrometres; [0, 0] for pieces that cannot be placed. */
  natural: number[]
}

function sheetSides(input: EngineInput, orientation: ResolvedOrientation) {
  const a = lengthToUm(input.sheetSize.width) ?? 0
  const b = lengthToUm(input.sheetSize.height) ?? 0
  const short = Math.min(a, b)
  const long = Math.max(a, b)
  return orientation === 'portrait' ? { w: short, h: long } : { w: long, h: short }
}

export function buildInstance(input: EngineInput, orientation: ResolvedOrientation): Instance {
  const { w: sheetW, h: sheetH } = sheetSides(input, orientation)
  const margin = lengthToUm(input.margin) ?? 0
  const gap = lengthToUm(input.gap) ?? 0
  const usableW = sheetW - 2 * margin
  const usableH = sheetH - 2 * margin
  const hasArea = usableW > 0 && usableH > 0
  const rotate = input.allowRotation

  const types: ItemType[] = []
  const typeByKey = new Map<string, number>()
  const unplaceable: Unplaced[] = []
  const natural = new Array<number>(input.pieces.length * 2).fill(0)
  let placeableCount = 0

  input.pieces.forEach((piece, index) => {
    const width = sizeToUm(piece.width)
    const height = sizeToUm(piece.height)
    if (width === null || height === null) {
      unplaceable.push({ index, reason: 'invalid-size' })
      return
    }
    if (!hasArea) {
      unplaceable.push({ index, reason: 'no-usable-area' })
      return
    }
    const fits =
      (width <= usableW && height <= usableH) || (rotate && height <= usableW && width <= usableH)
    if (!fits) {
      unplaceable.push({ index, reason: 'too-large' })
      return
    }

    const long = rotate ? Math.max(width, height) : width
    const short = rotate ? Math.min(width, height) : height
    const key = `${long}x${short}`
    let typeIndex = typeByKey.get(key)
    if (typeIndex === undefined) {
      typeIndex = types.length
      typeByKey.set(key, typeIndex)
      types.push({ w: long + gap, h: short + gap, area: long * short, count: 0, pieces: [] })
    }
    types[typeIndex].count++
    types[typeIndex].pieces.push(index)
    natural[index * 2] = width
    natural[index * 2 + 1] = height
    placeableCount++
  })

  return {
    orientation,
    sheetW,
    sheetH,
    margin,
    gap,
    binW: hasArea ? usableW + gap : 0,
    binH: hasArea ? usableH + gap : 0,
    usableArea: hasArea ? usableW * usableH : 0,
    rotate,
    types,
    unplaceable,
    placeableCount,
    natural,
  }
}
