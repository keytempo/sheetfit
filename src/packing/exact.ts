import type { SheetPlan } from './assemble.ts'
import type { Instance } from './instance.ts'

/*
 * An exact solver for a handful of pieces. It splits the pieces over k sheets, for k = 1, 2, ...,
 * and decides what each sheet can hold with a complete search.
 *
 * One sheet: every stable layout (pushed up and left until nothing moves) has each top edge at 0 or
 * on the bottom edge of a piece that comes earlier in reading order, and each left edge at a sum of
 * piece sides. So pieces are placed in reading order, at those tops and lefts only, and the search
 * is complete. Identical pieces are interchangeable, which removes most of the repeated work.
 */

/** Search nodes one sheet check may spend before it gives up. */
const NODES_PER_SHEET = 400_000

interface Piece {
  type: number
  w: number
  h: number
  /** The other orientation, when rotation is allowed and it differs. */
  turned: boolean
}

interface Placement {
  piece: number
  x: number
  y: number
  w: number
  h: number
  o: 0 | 1
}

type Verdict = Placement[] | 'no' | 'unknown'

class SheetCheck {
  private readonly binW: number
  private readonly binH: number
  private readonly pieces: readonly Piece[]
  private readonly rotate: boolean
  private nodes = 0
  private placements: Placement[] = []
  private used: boolean[] = []
  private xs: number[] = []

  constructor(binW: number, binH: number, pieces: readonly Piece[], rotate: boolean) {
    this.binW = binW
    this.binH = binH
    this.pieces = pieces
    this.rotate = rotate
  }

  check(members: readonly number[]): Verdict {
    let area = 0
    for (const m of members) area += this.pieces[m].w * this.pieces[m].h
    if (area > this.binW * this.binH) return 'no'
    this.nodes = 0
    this.placements = []
    this.used = this.pieces.map(() => false)
    this.xs = this.leftEdges(members)
    const found = this.search(members, 0, 0, 0)
    if (found) return this.placements.slice()
    return this.nodes > NODES_PER_SHEET ? 'unknown' : 'no'
  }

  /** Every sum of one side (either orientation) from some of the pieces, that leaves room. */
  private leftEdges(members: readonly number[]) {
    let sums = new Set([0])
    for (const m of members) {
      const piece = this.pieces[m]
      const next = new Set(sums)
      for (const s of sums) {
        if (s + piece.w < this.binW) next.add(s + piece.w)
        if (this.rotate && s + piece.h < this.binW) next.add(s + piece.h)
      }
      sums = next
    }
    return [...sums].sort((a, b) => a - b)
  }

  private search(
    members: readonly number[],
    placed: number,
    prevY: number,
    prevX: number,
  ): boolean {
    if (placed === members.length) return true
    if (++this.nodes > NODES_PER_SHEET) return false

    const tops = new Set([0])
    for (const p of this.placements) tops.add(p.y + p.h)
    const ys = [...tops].filter((y) => y >= prevY).sort((a, b) => a - b)

    const tried = new Set<number>()
    for (const m of members) {
      if (this.used[m]) continue
      const piece = this.pieces[m]
      if (tried.has(piece.type)) continue
      tried.add(piece.type)

      for (let o = 0; o < (piece.turned ? 2 : 1); o++) {
        const w = o === 0 ? piece.w : piece.h
        const h = o === 0 ? piece.h : piece.w
        if (w > this.binW || h > this.binH) continue
        for (const y of ys) {
          if (y + h > this.binH) break
          for (const x of this.xs) {
            if (x + w > this.binW) break
            if (y === prevY && x < prevX) continue
            if (this.overlaps(x, y, w, h)) continue
            this.used[m] = true
            this.placements.push({ piece: m, x, y, w, h, o: o === 0 ? 0 : 1 })
            if (this.search(members, placed + 1, y, x)) return true
            this.placements.pop()
            this.used[m] = false
            if (this.nodes > NODES_PER_SHEET) return false
          }
        }
      }
    }
    return false
  }

  private overlaps(x: number, y: number, w: number, h: number) {
    for (const p of this.placements) {
      if (x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + h) return true
    }
    return false
  }
}

export interface ExactOutcome {
  /** A layout on fewer than `best` sheets, or null when none was found. */
  plans: SheetPlan[] | null
  /** True when the sheet count of the answer (`best` if there are no plans) is proven optimal. */
  optimal: boolean
}

/**
 * Looks for a layout on fewer than `best` sheets, trying `floor`, `floor + 1`, ... in turn, so
 * the first one found is the optimum. Sheet counts below `floor` must already be ruled out.
 */
export function solveExact(inst: Instance, floor: number, best: number): ExactOutcome {
  const pieces: Piece[] = []
  inst.types.forEach((t, type) => {
    const turned = inst.rotate && t.w !== t.h && t.h <= inst.binW && t.w <= inst.binH
    for (let c = 0; c < t.count; c++) pieces.push({ type, w: t.w, h: t.h, turned })
  })
  pieces.sort((a, b) => b.w * b.h - a.w * a.h || a.type - b.type)

  const checker = new SheetCheck(inst.binW, inst.binH, pieces, inst.rotate)
  const memo = new Map<number, Verdict>()
  let complete = true
  const verdict = (mask: number): Verdict => {
    let v = memo.get(mask)
    if (v === undefined) {
      const members: number[] = []
      for (let i = 0; i < pieces.length; i++) if (mask & (1 << i)) members.push(i)
      v = checker.check(members)
      memo.set(mask, v)
      if (v === 'unknown') complete = false
    }
    return v
  }

  for (let k = Math.max(1, floor); k < best; k++) {
    const masks: number[] = []
    const assign = (i: number): boolean => {
      if (i === pieces.length) return true
      for (let b = 0; b <= masks.length && b < k; b++) {
        const before = b < masks.length ? masks[b] : 0
        const mask = before | (1 << i)
        if (typeof verdict(mask) === 'string') continue
        if (b === masks.length) masks.push(mask)
        else masks[b] = mask
        if (assign(i + 1)) return true
        if (before === 0) masks.pop()
        else masks[b] = before
      }
      return false
    }
    if (assign(0)) {
      const plans = masks.map((mask): SheetPlan => {
        const placed: number[] = []
        let used = 0
        for (const p of verdict(mask) as Placement[]) {
          placed.push(pieces[p.piece].type, p.x, p.y, p.w, p.h, p.o)
          used += inst.types[pieces[p.piece].type].area
        }
        return { placed, used }
      })
      return { plans, optimal: complete }
    }
  }
  return { plans: null, optimal: complete }
}
