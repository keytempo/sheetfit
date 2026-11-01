import { type BlockPattern, bestBlockPattern } from './blocks.ts'
import type { Instance } from './instance.ts'
import { MaxRectsSheet } from './maxrects.ts'
import { planStock } from './stock.ts'

/** How hard pattern generation tries; the quick path uses small limits so it stays instant. */
export interface PatternEffort {
  /** Inner-loop steps one block search may spend. */
  maxWork: number
  /** How many types, largest total area first, get a pattern of their own. */
  singleTypes: number
  /** Whether to also look for patterns that mix several types. */
  mixed: boolean
  /**
   * A pattern is only used when it covers at least this share of a sheet. Patterns that fit badly
   * would swallow the small pieces that are better spent filling the holes between larger ones.
   */
  minFill: number
  /** Plan with column generation when the number of types allows, rather than greedily. */
  stock?: boolean
}

export const QUICK_EFFORT: PatternEffort = {
  maxWork: 2_000_000,
  singleTypes: 3,
  mixed: false,
  minFill: 0.9,
}
export const DEEP_EFFORT: PatternEffort = {
  maxWork: 40_000_000,
  singleTypes: 12,
  mixed: true,
  minFill: 0.9,
}
export const QUICK_STOCK_EFFORT: PatternEffort = {
  maxWork: 1_000_000,
  singleTypes: 0,
  mixed: false,
  minFill: 0,
  stock: true,
}
export const STOCK_EFFORT: PatternEffort = {
  maxWork: 4_000_000,
  singleTypes: 0,
  mixed: false,
  minFill: 0,
  stock: true,
}

/** The most types a mixed pattern is searched over; the raster grows quickly with each one. */
const MIXED_TYPES = 3

/** A pattern together with the types its records refer to. */
interface Candidate {
  pattern: BlockPattern
  types: number[]
}

export interface PatternResult {
  sheets: MaxRectsSheet[]
  /** How many pieces of each type are still to be placed. */
  residual: number[]
}

/**
 * Cutting-stock style construction: find a dense pattern, use it on as many sheets as the demand
 * covers completely, update the demand, repeat. A pattern only counts when it fits what is left of
 * every type it uses, so no sheet is ever a stripped-down copy of a pattern.
 */
export function patternSheets(inst: Instance, effort: PatternEffort): PatternResult {
  if (effort.stock) {
    const planned = stockSheets(inst, effort.maxWork)
    if (planned) return planned
  }
  const residual = inst.types.map((t) => t.count)
  const sheets: MaxRectsSheet[] = []
  const singles = new Map<number, BlockPattern | null>()

  const single = (type: number) => {
    if (!singles.has(type)) {
      const t = inst.types[type]
      singles.set(
        type,
        bestBlockPattern(
          inst.binW,
          inst.binH,
          [{ w: t.w, h: t.h, area: t.area, value: t.area, limit: t.count }],
          {
            fiveBlock: true,
            maxWork: effort.maxWork,
            rotate: inst.rotate,
          },
        ),
      )
    }
    return singles.get(type) ?? null
  }

  for (;;) {
    const open = residual
      .map((left, type) => ({ type, left, area: left * inst.types[type].area }))
      .filter((e) => e.left >= 2)
      .sort((a, b) => b.area - a.area || a.type - b.type)
    if (open.length === 0) break

    const candidates: Candidate[] = []
    const consider = (pattern: BlockPattern | null, types: number[]) => {
      if (!pattern) return
      if (!types.every((t, k) => pattern.counts[k] >= 1 && pattern.counts[k] <= residual[t])) return
      if (pattern.area < effort.minFill * inst.binW * inst.binH) return
      candidates.push({ pattern, types })
    }

    for (const { type } of open.slice(0, effort.singleTypes)) consider(single(type), [type])

    if (effort.mixed) {
      let group = open.slice(0, MIXED_TYPES).map((e) => e.type)
      while (group.length >= 2) {
        const pattern = bestBlockPattern(
          inst.binW,
          inst.binH,
          group.map((t) => ({
            w: inst.types[t].w,
            h: inst.types[t].h,
            area: inst.types[t].area,
            value: inst.types[t].area,
            limit: residual[t],
          })),
          { fiveBlock: false, maxWork: effort.maxWork, rotate: inst.rotate },
        )
        if (!pattern) break
        const overused = group.filter((t, k) => pattern.counts[k] > residual[t])
        if (overused.length === 0) {
          consider(pattern, group)
          break
        }
        group = group.filter((t) => !overused.includes(t))
      }
    }
    const chosen = candidates.reduce<Candidate | null>(
      (best, c) => (!best || c.pattern.area > best.pattern.area ? c : best),
      null,
    )
    if (!chosen) break

    const { pattern, types } = chosen
    const copies = Math.min(...types.map((t, k) => Math.floor(residual[t] / pattern.counts[k])))
    const placed = pattern.placed.slice()
    for (let i = 0; i < placed.length; i += 6) placed[i] = types[placed[i]]
    for (let c = 0; c < copies; c++) {
      sheets.push(MaxRectsSheet.fromPlaced(inst.binW, inst.binH, placed, pattern.area))
    }
    types.forEach((t, k) => (residual[t] -= copies * pattern.counts[k]))
  }
  return { sheets, residual }
}

/**
 * Sheets for the whole whole-sheet part of a cutting-stock plan. Rounding down can leave a type with
 * more pieces than its demand (the master only requires "at least"), so the surplus is taken off the
 * last sheets, and what rounding left over is returned as the residual.
 */
function stockSheets(inst: Instance, maxWork: number): PatternResult | null {
  const plan = planStock(inst, maxWork)
  if (!plan) return null
  const layouts: number[][] = []
  plan.patterns.forEach((pattern, p) => {
    for (let c = 0; c < plan.copies[p]; c++) layouts.push(pattern.placed.slice())
  })

  const residual = inst.types.map((t) => t.count)
  for (const placed of layouts) {
    for (let i = 0; i < placed.length; i += 6) residual[placed[i]]--
  }
  for (let sheet = layouts.length - 1; sheet >= 0; sheet--) {
    const placed = layouts[sheet]
    for (let i = placed.length - 6; i >= 0; i -= 6) {
      const type = placed[i]
      if (residual[type] < 0) {
        placed.splice(i, 6)
        residual[type]++
      }
    }
  }
  const sheets = layouts
    .filter((placed) => placed.length > 0)
    .map((placed) => {
      let used = 0
      for (let i = 0; i < placed.length; i += 6) used += inst.types[placed[i]].area
      return MaxRectsSheet.fromPlaced(inst.binW, inst.binH, placed, used)
    })
  return { sheets, residual }
}
