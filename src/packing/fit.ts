/** The best position found so far for one rectangle; lower scores are better. */
export class Fit {
  s1 = Infinity
  s2 = Infinity
  x = 0
  y = 0
  /** Footprint after the chosen orientation. */
  w = 0
  h = 0
  /** 0 keeps the type's own sides, 1 turns it 90°. */
  o: 0 | 1 = 0

  reset() {
    this.s1 = Infinity
    this.s2 = Infinity
  }

  set(s1: number, s2: number, x: number, y: number, w: number, h: number, o: 0 | 1) {
    this.s1 = s1
    this.s2 = s2
    this.x = x
    this.y = y
    this.w = w
    this.h = h
    this.o = o
  }
}

/** One sheet that rectangles can be placed on, one at a time. */
export interface PackSheet {
  /** Real area covered, in square micrometres. */
  used: number
  /** Flat records of [type, x, y, w, h, o] for every placed rectangle. */
  placed: number[]
  /** A quick, necessary test: false means the rectangle certainly does not fit. */
  fits(w: number, h: number, allow0: boolean, allow1: boolean): boolean
  /** Updates `out` and returns true when this sheet has a strictly better position than it holds. */
  find(w: number, h: number, allow0: boolean, allow1: boolean, rule: number, out: Fit): boolean
  put(type: number, fit: Fit, area: number): void
}
