import { compact } from './compact.ts'
import type { Instance } from './instance.ts'
import type { PackedLayout, PackedPiece } from './types.ts'
import type { LayoutStatus } from '../lib/layout-types.ts'

/** One sheet's rectangles as [type, x, y, w, h, o] records, plus the real area they cover. */
export interface SheetPlan {
  placed: readonly number[]
  used: number
}

interface Slot {
  /** Position of the sheet in the output. */
  sheet: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * Turns the packer's slots into a finished layout:
 *  - rectangles are slid to the top-left, so free space collects in large pieces;
 *  - the emptiest sheet goes last, the others in order of the first list item they hold;
 *  - the pieces of each interchangeable class are dealt to that class's slots in reading order, in
 *    list order, so earlier items land on earlier sheets and copies of one image stay together.
 * Moving pieces among slots of a class never changes the geometry, so none of this can cost a sheet.
 */
export function assemble(
  inst: Instance,
  plans: readonly SheetPlan[],
  status: LayoutStatus,
  lowerBound: number,
): PackedLayout {
  const sheets = plans.map((plan) => {
    const placed = plan.placed.slice()
    compact(placed)
    return { placed, used: plan.used }
  })

  let order = orderSheets(
    sheets.map((s) => s.used),
    sheets.map((s) => firstIndex(inst, s.placed)),
  )
  let assignment = deal(inst, sheets, order)
  const firsts = sheets.map((_, sheet) => assignment.firstOnSheet(sheet))
  order = orderSheets(
    sheets.map((s) => s.used),
    firsts,
  )
  assignment = deal(inst, sheets, order)

  return {
    orientation: inst.orientation,
    sheetWidth: inst.sheetW,
    sheetHeight: inst.sheetH,
    margin: inst.margin,
    sheets: order.map((sheet) => assignment.pieces(sheet)),
    unplaceable: inst.unplaceable,
    status,
    lowerBound,
  }
}

/** The lowest list index among the classes on a sheet. */
function firstIndex(inst: Instance, placed: readonly number[]) {
  let first = Infinity
  for (let i = 0; i < placed.length; i += 6) {
    first = Math.min(first, inst.types[placed[i]].pieces[0])
  }
  return first
}

/** The emptiest sheet last; every other sheet by `key`, then by its current position. */
function orderSheets(used: readonly number[], key: readonly number[]) {
  if (used.length === 0) return []
  let emptiest = 0
  for (let i = 1; i < used.length; i++) if (used[i] <= used[emptiest]) emptiest = i
  const rest = used.map((_, i) => i).filter((i) => i !== emptiest)
  rest.sort((a, b) => key[a] - key[b] || a - b)
  return [...rest, emptiest]
}

function deal(inst: Instance, sheets: readonly { placed: number[] }[], order: readonly number[]) {
  const slots = inst.types.map(() => [] as Slot[])
  order.forEach((sheet, position) => {
    const { placed } = sheets[sheet]
    for (let i = 0; i < placed.length; i += 6) {
      slots[placed[i]].push({
        sheet: position,
        x: placed[i + 1],
        y: placed[i + 2],
        w: placed[i + 3] - inst.gap,
        h: placed[i + 4] - inst.gap,
      })
    }
  })

  const perSheet: PackedPiece[][] = order.map(() => [])
  inst.types.forEach((type, t) => {
    const ordered = slots[t].sort((a, b) => a.sheet - b.sheet || a.y - b.y || a.x - b.x)
    ordered.forEach((slot, n) => {
      const index = type.pieces[n]
      const width = inst.natural[index * 2]
      const height = inst.natural[index * 2 + 1]
      perSheet[slot.sheet].push({
        index,
        x: inst.margin + slot.x,
        y: inst.margin + slot.y,
        width: slot.w,
        height: slot.h,
        rotated: !(slot.w === width && slot.h === height),
      })
    })
  })
  for (const pieces of perSheet) pieces.sort((a, b) => a.index - b.index)

  return {
    pieces: (sheet: number) => perSheet[order.indexOf(sheet)],
    firstOnSheet: (sheet: number) => perSheet[order.indexOf(sheet)][0]?.index ?? Infinity,
  }
}
