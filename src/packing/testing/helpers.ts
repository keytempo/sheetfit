import type { LayoutResult } from '../../lib/layout-types.ts'

/** Everything about a layout that matters, as a string, so two layouts can be compared. */
export function signature(layout: LayoutResult) {
  return JSON.stringify([
    layout.orientation,
    layout.status,
    layout.lowerBound,
    layout.sheets.map((s) =>
      s.pieces.map((p) => [p.piece.id, p.x, p.y, p.width, p.height, p.rotated]),
    ),
    (layout.unplaceable ?? []).map((u) => [u.piece.id, u.reason]),
  ])
}

/** The figures a published improvement is judged on: sheets, then the emptiest sheet's used area. */
export function objectiveOf(layout: LayoutResult) {
  const used = layout.sheets.map((s) => s.stats.usedArea)
  return { sheets: layout.sheets.length, minUsed: used.length ? Math.min(...used) : 0 }
}

export function strictlyBetter(a: LayoutResult, b: LayoutResult) {
  const x = objectiveOf(a)
  const y = objectiveOf(b)
  return x.sheets < y.sheets || (x.sheets === y.sheets && x.minUsed < y.minUsed - 1e-9)
}

/** True when two layouts are identical in every way that matters. Cheap to print on failure. */
export function sameLayout(a: LayoutResult, b: LayoutResult) {
  return signature(a) === signature(b)
}
