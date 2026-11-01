import type { Instance, ItemType } from './instance.ts'

/*
 * Lower bounds on the number of sheets. All three work on the inflated problem (pieces and bin both
 * grown by the gap), which is equivalent to the real one, and none of them assumes an orientation:
 * where rotation is allowed, every piece is charged its cheapest orientation.
 *
 *  - area: the pieces cannot cover more than the sheets hold;
 *  - clique: pieces that can never share a sheet each need a sheet of their own;
 *  - line: a horizontal line crosses pieces whose widths add up to a sum of piece sides, which cannot
 *    exceed the sheet width and need not come close to it; the same holds for vertical lines;
 *  - dual feasible functions (Fekete and Schepers): a transformed "volume" that no sheet can exceed.
 */

/** Rounding slack: a sum that is an integer up to float noise must not round up to the next one. */
const SLACK = 1e-9

const CONSERVATIVE_SCALES = 12
const MAX_THRESHOLDS = 24
const MANY_TYPES = 300

/** The line bound gives up when the sums of sides are too many to list or too many sides are in play. */
const MAX_SUMS = 20_000
const MAX_SIDES = 64

type Dff = (x: number, cap: number) => number

const identity: Dff = (x, cap) => x / cap

/** u_k: values are rounded down to multiples of 1/k unless (k+1)x is itself a whole fraction. */
const conservative =
  (k: number): Dff =>
  (x, cap) => {
    const scaled = (k + 1) * x
    return scaled % cap === 0 ? x / cap : Math.floor(scaled / cap) / k
  }

/** U_e: sides above cap - e count as a whole bin, sides below e count as nothing. */
const threshold =
  (e: number): Dff =>
  (x, cap) =>
    x > cap - e ? 1 : x < e ? 0 : x / cap

/** Every orientation of a type that fits the bin, as [width, height]. */
function orientations(inst: Instance, t: ItemType): number[][] {
  const result: number[][] = []
  if (t.w <= inst.binW && t.h <= inst.binH) result.push([t.w, t.h])
  if (inst.rotate && t.w !== t.h && t.h <= inst.binW && t.w <= inst.binH) result.push([t.h, t.w])
  return result
}

/**
 * Whether two pieces can share a sheet: they must fit side by side or one above the other, in some
 * orientation of each. `a` and `b` are orientation lists as returned by `orientations`.
 */
function canShare(inst: Instance, a: readonly number[][], b: readonly number[][]) {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const aw = a[i][0]
      const ah = a[i][1]
      const bw = b[j][0]
      const bh = b[j][1]
      if (aw + bw <= inst.binW && (ah > bh ? ah : bh) <= inst.binH) return true
      if (ah + bh <= inst.binH && (aw > bw ? aw : bw) <= inst.binW) return true
    }
  }
  return false
}

function areaBound(inst: Instance) {
  let total = 0
  for (const t of inst.types) total += t.count * t.w * t.h
  return Math.ceil(total / (inst.binW * inst.binH) - SLACK)
}

/** The size of a set of pieces that pairwise cannot share a sheet, found greedily from a few seeds. */
function cliqueBound(inst: Instance) {
  const shapes = inst.types.map((t) => orientations(inst, t))
  const order = inst.types
    .map((_, i) => i)
    .sort((a, b) => inst.types[b].w * inst.types[b].h - inst.types[a].w * inst.types[a].h)
  const selfConflict = inst.types.map(
    (t, i) => t.count > 1 && !canShare(inst, shapes[i], shapes[i]),
  )
  let best = 0
  const seeds = inst.types.length > MANY_TYPES ? 1 : Math.min(order.length, 8)
  for (let s = 0; s < seeds; s++) {
    const members: number[] = []
    let size = 0
    for (let k = 0; k < order.length; k++) {
      const type = order[(s + k) % order.length]
      let conflicts = true
      for (let m = 0; m < members.length && conflicts; m++) {
        conflicts = !canShare(inst, shapes[members[m]], shapes[type])
      }
      if (conflicts) {
        members.push(type)
        size += selfConflict[type] ? inst.types[type].count : 1
      }
    }
    best = Math.max(best, size)
  }
  return best
}

/** The largest sum of the sides (each used any number of times) that is at most `cap`, or null if too costly. */
function largestSum(sides: readonly number[], cap: number) {
  const distinct = [...new Set(sides)]
  if (distinct.length > MAX_SIDES) return null
  const seen = new Set([0])
  const sums = [0]
  for (let i = 0; i < sums.length; i++) {
    for (const side of distinct) {
      const next = sums[i] + side
      if (next > cap || seen.has(next)) continue
      seen.add(next)
      sums.push(next)
      if (sums.length > MAX_SUMS) return null
    }
  }
  return Math.max(...sums)
}

/**
 * Every horizontal line covers at most the largest sum of widths that fits, so a sheet holds at most
 * that fraction of its height times the width; likewise for vertical lines. That caps the area one
 * sheet can hold, which is often well below its full area.
 */
function lineBound(inst: Instance) {
  const sides = inst.types.map((t) => orientations(inst, t))
  const across = largestSum(
    sides.flatMap((o) => o.map(([w]) => w)),
    inst.binW,
  )
  const down = largestSum(
    sides.flatMap((o) => o.map(([, h]) => h)),
    inst.binH,
  )
  if (across === null || down === null) return 0
  const capacity = Math.min(across * inst.binH, inst.binW * down)
  let total = 0
  for (const t of inst.types) total += t.count * t.w * t.h
  return Math.ceil(total / capacity - SLACK)
}

/** Candidate thresholds: the distinct piece sides up to half the capacity, thinned to a fixed number. */
function thresholds(sides: number[], cap: number, limit: number) {
  const distinct = [...new Set(sides)].filter((x) => x * 2 <= cap).sort((a, b) => a - b)
  if (distinct.length <= limit) return distinct
  return Array.from(
    { length: limit },
    (_, i) => distinct[Math.floor((i * distinct.length) / limit)],
  )
}

function dffBound(inst: Instance) {
  const many = inst.types.length > MANY_TYPES
  const scales = many ? 4 : CONSERVATIVE_SCALES
  const limit = many ? 6 : MAX_THRESHOLDS
  const widths = inst.types.flatMap((t) => [t.w, t.h])
  const family = (cap: number): Dff[] => [
    identity,
    ...Array.from({ length: scales }, (_, k) => conservative(k + 1)),
    ...thresholds(widths, cap, limit).map(threshold),
  ]
  const forWidth = family(inst.binW)
  const forHeight = family(inst.binH)
  const shapes = inst.types.map((t) => ({ count: t.count, sides: orientations(inst, t) }))

  let best = 0
  for (const u of forWidth) {
    const uValues = shapes.map((s) => s.sides.map(([w]) => u(w, inst.binW)))
    for (const v of forHeight) {
      let volume = 0
      for (let i = 0; i < shapes.length; i++) {
        const { count, sides } = shapes[i]
        let cheapest = Infinity
        for (let o = 0; o < sides.length; o++) {
          const cost = uValues[i][o] * v(sides[o][1], inst.binH)
          if (cost < cheapest) cheapest = cost
        }
        volume += count * cheapest
      }
      const bound = Math.ceil(volume - SLACK)
      if (bound > best) best = bound
    }
  }
  return best
}

/** The largest of the bounds; 0 when there is nothing to place. */
export function lowerBound(inst: Instance) {
  if (inst.placeableCount === 0) return 0
  return Math.max(1, areaBound(inst), lineBound(inst), cliqueBound(inst), dffBound(inst))
}
