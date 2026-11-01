import { Fit, type PackSheet } from './fit.ts'

/** How MaxRects scores a position. All of them prefer the top-left among equals. */
export const RULE = {
  /** Best short side fit: the smallest leftover on the nearer side. */
  BSSF: 0,
  /** Best long side fit. */
  BLSF: 1,
  /** Best area fit: the free rectangle with the least area to spare. */
  BAF: 2,
  /** Top-left: the lowest bottom edge, then the leftmost. */
  BL: 3,
  /** Contact point: the most edge shared with the sheet border and placed pieces. */
  CP: 4,
} as const

function overlap(a0: number, a1: number, b0: number, b1: number) {
  const low = a0 > b0 ? a0 : b0
  const high = a1 < b1 ? a1 : b1
  return high > low ? high - low : 0
}

/**
 * MaxRects: the free space is a list of maximal free rectangles (they may overlap each other).
 * Placing a piece splits every free rectangle it touches and drops the ones that become redundant.
 */
export class MaxRectsSheet implements PackSheet {
  free: number[]
  placed: number[] = []
  used = 0
  private maxW: number
  private maxH: number
  private second = 0
  private spare: number[] = []

  readonly binW: number
  readonly binH: number

  constructor(binW: number, binH: number) {
    this.binW = binW
    this.binH = binH
    this.free = [0, 0, binW, binH]
    this.maxW = binW
    this.maxH = binH
  }

  /** Rebuilds a sheet from placements, for example a pattern or another packer's result. */
  static fromPlaced(binW: number, binH: number, placed: readonly number[], used: number) {
    const sheet = new MaxRectsSheet(binW, binH)
    for (let i = 0; i < placed.length; i += 6) {
      sheet.carve(placed[i + 1], placed[i + 2], placed[i + 3], placed[i + 4])
      sheet.placed.push(
        placed[i],
        placed[i + 1],
        placed[i + 2],
        placed[i + 3],
        placed[i + 4],
        placed[i + 5],
      )
    }
    sheet.used = used
    return sheet
  }

  clone() {
    const copy = new MaxRectsSheet(this.binW, this.binH)
    copy.free = this.free.slice()
    copy.placed = this.placed.slice()
    copy.used = this.used
    copy.maxW = this.maxW
    copy.maxH = this.maxH
    return copy
  }

