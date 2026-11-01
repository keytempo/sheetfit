import type { Orientation, Ordering } from './print-options'
import type { ResolvedOrientation, SheetSize } from './sheet'

/**
 * The contract between the UI and the packer in src/packing.
 * All lengths are millimetres and all coordinates are measured from the sheet's top-left corner.
 */

/** One printed copy of one image. The UI expands copies into pieces before calling the layout. */
export interface PieceSpec {
  id: string
  imageId: string
  /** 1-based copy number. */
  copy: number
  /** Total copies of the image this piece belongs to. */
  copies: number
  /** Printed size before any rotation. */
  width: number
  height: number
}

export interface LayoutInput {
  pieces: readonly PieceSpec[]
  /** Portrait dimensions of the sheet: the shorter side is the width. */
  sheetSize: SheetSize
  orientation: Orientation
  margin: number
  gap: number
  allowRotation: boolean
  ordering: Ordering
}

export interface PlacedPiece {
  piece: PieceSpec
  /** Top-left corner of the piece's footprint on the sheet. */
  x: number
  y: number
  /** Footprint after rotation: width and height are swapped when `rotated` is true. */
  width: number
  height: number
  /** True when the piece is turned 90° clockwise. */
  rotated: boolean
}

export interface SheetStats {
  pieceCount: number
  usableArea: number
  usedArea: number
  wastedArea: number
  /** Share of the usable area covered by pieces, 0–100. */
  fillPercent: number
}

export interface PlacedSheet {
  /** 0-based position in the result. */
  index: number
  pieces: readonly PlacedPiece[]
  stats: SheetStats
}

/** Why a piece could not be placed on any sheet. */
export type UnplaceableReason =
  /** The sheet leaves no usable area once the margin is taken off. */
  | 'no-usable-area'
  /** The piece is larger than the usable area, in every allowed orientation. */
  | 'too-large'
  /** The piece has no positive, finite size. */
  | 'invalid-size'

export interface UnplaceablePiece {
  piece: PieceSpec
  reason: UnplaceableReason
}

/**
 * `optimal`: the number of sheets is proven to be the fewest possible.
 * `best-found`: the best layout the packer found; a better one may exist.
 */
export type LayoutStatus = 'optimal' | 'best-found'

/** Overall figures. They are sums over the sheets, never averages of percentages. */
export interface LayoutTotals {
  sheetCount: number
  pieceCount: number
  usableArea: number
  usedArea: number
  wastedArea: number
  /** Share of all the usable area that is covered, 0–100. */
  fillPercent: number
  /** The same share over every sheet except the last, 0–100. 0 when there is one sheet or none. */
  fillPercentExceptLast: number
}

export interface LayoutResult {
  orientation: ResolvedOrientation
  sheetWidth: number
  sheetHeight: number
  margin: number
  sheets: readonly PlacedSheet[]
  status: LayoutStatus
  /** The proven lower bound on the number of sheets. */
  lowerBound: number
  /** Pieces that are on no sheet. Every piece is either on a sheet or listed here. */
  unplaceable: readonly UnplaceablePiece[]
  totals: LayoutTotals
}
