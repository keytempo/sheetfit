import { lowerBound } from './bounds.ts'
import type { Instance } from './instance.ts'
import type { Objective } from './score.ts'
import type { Solver } from './solver.ts'
import type { PackedLayout, PackedPiece } from './types.ts'

/*
 * Strict order: the list is the contract. Along the list the sheet never goes back, reading order
 * (top to bottom, then left to right) follows the list, and copies of one image stay consecutive.
 *
 * Under that contract the layouts searched here are order-preserving shelf layouts: consecutive
 * pieces form a shelf (a row whose pieces are top-aligned and placed left to right), consecutive
 * shelves are stacked down a sheet, and the next sheet starts when a shelf no longer fits. Within
 * that family the dynamic program below is exact: it chooses every shelf break and every piece's
 * rotation. The state after each prefix of the list is (sheets opened, height used on the last
 * one), ordered lexicographically; that order is a valid dominance because a sheet can always be
 * closed to reach (sheets + 1, 0).
 *
 * Layouts outside the family exist (a piece may sit below and to the left of an earlier one and
 * still read later), so this is the best shelf layout, not a proof of the best strict-order layout.
 */

interface Option {
  width: number
  height: number
  turned: boolean
}

interface Entry {
  index: number
  type: number
  options: Option[]
}

function entriesOf(inst: Instance): Entry[] {
  const entries: Entry[] = []
  inst.types.forEach((t, type) => {
    const options: Option[] = []
    if (t.w <= inst.binW && t.h <= inst.binH)
      options.push({ width: t.w, height: t.h, turned: false })
    if (inst.rotate && t.w !== t.h && t.h <= inst.binW && t.w <= inst.binH) {
      options.push({ width: t.h, height: t.w, turned: true })
    }
    for (const index of t.pieces) entries.push({ index, type, options })
  })
  return entries.sort((a, b) => a.index - b.index)
}

/** The narrowest orientation whose height is at most `height`, or undefined. */
function narrowest(options: readonly Option[], height: number) {
  let best: Option | undefined
  for (const option of options) {
    if (option.height <= height && (!best || option.width < best.width)) best = option
  }
  return best
}

interface Shelf {
  from: number
  to: number
  height: number
}

function bestShelves(inst: Instance, entries: readonly Entry[]): Shelf[] {
  const n = entries.length
  const heights = [...new Set(entries.flatMap((e) => e.options.map((o) => o.height)))].sort(
    (a, b) => a - b,
  )
  // state after the first k pieces: sheets opened and height used on the last sheet
  const sheets = new Array<number>(n + 1).fill(Infinity)
  const used = new Array<number>(n + 1).fill(Infinity)
  const from = new Array<number>(n + 1).fill(-1)
  const shelfHeight = new Array<number>(n + 1).fill(0)
  sheets[0] = 0
  used[0] = 0

  for (let j = 0; j < n; j++) {
    // The shortest shelf that holds pieces j..i. Widths only get smaller as the shelf grows taller, and
    // adding a piece never makes a shelf shorter, so the level only ever moves up.
    let level = 0
    let width = 0
    for (let i = j; i < n; i++) {
      let option = narrowest(entries[i].options, heights[level])
      while (!option || width + option.width > inst.binW) {
        if (++level === heights.length) break
        width = 0
        for (let k = j; k < i; k++) width += narrowest(entries[k].options, heights[level])!.width
        option = narrowest(entries[i].options, heights[level])
      }
      if (level === heights.length) break
      width += option!.width

      const height = heights[level]
      const [s, u] =
        sheets[j] === 0
          ? [1, height]
          : used[j] + height <= inst.binH
            ? [sheets[j], used[j] + height]
            : [sheets[j] + 1, height]
      if (s < sheets[i + 1] || (s === sheets[i + 1] && u < used[i + 1])) {
        sheets[i + 1] = s
        used[i + 1] = u
        from[i + 1] = j
        shelfHeight[i + 1] = height
      }
    }
  }

  const shelves: Shelf[] = []
  for (let end = n; end > 0; end = from[end]) {
    shelves.push({ from: from[end], to: end, height: shelfHeight[end] })
  }
  return shelves.reverse()
}

interface Laid {
  sheets: PackedPiece[][]
  /** Real area on the last sheet. */
  lastUsed: number
}

function lay(inst: Instance, entries: readonly Entry[], shelves: readonly Shelf[]): Laid {
  const sheets: PackedPiece[][] = []
  let top = 0
  let lastUsed = 0
  for (const shelf of shelves) {
    if (sheets.length === 0 || top + shelf.height > inst.binH) {
      sheets.push([])
      top = 0
      lastUsed = 0
    }
    const pieces = sheets[sheets.length - 1]
    let left = 0
    for (let k = shelf.from; k < shelf.to; k++) {
      const entry = entries[k]
      const option = narrowest(entry.options, shelf.height)
      if (!option) throw new Error('A shelf was built around a piece that does not fit it.')
      const width = option.width - inst.gap
      const height = option.height - inst.gap
      pieces.push({
        index: entry.index,
        x: inst.margin + left,
        y: inst.margin + top,
        width,
        height,
        rotated: !(
          width === inst.natural[entry.index * 2] && height === inst.natural[entry.index * 2 + 1]
        ),
      })
      left += option.width
      lastUsed += width * height
    }
    top += shelf.height
  }
  return { sheets, lastUsed }
}

export class StrictSolver implements Solver {
  readonly inst: Instance
  readonly lowerBound: number
  readonly objective: Objective
  readonly finished = true
  private readonly laid: Laid

  constructor(inst: Instance) {
    this.inst = inst
    const entries = entriesOf(inst)
    this.laid = lay(inst, entries, bestShelves(inst, entries))
    this.lowerBound = lowerBound(inst)
    this.objective = {
      unplaceable: inst.unplaceable.length,
      sheets: this.laid.sheets.length,
      minUsed: this.laid.lastUsed,
    }
  }

  step() {
    return false
  }

  toPacked(): PackedLayout {
    const { inst } = this
    return {
      orientation: inst.orientation,
      sheetWidth: inst.sheetW,
      sheetHeight: inst.sheetH,
      margin: inst.margin,
      sheets: this.laid.sheets,
      unplaceable: inst.unplaceable,
      status: this.laid.sheets.length === this.lowerBound ? 'optimal' : 'best-found',
      lowerBound: this.lowerBound,
    }
  }
}
