import type { PackSheet } from './fit.ts'

/**
 * How good a set of sheets is, in the order the product cares about: fewer sheets first, then the
 * emptiest sheet as empty as possible (so every other sheet is as full as possible), then the sum
 * of squared fills, which pulls pieces together and steers the search towards emptying a sheet.
 */
export interface Score {
  sheets: number
  /** Real area on the emptiest sheet, in square micrometres. */
  minUsed: number
  /** Sum of squared fill fractions. */
  sumSq: number
}

export function scoreSheets(sheets: readonly PackSheet[], usableArea: number): Score {
  let minUsed = Infinity
  let sumSq = 0
  for (const sheet of sheets) {
    if (sheet.used < minUsed) minUsed = sheet.used
    const fill = sheet.used / usableArea
    sumSq += fill * fill
  }
  return { sheets: sheets.length, minUsed: sheets.length === 0 ? 0 : minUsed, sumSq }
}

/** True when `a` is strictly better than `b` on the figures that decide a published improvement. */
export function improvesOn(a: Score, b: Score) {
  return a.sheets < b.sheets || (a.sheets === b.sheets && a.minUsed < b.minUsed)
}

/** True when `a` is at least as good as `b`, using the sum of squares to separate equals. */
export function noWorse(a: Score, b: Score) {
  if (a.sheets !== b.sheets) return a.sheets < b.sheets
  if (a.minUsed !== b.minUsed) return a.minUsed < b.minUsed
  return a.sumSq >= b.sumSq
}

/** What decides which orientation wins: pieces left out, then sheets, then the emptiest sheet. */
export interface Objective {
  unplaceable: number
  sheets: number
  minUsed: number
}

export function betterObjective(a: Objective, b: Objective) {
  if (a.unplaceable !== b.unplaceable) return a.unplaceable < b.unplaceable
  if (a.sheets !== b.sheets) return a.sheets < b.sheets
  return a.minUsed < b.minUsed
}
