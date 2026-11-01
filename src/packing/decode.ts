import { Fit, type PackSheet } from './fit.ts'
import type { Instance } from './instance.ts'

/** How a placement may orient one item: either way, only its own sides, or only turned. */
export const MODE = { FREE: 0, UPRIGHT: 1, TURNED: 2 } as const

interface Allowed {
  allow0: boolean
  allow1: boolean
}

/** Which orientations of `type` fit the bin at all, narrowed by `mode` where that is possible. */
export function allowedOrientations(inst: Instance, type: number, mode: number, into: Allowed) {
  const t = inst.types[type]
  const fits0 = t.w <= inst.binW && t.h <= inst.binH
  const fits1 = inst.rotate && t.w !== t.h && t.h <= inst.binW && t.w <= inst.binH
  into.allow0 = fits0
  into.allow1 = fits1
  if (mode === MODE.UPRIGHT && fits0) into.allow1 = false
  else if (mode === MODE.TURNED && fits1) into.allow0 = false
}

const fit = new Fit()
const allowed: Allowed = { allow0: false, allow1: false }

/**
 * Places the items in the given order. Each goes where the rule rates it best across every
 * sheet in `sheets`, and a new sheet is opened only when it fits on none of them.
 *
 * `writable` lets a caller that shares sheets between solutions swap in a private copy
 * before a sheet is written to.
 */
export function packItems<S extends PackSheet>(
  inst: Instance,
  sheets: S[],
  make: () => S,
  items: ArrayLike<number>,
  modes: ArrayLike<number> | null,
  rule: number,
  writable?: (index: number) => S,
) {
  for (let n = 0; n < items.length; n++) {
    const type = items[n]
    allowedOrientations(inst, type, modes === null ? MODE.FREE : modes[n], allowed)
    const { allow0, allow1 } = allowed
    const t = inst.types[type]

    fit.reset()
    let best = -1
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i]
      if (sheet.fits(t.w, t.h, allow0, allow1) && sheet.find(t.w, t.h, allow0, allow1, rule, fit)) {
        best = i
      }
    }
    if (best < 0) {
      best = sheets.length
      sheets.push(make())
      sheets[best].find(t.w, t.h, allow0, allow1, rule, fit)
    }
    const target = writable ? writable(best) : sheets[best]
    target.put(type, fit, t.area)
  }
}

/** Expands type ids into one entry per piece, taking the types in the given order. */
export function expandItems(
  inst: Instance,
  typeOrder: readonly number[],
  counts: readonly number[] = inst.types.map((t) => t.count),
): number[] {
  const items: number[] = []
  for (const type of typeOrder) {
    for (let c = 0; c < counts[type]; c++) items.push(type)
  }
  return items
}
