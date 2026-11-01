import type { Fit, PackSheet } from './fit.ts'

export const SKYLINE_RULE = {
  /** Lowest bottom edge, then leftmost. */
  TOP_LEFT: 0,
  /** Least empty space trapped under the piece, then lowest bottom edge. */
  MIN_WASTE: 1,
} as const

/**
 * Skyline: the occupied depth below the top edge is kept per column span. A piece rests on the
 * deepest span it covers, and the space it leaves open underneath is given up.
 */
export class SkylineSheet implements PackSheet {
  placed: number[] = []
  used = 0
  /** Spans of [x, depth, width], left to right, covering the whole width. */
  private spans: number[]
  private minDepth = 0

  readonly binW: number
  readonly binH: number

  constructor(binW: number, binH: number) {
    this.binW = binW
    this.binH = binH
    this.spans = [0, 0, binW]
  }

  fits(w: number, h: number, allow0: boolean, allow1: boolean) {
    const room = this.binH - this.minDepth
    return (allow0 && w <= this.binW && h <= room) || (allow1 && h <= this.binW && w <= room)
  }

  find(w: number, h: number, allow0: boolean, allow1: boolean, rule: number, out: Fit) {
    let improved = false
    if (allow0 && this.search(w, h, 0, rule, out)) improved = true
    if (allow1 && this.search(h, w, 1, rule, out)) improved = true
    return improved
  }

  private search(w: number, h: number, o: 0 | 1, rule: number, out: Fit) {
    const spans = this.spans
    let improved = false
    for (let i = 0; i < spans.length; i += 3) {
      const x = spans[i]
      if (x + w > this.binW) break
      let depth = 0
      let covered = 0
      for (let j = i; covered < w; j += 3) {
        if (spans[j + 1] > depth) depth = spans[j + 1]
        covered += spans[j + 2]
      }
      if (depth + h > this.binH) continue

      let s1 = depth + h
      let s2 = x
      if (rule === SKYLINE_RULE.MIN_WASTE) {
        let waste = 0
        let remaining = w
        for (let j = i; remaining > 0; j += 3) {
          const take = spans[j + 2] < remaining ? spans[j + 2] : remaining
          waste += (depth - spans[j + 1]) * take
          remaining -= take
        }
        s2 = s1
        s1 = waste
      }
      if (s1 < out.s1 || (s1 === out.s1 && s2 < out.s2)) {
        out.set(s1, s2, x, depth, w, h, o)
        improved = true
      }
    }
    return improved
  }

  put(type: number, fit: Fit, area: number) {
    this.placed.push(type, fit.x, fit.y, fit.w, fit.h, fit.o)
    this.used += area
    this.raise(fit.x, fit.x + fit.w, fit.y + fit.h)
  }

  /** Makes the columns from `left` to `right` as deep as `depth`. */
  private raise(left: number, right: number, depth: number) {
    const next: number[] = []
    let inserted = false
    const spans = this.spans
    for (let i = 0; i < spans.length; i += 3) {
      const x = spans[i]
      const end = x + spans[i + 2]
      if (end <= left || x >= right) {
        if (!inserted && x >= right) {
          next.push(left, depth, right - left)
          inserted = true
        }
        next.push(x, spans[i + 1], spans[i + 2])
        continue
      }
      if (x < left) next.push(x, spans[i + 1], left - x)
      if (!inserted) {
        next.push(left, depth, right - left)
        inserted = true
      }
      if (end > right) next.push(right, spans[i + 1], end - right)
    }
    if (!inserted) next.push(left, depth, right - left)

    const merged: number[] = []
    let min = Infinity
    for (let i = 0; i < next.length; i += 3) {
      const last = merged.length - 3
      if (last >= 0 && merged[last + 1] === next[i + 1]) merged[last + 2] += next[i + 2]
      else merged.push(next[i], next[i + 1], next[i + 2])
      if (next[i + 1] < min) min = next[i + 1]
    }
    this.spans = merged
    this.minDepth = min
  }
}
