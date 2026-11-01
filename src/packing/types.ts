import type { LayoutInput, LayoutStatus } from '../lib/layout-types.ts'
import type { ResolvedOrientation } from '../lib/sheet.ts'
import type { Unplaced } from './instance.ts'

/**
 * A layout as plain numbers: pieces are named by their index in the input list and every length is
 * a whole number of micrometres. This is what crosses the worker boundary; the receiving side
 * rebuilds a `LayoutResult` around its own piece objects, so piece identity never changes.
 */
export interface PackedPiece {
  /** Index into `LayoutInput.pieces`. */
  index: number
  x: number
  y: number
  /** Footprint after rotation. */
  width: number
  height: number
  rotated: boolean
}

export interface PackedLayout {
  orientation: ResolvedOrientation
  sheetWidth: number
  sheetHeight: number
  margin: number
  /** Pieces in list order within each sheet. */
  sheets: PackedPiece[][]
  unplaceable: Unplaced[]
  status: LayoutStatus
  lowerBound: number
}

/**
 * What the packer reads from a `LayoutInput`: only each piece's printed size. Ids and copy numbers
 * never enter the packer, which is why a worker needs only this slim copy.
 */
export type EngineInput = Omit<LayoutInput, 'pieces'> & {
  pieces: readonly { width: number; height: number }[]
}

export interface PackOptions {
  /** Seeds every random choice. The same seed and input always give the same result. */
  seed?: number
  /**
   * The largest number of pieces for which the exact solver runs. Zero turns it off, which is
   * useful for measuring the heuristics alone.
   */
  exactLimit?: number
}
