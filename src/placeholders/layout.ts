import type {
  LayoutFunction,
  LayoutInput,
  PieceSpec,
  PlacedPiece,
  PlacedSheet,
  SheetStats,
} from '@/lib/layout-types'
import { resolveOrientation } from '@/lib/sheet'

/*
 * PLACEHOLDER: a trivial shelf layout so the preview has something to draw.
 * It places pieces left to right in rows and starts a new row, then a new sheet, when one does
 * not fit. It does no optimisation and ignores `ordering`. The real packer implements the same
 * `LayoutFunction` and replaces this file's export in src/placeholders/index.ts.
 */

const EPSILON = 1e-6

interface Candidate {
  width: number
  height: number
  rotated: boolean
}

function candidatesFor(width: number, height: number, allowRotation: boolean): Candidate[] {
  const upright = { width, height, rotated: false }
  if (!allowRotation || width === height) return [upright]
  return [upright, { width: height, height: width, rotated: true }]
}

function statsFor(pieces: readonly PlacedPiece[], usableArea: number): SheetStats {
  const usedArea = pieces.reduce((sum, piece) => sum + piece.width * piece.height, 0)
  return {
    pieceCount: pieces.length,
    usableArea,
    usedArea,
    wastedArea: Math.max(0, usableArea - usedArea),
    fillPercent: usableArea > 0 ? (usedArea / usableArea) * 100 : 0,
  }
}

export const computeShelfLayout: LayoutFunction = (input: LayoutInput) => {
  const orientation = resolveOrientation(input.orientation)
  const landscape = orientation === 'landscape'
  const sheetWidth = landscape ? input.sheetSize.height : input.sheetSize.width
  const sheetHeight = landscape ? input.sheetSize.width : input.sheetSize.height
  const { margin, gap } = input
  const usableWidth = sheetWidth - 2 * margin
  const usableHeight = sheetHeight - 2 * margin
  const usableArea = usableWidth * usableHeight

  const sheets: PlacedSheet[] = []
  let current: PlacedPiece[] = []
  let cursorX = 0
  let rowTop = 0
  let rowHeight = 0

  const startSheet = () => {
    if (current.length > 0) {
      sheets.push({ index: sheets.length, pieces: current, stats: statsFor(current, usableArea) })
    }
    current = []
    cursorX = 0
    rowTop = 0
    rowHeight = 0
  }

  const place = (piece: PieceSpec, candidate: Candidate, x: number, y: number) => {
    current.push({
      piece,
      x: margin + x,
      y: margin + y,
      width: candidate.width,
      height: candidate.height,
      rotated: candidate.rotated,
    })
    cursorX = x + candidate.width + gap
    rowTop = y
    rowHeight = Math.max(rowHeight, candidate.height)
  }

  for (const piece of input.pieces) {
    const candidates = candidatesFor(piece.width, piece.height, input.allowRotation)

    const inRow = candidates.find(
      (c) =>
        cursorX + c.width <= usableWidth + EPSILON &&
        rowTop + Math.max(rowHeight, c.height) <= usableHeight + EPSILON,
    )
    if (inRow && current.length > 0) {
      place(piece, inRow, cursorX, rowTop)
      continue
    }

    const nextRowTop = current.length > 0 ? rowTop + rowHeight + gap : 0
    const inNewRow = candidates.find(
      (c) => c.width <= usableWidth + EPSILON && nextRowTop + c.height <= usableHeight + EPSILON,
    )
    if (inNewRow && current.length > 0) {
      rowHeight = 0
      place(piece, inNewRow, 0, nextRowTop)
      continue
    }

    startSheet()
    place(piece, candidates.find((c) => c.width <= usableWidth + EPSILON) ?? candidates[0], 0, 0)
  }
  startSheet()

  return { orientation, sheetWidth, sheetHeight, margin, sheets }
}