  get count() {
    return this.placed.length / 6
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
      if (allow0 && w <= fw && h <= fh) {
        const s1 = this.rate(rule, fx, fy, fw, fh, w, h)
        if (s1 < out.s1 || (s1 === out.s1 && this.second < out.s2)) {
          out.set(s1, this.second, fx, fy, w, h, 0)
          improved = true
        }
      }
      if (allow1 && h <= fw && w <= fh) {
        const s1 = this.rate(rule, fx, fy, fw, fh, h, w)
        if (s1 < out.s1 || (s1 === out.s1 && this.second < out.s2)) {
          out.set(s1, this.second, fx, fy, h, w, 1)
          improved = true
        }
      }
    }
    return improved
  }

  /** Returns the primary score and leaves the tie-break in `this.second`. */
  private rate(rule: number, fx: number, fy: number, fw: number, fh: number, w: number, h: number) {
    const leftW = fw - w
    const leftH = fh - h
    switch (rule) {
      case RULE.BSSF:
        this.second = leftW > leftH ? leftW : leftH
        return leftW < leftH ? leftW : leftH
      case RULE.BLSF:
        this.second = leftW < leftH ? leftW : leftH
        return leftW > leftH ? leftW : leftH
      case RULE.BAF:
        this.second = leftW < leftH ? leftW : leftH
        return fw * fh - w * h
      case RULE.BL:
        this.second = fx
        return fy + h
      default:
        this.second = fy + h
        return -this.contact(fx, fy, w, h)
    }
  }

  private contact(x: number, y: number, w: number, h: number) {
    let total = 0
    if (x === 0) total += h
    if (x + w === this.binW) total += h
    if (y === 0) total += w
    if (y + h === this.binH) total += w
    const placed = this.placed
    for (let i = 0; i < placed.length; i += 6) {
      const px = placed[i + 1]
      const py = placed[i + 2]
      const pw = placed[i + 3]
      const ph = placed[i + 4]
      if (px === x + w || px + pw === x) total += overlap(y, y + h, py, py + ph)
      if (py === y + h || py + ph === y) total += overlap(x, x + w, px, px + pw)
    }
    return total
  }

  put(type: number, fit: Fit, area: number) {
    this.carve(fit.x, fit.y, fit.w, fit.h)
    this.placed.push(type, fit.x, fit.y, fit.w, fit.h, fit.o)
    this.used += area
  }

  /** Removes the rectangle from the free space. */
  private carve(px: number, py: number, pw: number, ph: number) {
    const free = this.free
    const kept = this.spare
    kept.length = 0
    const fresh: number[] = []
    const right = px + pw
    const bottom = py + ph
    for (let i = 0; i < free.length; i += 4) {
      const fx = free[i]
      const fy = free[i + 1]
      const fw = free[i + 2]
      const fh = free[i + 3]
      const fRight = fx + fw
      const fBottom = fy + fh
      if (px >= fRight || right <= fx || py >= fBottom || bottom <= fy) {
        kept.push(fx, fy, fw, fh)
        continue
      }
      if (px > fx) fresh.push(fx, fy, px - fx, fh)
      if (right < fRight) fresh.push(right, fy, fRight - right, fh)
      if (py > fy) fresh.push(fx, fy, fw, py - fy)
      if (bottom < fBottom) fresh.push(fx, bottom, fw, fBottom - bottom)
    }

    // Only the new rectangles can be redundant, and they can make old ones redundant.
    const out: number[] = []
    let maxW = 0
    let maxH = 0
    for (let i = 0; i < fresh.length; i += 4) {
      if (!this.isRedundantFresh(fresh, i, kept)) {
        out.push(fresh[i], fresh[i + 1], fresh[i + 2], fresh[i + 3])
        if (fresh[i + 2] > maxW) maxW = fresh[i + 2]
        if (fresh[i + 3] > maxH) maxH = fresh[i + 3]
      }
    }
    const freshEnd = out.length
    for (let i = 0; i < kept.length; i += 4) {
      let redundant = false
      for (let j = 0; j < freshEnd; j += 4) {
        if (
          kept[i] >= out[j] &&
          kept[i + 1] >= out[j + 1] &&
          kept[i] + kept[i + 2] <= out[j] + out[j + 2] &&
          kept[i + 1] + kept[i + 3] <= out[j + 1] + out[j + 3]
        ) {
          redundant = true
          break
        }
      }
      if (!redundant) {
        out.push(kept[i], kept[i + 1], kept[i + 2], kept[i + 3])
        if (kept[i + 2] > maxW) maxW = kept[i + 2]
        if (kept[i + 3] > maxH) maxH = kept[i + 3]
      }
    }
    this.spare = free
    this.free = out
    this.maxW = maxW
    this.maxH = maxH
  }

  /** True when fresh[i] lies inside a kept rectangle or inside another fresh one (the first wins ties). */
  private isRedundantFresh(fresh: number[], i: number, kept: number[]) {
    const x = fresh[i]
    const y = fresh[i + 1]
    const r = x + fresh[i + 2]
    const b = y + fresh[i + 3]
    for (let j = 0; j < kept.length; j += 4) {
      if (
        x >= kept[j] &&
        y >= kept[j + 1] &&
        r <= kept[j] + kept[j + 2] &&
        b <= kept[j + 1] + kept[j + 3]
      ) {
        return true
      }
    }
    for (let j = 0; j < fresh.length; j += 4) {
      if (j === i) continue
      const inside =
        x >= fresh[j] &&
        y >= fresh[j + 1] &&
        r <= fresh[j] + fresh[j + 2] &&
        b <= fresh[j + 1] + fresh[j + 3]
      if (!inside) continue
      const identical =
        fresh[j] === x && fresh[j + 1] === y && fresh[j + 2] === r - x && fresh[j + 3] === b - y
      if (!identical || j < i) return true
    }
    return false
  }
}
