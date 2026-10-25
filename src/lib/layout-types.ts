import type { Orientation, Ordering } from './print-options'
import type { ResolvedOrientation, SheetSize } from './sheet'

/**
 * The contract between the UI and whatever places pieces on sheets.
 * The placeholder shelf layout and the future packer implement the same `LayoutFunction`.
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

export interface LayoutResult {
  orientation: ResolvedOrientation
  sheetWidth: number
  sheetHeight: number
  margin: number
  sheets: readonly PlacedSheet[]
}

export type LayoutFunction = (input: LayoutInput) => LayoutResult
