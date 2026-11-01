import { zeros } from './array.ts'
import { type BlockPattern, bestBlockPattern } from './blocks.ts'
import type { Instance } from './instance.ts'

/*
 * Cutting stock by column generation (Gilmore and Gomory). A pattern is one sheet's layout; the
 * master problem picks how many sheets use each pattern so every type's demand is covered with
 * the fewest sheets. Its dual prices say what a piece of each type is worth, and the pricing
 * problem (the best pattern for those prices) is the block search with prices as piece values.
 * Patterns that beat the price of one sheet are added until none does.
 *
 * The patterns are block layouts, so the optimum of the master is only a guide to what is
 * achievable by such layouts, never a lower bound on the sheets any layout needs.
 */

/** More types than this and the pricing search costs more than the gain is worth. */
export const MAX_STOCK_TYPES = 12

const MAX_ITERATIONS = 40
const TOLERANCE = 1e-9

export interface StockPattern {
  /** [type, x, y, w, h, o] records. */
  placed: number[]
  counts: number[]
}

export interface StockPlan {
  patterns: StockPattern[]
  /** How many whole sheets use each pattern; the fractional part is left for the packer. */
  copies: number[]
}

interface Master {
  /** What one piece of each type is worth to the master. */
  prices: number[]
  /** How many sheets use each pattern, fractionally. */
  sheets: number[]
}

/**
 * Solves the master through its dual: maximise demand . price subject to every pattern's value
 * being at most one sheet. The slack basis is feasible, so the simplex needs no first phase, and
 * the pattern multiplicities are read off the final reduced costs. Bland's rule prevents cycling.
 */
export function solveMaster(patterns: readonly StockPattern[], demand: readonly number[]): Master {
  const types = demand.length
  const count = patterns.length
  const rhs = types + count
  const rows = patterns.map((pattern, i) => {
    const row = zeros(rhs + 1)
    pattern.counts.forEach((c, t) => (row[t] = c))
    row[types + i] = 1
    row[rhs] = 1
    return row
  })
  const cost = zeros(rhs + 1)
  demand.forEach((d, t) => (cost[t] = -d))
  const basis = patterns.map((_, i) => types + i)

  for (;;) {
    let enter = -1
    for (let j = 0; j < rhs; j++) {
      if (cost[j] < -TOLERANCE) {
        enter = j
        break
      }
    }
    if (enter < 0) break

    let leave = -1
    let ratio = Infinity
    for (let i = 0; i < count; i++) {
      const a = rows[i][enter]
      if (a <= TOLERANCE) continue
      const r = rows[i][rhs] / a
      if (r < ratio - TOLERANCE || (Math.abs(r - ratio) <= TOLERANCE && basis[i] < basis[leave])) {
        ratio = r
        leave = i
      }
    }
    if (leave < 0) throw new Error('The cutting-stock master is unbounded.')

    const pivot = rows[leave][enter]
    for (let j = 0; j <= rhs; j++) rows[leave][j] /= pivot
    for (let i = 0; i < count; i++) {
      const f = rows[i][enter]
      if (i === leave || f === 0) continue
      for (let j = 0; j <= rhs; j++) rows[i][j] -= f * rows[leave][j]
    }
    const f = cost[enter]
    for (let j = 0; j <= rhs; j++) cost[j] -= f * rows[leave][j]
    basis[leave] = enter
  }

  const prices = new Array<number>(types).fill(0)
  basis.forEach((b, i) => {
    if (b < types) prices[b] = rows[i][rhs]
  })
  return { prices, sheets: patterns.map((_, i) => cost[types + i]) }
}

/** Plans the sheets for the whole demand, or null when the block search is too costly here. */
export function planStock(inst: Instance, maxWork: number): StockPlan | null {
  const types = inst.types.length
  if (types === 0 || types > MAX_STOCK_TYPES) return null
  const demand = inst.types.map((t) => t.count)
  const options = { fiveBlock: false, maxWork, rotate: inst.rotate }

  const patterns: StockPattern[] = []
  const known = new Set<string>()
  const add = (pattern: BlockPattern | null) => {
    if (!pattern) return false
    const key = pattern.counts.join(',')
    if (known.has(key)) return false
    known.add(key)
    patterns.push({ placed: pattern.placed, counts: pattern.counts })
    return true
  }

  // Start with the best sheet of each type on its own.
  for (let t = 0; t < types; t++) {
    const { w, h, area } = inst.types[t]
    const alone = bestBlockPattern(
      inst.binW,
      inst.binH,
      [{ w, h, area, value: area, limit: Infinity }],
      {
        ...options,
        fiveBlock: true,
      },
    )
    if (!alone) return null
    const placed = alone.placed.slice()
    for (let i = 0; i < placed.length; i += 6) placed[i] = t
    const counts = new Array<number>(types).fill(0)
    counts[t] = alone.counts[0]
    add({ ...alone, placed, counts })
  }

  let master = solveMaster(patterns, demand)
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const priced = bestBlockPattern(
      inst.binW,
      inst.binH,
      inst.types.map((t, i) => ({
        w: t.w,
        h: t.h,
        area: t.area,
        value: master.prices[i],
        limit: Infinity,
      })),
      options,
    )
    if (!priced || priced.value <= 1 + 1e-7 || !add(priced)) break
    master = solveMaster(patterns, demand)
  }
  return { patterns, copies: master.sheets.map((x) => Math.floor(x + 1e-7)) }
}
