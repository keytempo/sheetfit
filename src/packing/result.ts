import type {
  LayoutInput,
  LayoutResult,
  LayoutTotals,
  PlacedPiece,
  PlacedSheet,
} from '../lib/layout-types.ts'
import type { PackedLayout } from './types.ts'
import { umToMm } from './units.ts'

const UM2_PER_MM2 = 1_000_000

/**
 * Builds the app's `LayoutResult` around the caller's own piece objects. Areas are summed in whole
 * square micrometres, so `usedArea + wastedArea` is the usable area and totals are exact sums.
 */
export function toLayoutResult(input: LayoutInput, packed: PackedLayout): LayoutResult {
  const usableUm2 =
    Math.max(0, packed.sheetWidth - 2 * packed.margin) *
    Math.max(0, packed.sheetHeight - 2 * packed.margin)
  const usableArea = usableUm2 / UM2_PER_MM2

  const usedPerSheet: number[] = []
  const sheets = packed.sheets.map((pieces, index): PlacedSheet => {
    let usedUm2 = 0
    const placed = pieces.map((p): PlacedPiece => {
      usedUm2 += p.width * p.height
      return {
        piece: input.pieces[p.index],
        x: umToMm(p.x),
        y: umToMm(p.y),
        width: umToMm(p.width),
        height: umToMm(p.height),
        rotated: p.rotated,
      }
    })
    usedPerSheet.push(usedUm2)
    return {
      index,
      pieces: placed,
      stats: {
        pieceCount: placed.length,
        usableArea,
        usedArea: usedUm2 / UM2_PER_MM2,
        wastedArea: (usableUm2 - usedUm2) / UM2_PER_MM2,
        fillPercent: usableUm2 > 0 ? (usedUm2 / usableUm2) * 100 : 0,
      },
    }
  })

  return {
    orientation: packed.orientation,
    sheetWidth: umToMm(packed.sheetWidth),
    sheetHeight: umToMm(packed.sheetHeight),
    margin: umToMm(packed.margin),
    sheets,
    status: packed.status,
    lowerBound: packed.lowerBound,
    unplaceable: packed.unplaceable.map(({ index, reason }) => ({
      piece: input.pieces[index],
      reason,
    })),
    totals: totalsOf(sheets, usedPerSheet, usableUm2),
  }
}

function totalsOf(
  sheets: readonly PlacedSheet[],
  usedPerSheet: readonly number[],
  usableUm2: number,
): LayoutTotals {
  const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0)
  const usedUm2 = sum(usedPerSheet)
  const capacityUm2 = usableUm2 * sheets.length
  const exceptLast = usedPerSheet.slice(0, -1)
  const capacityExceptLast = usableUm2 * exceptLast.length
  return {
    sheetCount: sheets.length,
    pieceCount: sum(sheets.map((s) => s.stats.pieceCount)),
    usableArea: capacityUm2 / UM2_PER_MM2,
    usedArea: usedUm2 / UM2_PER_MM2,
    wastedArea: (capacityUm2 - usedUm2) / UM2_PER_MM2,
    fillPercent: capacityUm2 > 0 ? (usedUm2 / capacityUm2) * 100 : 0,
    fillPercentExceptLast:
      capacityExceptLast > 0 ? (sum(exceptLast) / capacityExceptLast) * 100 : 0,
  }
}
