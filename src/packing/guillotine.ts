import type { Fit, PackSheet } from './fit.ts'
import { RULE } from './maxrects.ts'

export const SPLIT = {
  /** Cut along the shorter leftover side, which keeps the longer leftover strip whole. */
  SHORTER_AXIS: 0,
  /** Cut along the longer leftover side. */
  LONGER_AXIS: 1,
} as const

/**
 * Guillotine: the free space is always a set of disjoint rectangles. Placing a piece in one of
 * them leaves an L-shape, which is cut into two rectangles by a single straight cut.
 */
export class GuillotineSheet implements PackSheet {
  placed: number[] = []
  used = 0
  /** Disjoint free rectangles as [x, y, w, h]. */
  private free: number[]
  private maxW: number
  private maxH: number
  readonly binW: number
  readonly binH: number
  private readonly split: number

  constructor(binW: number, binH: number, split: number) {
    this.binW = binW
    this.binH = binH
    this.split = split
    this.free = [0, 0, binW, binH]
    this.maxW = binW
    this.maxH = binH
  }

  fits(w: number, h: number, allow0: boolean, allow1: boolean) {
    return (
      (allow0 && w <= this.maxW && h <= this.maxH) || (allow1 && h <= this.maxW && w <= this.maxH)
    )
  }

  find(w: number, h: number, allow0: boolean, allow1: boolean, rule: number, out: Fit) {
    const free = this.free
    let improved = false
    for (let i = 0; i < free.length; i += 4) {
      const fx = free[i]
      const fy = free[i + 1]
      const fw = free[i + 2]
      const fh = free[i + 3]
      for (let o = 0; o < 2; o++) {
        if (o === 0 ? !allow0 : !allow1) continue
        const pw = o === 0 ? w : h
        const ph = o === 0 ? h : w
        if (pw > fw || ph > fh) continue
        const leftW = fw - pw
        const leftH = fh - ph
        let s1: number
        let s2: number
        if (rule === RULE.BLSF) {
          s1 = leftW > leftH ? leftW : leftH
          s2 = leftW < leftH ? leftW : leftH
        } else if (rule === RULE.BAF) {
          s1 = fw * fh - pw * ph
          s2 = leftW < leftH ? leftW : leftH
        } else {
          s1 = leftW < leftH ? leftW : leftH
          s2 = leftW > leftH ? leftW : leftH
        }
        if (s1 < out.s1 || (s1 === out.s1 && s2 < out.s2)) {
          out.set(s1, s2, fx, fy, pw, ph, o === 0 ? 0 : 1)
          improved = true
        }
      }
    }
    return improved
  }

  put(type: number, fit: Fit, area: number) {
    this.placed.push(type, fit.x, fit.y, fit.w, fit.h, fit.o)
    this.used += area
    const free = this.free
    for (let i = 0; i < free.length; i += 4) {
      if (free[i] !== fit.x || free[i + 1] !== fit.y) continue
      const fw = free[i + 2]
      const fh = free[i + 3]
      free.splice(i, 4)
      const leftW = fw - fit.w
      const leftH = fh - fit.h
      const verticalCut = this.split === SPLIT.SHORTER_AXIS ? leftW <= leftH : leftW > leftH
      if (verticalCut) {
        if (leftW > 0) free.push(fit.x + fit.w, fit.y, leftW, fh)
        if (leftH > 0) free.push(fit.x, fit.y + fit.h, fit.w, leftH)
      } else {
        if (leftW > 0) free.push(fit.x + fit.w, fit.y, leftW, fit.h)
        if (leftH > 0) free.push(fit.x, fit.y + fit.h, fw, leftH)
      }
      break
    }
    this.merge()
  }

  /** Joins neighbours that share a full side, so leftover space stays in large pieces. */
  private merge() {
    const free = this.free
    let merged = true
    while (merged) {
      merged = false
      for (let i = 0; i < free.length && !merged; i += 4) {
        for (let j = i + 4; j < free.length; j += 4) {
          const sameColumn = free[i] === free[j] && free[i + 2] === free[j + 2]
          const sameRow = free[i + 1] === free[j + 1] && free[i + 3] === free[j + 3]
          if (sameColumn && free[i + 1] + free[i + 3] === free[j + 1]) {
            free[i + 3] += free[j + 3]
          } else if (sameColumn && free[j + 1] + free[j + 3] === free[i + 1]) {
            free[i + 1] = free[j + 1]
            free[i + 3] += free[j + 3]
          } else if (sameRow && free[i] + free[i + 2] === free[j]) {
            free[i + 2] += free[j + 2]
          } else if (sameRow && free[j] + free[j + 2] === free[i]) {
            free[i] = free[j]
            free[i + 2] += free[j + 2]
          } else {
            continue
          }
          free.splice(j, 4)
          merged = true
          break
        }
      }
    }
    let maxW = 0
    let maxH = 0
    for (let i = 0; i < free.length; i += 4) {
      if (free[i + 2] > maxW) maxW = free[i + 2]
      if (free[i + 3] > maxH) maxH = free[i + 3]
    }
    this.maxW = maxW
    this.maxH = maxH
  }
}
