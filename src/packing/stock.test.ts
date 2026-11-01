import { describe, expect, it } from 'vitest'
import { buildInstance } from './instance.ts'
import { Random } from './random.ts'
import { inputOf } from './testing/fixtures.ts'
import { MAX_STOCK_TYPES, planStock, solveMaster, type StockPattern } from './stock.ts'

const pattern = (...counts: number[]): StockPattern => ({ placed: [], counts })

describe('cutting-stock master', () => {
  it('solves a small problem by hand', () => {
    const master = solveMaster([pattern(2, 0), pattern(0, 3), pattern(1, 1)], [4, 6])
    expect(master.sheets.reduce((a, b) => a + b, 0)).toBeCloseTo(4, 9)
    expect(master.sheets[0]).toBeCloseTo(2, 9)
    expect(master.sheets[1]).toBeCloseTo(2, 9)
  })

  it('returns a certified optimum: feasible, dual feasible, equal objectives', () => {
    const rng = new Random(5)
    for (let trial = 0; trial < 200; trial++) {
      const types = 2 + rng.int(5)
      const demand = Array.from({ length: types }, () => 1 + rng.int(40))
      const patterns = Array.from({ length: types }, (_, t) =>
        pattern(...Array.from({ length: types }, (_, u) => (u === t ? 1 + rng.int(6) : 0))),
      )
      for (let extra = rng.int(12); extra > 0; extra--) {
        patterns.push(
          pattern(...Array.from({ length: types }, () => (rng.chance(0.5) ? rng.int(5) : 0))),
        )
      }
      const { prices, sheets } = solveMaster(patterns, demand)
      const eps = 1e-6
      // Primal feasible: every demand is covered.
      for (let t = 0; t < types; t++) {
        const supplied = patterns.reduce((sum, p, i) => sum + p.counts[t] * sheets[i], 0)
        expect(supplied).toBeGreaterThanOrEqual(demand[t] - eps)
      }
      expect(Math.min(...sheets)).toBeGreaterThanOrEqual(-eps)
      // Dual feasible: no pattern is worth more than one sheet at these prices.
      for (const p of patterns) {
        expect(p.counts.reduce((sum, c, t) => sum + c * prices[t], 0)).toBeLessThanOrEqual(1 + eps)
      }
      expect(Math.min(...prices)).toBeGreaterThanOrEqual(-eps)
      // Strong duality: the two objectives agree, so neither can be improved.
      const primal = sheets.reduce((a, b) => a + b, 0)
      const dual = demand.reduce((sum, d, t) => sum + d * prices[t], 0)
      expect(Math.abs(primal - dual)).toBeLessThan(1e-6 * Math.max(1, primal))
    }
  })
})

describe('stock plan', () => {
  const images = [
    { width: 35, height: 45, copies: 120 },
    { width: 50.8, height: 50.8, copies: 36 },
    { width: 101.6, height: 152.4, copies: 24 },
    { width: 127, height: 177.8, copies: 18 },
  ]

  it('uses block layouts that stay inside the sheet and never overlap', () => {
    const inst = buildInstance(inputOf(images), 'portrait')
    const plan = planStock(inst, 4_000_000)
    expect(plan).not.toBeNull()
    for (const { placed, counts } of plan!.patterns) {
      const seen = counts.map(() => 0)
      for (let i = 0; i < placed.length; i += 6) {
        seen[placed[i]]++
        expect(placed[i + 1] + placed[i + 3]).toBeLessThanOrEqual(inst.binW)
        expect(placed[i + 2] + placed[i + 4]).toBeLessThanOrEqual(inst.binH)
        for (let j = i + 6; j < placed.length; j += 6) {
          const apart =
            placed[i + 1] + placed[i + 3] <= placed[j + 1] ||
            placed[j + 1] + placed[j + 3] <= placed[i + 1] ||
            placed[i + 2] + placed[i + 4] <= placed[j + 2] ||
            placed[j + 2] + placed[j + 4] <= placed[i + 2]
          expect(apart).toBe(true)
        }
      }
      expect(seen).toEqual(counts)
    }
  })

  it('covers no more than the whole demand with whole sheets, up to rounding', () => {
    const inst = buildInstance(inputOf(images), 'portrait')
    const plan = planStock(inst, 4_000_000)!
    inst.types.forEach((type, t) => {
      const supplied = plan.patterns.reduce((sum, p, i) => sum + p.counts[t] * plan.copies[i], 0)
      // Rounding down can only over-supply a type when the master had slack in it.
      expect(supplied).toBeGreaterThan(0)
      expect(supplied).toBeLessThanOrEqual(
        type.count + Math.max(...plan.patterns.map((p) => p.counts[t])),
      )
    })
  })

  it('declines when there are too many types for the pricing search', () => {
    const many = Array.from({ length: MAX_STOCK_TYPES + 1 }, (_, i) => ({
      width: 20 + i,
      height: 30,
      copies: 3,
    }))
    expect(planStock(buildInstance(inputOf(many), 'portrait'), 4_000_000)).toBeNull()
  })
})
