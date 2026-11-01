import { expandItems, packItems } from './decode.ts'
import type { PackSheet } from './fit.ts'
import { GuillotineSheet, SPLIT } from './guillotine.ts'
import type { Instance } from './instance.ts'
import { MaxRectsSheet, RULE } from './maxrects.ts'
import { type PatternEffort, QUICK_EFFORT, QUICK_STOCK_EFFORT, patternSheets } from './patterns.ts'
import { MAX_STOCK_TYPES } from './stock.ts'
import { SKYLINE_RULE, SkylineSheet } from './skyline.ts'

export type OrderKey = 'area' | 'long' | 'short' | 'width' | 'height' | 'perimeter'

const ORDER_VALUE: Record<OrderKey, (w: number, h: number) => number> = {
  area: (w, h) => w * h,
  long: (w, h) => Math.max(w, h),
  short: (w, h) => Math.min(w, h),
  width: (w) => w,
  height: (_, h) => h,
  perimeter: (w, h) => w + h,
}

/** The types from largest to smallest by the key; equal ones by area, then by list position. */
export function orderTypes(inst: Instance, key: OrderKey): number[] {
  const value = ORDER_VALUE[key]
  return inst.types
    .map((_, i) => i)
    .sort((a, b) => {
      const ta = inst.types[a]
      const tb = inst.types[b]
      return value(tb.w, tb.h) - value(ta.w, ta.h) || tb.w * tb.h - ta.w * ta.h || a - b
    })
}

export type Algorithm = 'maxrects' | 'skyline' | 'guillotine' | 'pattern'

export interface Heuristic {
  algorithm: Algorithm
  /** A MaxRects or Guillotine rule, or a Skyline rule. */
  rule: number
  order: OrderKey
  /** Guillotine only. */
  split?: number
  /** Pattern only: how hard the patterns are searched. */
  effort?: PatternEffort
}

function makeSheet(inst: Instance, heuristic: Heuristic): () => PackSheet {
  switch (heuristic.algorithm) {
    case 'maxrects':
      return () => new MaxRectsSheet(inst.binW, inst.binH)
    case 'skyline':
      return () => new SkylineSheet(inst.binW, inst.binH)
    case 'guillotine':
      return () => new GuillotineSheet(inst.binW, inst.binH, heuristic.split ?? SPLIT.SHORTER_AXIS)
    case 'pattern':
      return () => new MaxRectsSheet(inst.binW, inst.binH)
  }
}

/** Runs one constructive heuristic from scratch and returns its sheets as MaxRects sheets. */
export function construct(inst: Instance, heuristic: Heuristic): MaxRectsSheet[] {
  const sheets: PackSheet[] = []
  let order = orderTypes(inst, heuristic.order)
  if (heuristic.algorithm === 'pattern' && heuristic.effort) {
    const { sheets: dense, residual } = patternSheets(inst, heuristic.effort)
    sheets.push(...dense)
    // The leftovers go into the holes of the dense sheets first, then onto new sheets.
    order = order.filter((t) => residual[t] > 0)
    const items = expandItems(inst, order, residual)
    packItems(inst, sheets, makeSheet(inst, heuristic), items, null, heuristic.rule)
  } else {
    const items = expandItems(inst, order)
    packItems(inst, sheets, makeSheet(inst, heuristic), items, null, heuristic.rule)
  }
  return sheets.map((s) =>
    s instanceof MaxRectsSheet
      ? s
      : MaxRectsSheet.fromPlaced(inst.binW, inst.binH, s.placed, s.used),
  )
}

/**
 * The generic heuristics worth running before the first result. MaxRects with BSSF in area order is
 * not among them: with no dense pattern, the pattern heuristic reduces to exactly that. Skyline
 * is slower than the rest and almost never wins, so it waits for the refinement.
 */
const GENERIC: readonly Heuristic[] = [
  { algorithm: 'maxrects', rule: RULE.BAF, order: 'long' },
  { algorithm: 'maxrects', rule: RULE.BL, order: 'height' },
  { algorithm: 'guillotine', rule: RULE.BAF, order: 'area', split: SPLIT.SHORTER_AXIS },
]

/** True when column generation is worth running: a few types, each with several pieces. */
export function suitsStock(inst: Instance) {
  return inst.types.length >= 2 && inst.types.length <= MAX_STOCK_TYPES
}

/**
 * The fixed set tried before the first result is shown, in order. It depends only on the instance,
 * never on the clock. A single type is settled by its best pattern alone.
 */
export function quickPortfolio(inst: Instance): Heuristic[] {
  const pattern: Heuristic = {
    algorithm: 'pattern',
    rule: RULE.BSSF,
    order: 'area',
    effort: QUICK_EFFORT,
  }
  if (inst.types.length === 1) return [pattern]
  const stock: Heuristic[] = suitsStock(inst)
    ? [{ algorithm: 'pattern', rule: RULE.BSSF, order: 'area', effort: QUICK_STOCK_EFFORT }]
    : []
  return [...stock, pattern, ...GENERIC]
}

const ORDER_KEYS: readonly OrderKey[] = ['area', 'long', 'short', 'width', 'height', 'perimeter']

/** Everything else worth trying once there is time: every algorithm, rule and order. */
export function deepPortfolio(inst: Instance): Heuristic[] {
  const all: Heuristic[] = []
  for (const order of ORDER_KEYS) {
    for (const rule of [RULE.BSSF, RULE.BLSF, RULE.BAF, RULE.BL, RULE.CP]) {
      all.push({ algorithm: 'maxrects', rule, order })
    }
    for (const rule of [SKYLINE_RULE.TOP_LEFT, SKYLINE_RULE.MIN_WASTE]) {
      all.push({ algorithm: 'skyline', rule, order })
    }
    for (const rule of [RULE.BSSF, RULE.BLSF, RULE.BAF]) {
      for (const split of [SPLIT.SHORTER_AXIS, SPLIT.LONGER_AXIS]) {
        all.push({ algorithm: 'guillotine', rule, order, split })
      }
    }
  }
  const quick = new Set(quickPortfolio(inst).map(key))
  return all.filter((h) => !quick.has(key(h)))
}

function key(h: Heuristic) {
  return `${h.algorithm}:${h.rule}:${h.order}:${h.split ?? 0}:${h.effort ? 1 : 0}`
}
