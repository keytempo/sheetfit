import type { LayoutInput } from '../../lib/layout-types.ts'

export interface Baseline {
  sheets: number
  /** Share of all the sheets' usable area that is covered, 0-100. */
  fill: number
}

/**
 * The layout the app showed in Chunk 1, before the packer existed: pieces in list order, left to
 * right in rows, a new row when one does not fit and a new sheet when a row does not fit. It
 * ignores the ordering option. Kept only as the weakest baseline of the benchmark tables.
 */
export function chunk1Shelf(input: LayoutInput): Baseline {
  const { margin, gap } = input
  const landscape = input.orientation === 'landscape'
  const { width: shortSide, height: longSide } = input.sheetSize
  const usableWidth = (landscape ? longSide : shortSide) - 2 * margin
  const usableHeight = (landscape ? shortSide : longSide) - 2 * margin
  const epsilon = 1e-6

  let sheets = 0
  let used = 0
  let count = 0
  let cursorX = 0
  let rowTop = 0
  let rowHeight = 0
  const startSheet = () => {
    if (count > 0) sheets += 1
    count = 0
    cursorX = 0
    rowTop = 0
    rowHeight = 0
  }
  const place = (w: number, h: number, x: number, y: number) => {
    count += 1
    used += w * h
    cursorX = x + w + gap
    rowTop = y
    rowHeight = Math.max(rowHeight, h)
  }

  for (const piece of input.pieces) {
    const turns = input.allowRotation && piece.width !== piece.height
    const candidates = turns
      ? [
          [piece.width, piece.height],
          [piece.height, piece.width],
        ]
      : [[piece.width, piece.height]]

    const inRow = candidates.find(
      ([w, h]) =>
        cursorX + w <= usableWidth + epsilon &&
        rowTop + Math.max(rowHeight, h) <= usableHeight + epsilon,
    )
    if (inRow && count > 0) {
      place(inRow[0], inRow[1], cursorX, rowTop)
      continue
    }
    const nextRowTop = count > 0 ? rowTop + rowHeight + gap : 0
    const inNewRow = candidates.find(
      ([w, h]) => w <= usableWidth + epsilon && nextRowTop + h <= usableHeight + epsilon,
    )
    if (inNewRow && count > 0) {
      rowHeight = 0
      place(inNewRow[0], inNewRow[1], 0, nextRowTop)
      continue
    }
    startSheet()
    const [w, h] = candidates.find(([cw]) => cw <= usableWidth + epsilon) ?? candidates[0]
    place(w, h, 0, 0)
  }
  startSheet()

  const capacity = sheets * usableWidth * usableHeight
  return { sheets, fill: capacity > 0 ? (used / capacity) * 100 : 0 }
}

interface Shelf {
  height: number
  used: number
}

/**
 * A stronger shelf packer than the placeholder: first-fit decreasing height. Pieces are sorted
 * tallest first and each goes on the first shelf with room, or starts a new shelf. It is run twice,
 * once with every piece's long side vertical and once with the short side vertical (when rotation
 * is allowed), and the better of the two is kept. Sizes are in millimetres; the gap is added to
 * every piece.
 */
export function sortedShelf(input: LayoutInput): Baseline {
  const orientations: (boolean | null)[] = input.allowRotation ? [true, false] : [null]
  const results = orientations.map((longSideVertical) =>
    firstFitDecreasingHeight(input, longSideVertical),
  )
  return results.reduce((best, r) => (r.sheets < best.sheets ? r : best))
}

/** `longSideVertical` null leaves pieces as they are. */
function firstFitDecreasingHeight(input: LayoutInput, longSideVertical: boolean | null): Baseline {
  const short = Math.min(input.sheetSize.width, input.sheetSize.height)
  const long = Math.max(input.sheetSize.width, input.sheetSize.height)
  const landscape = input.orientation === 'landscape'
  const usableW = (landscape ? long : short) - 2 * input.margin
  const usableH = (landscape ? short : long) - 2 * input.margin
  const gap = input.gap

  const boxes = input.pieces
    .map((p) => {
      const w = p.width + gap
      const h = p.height + gap
      if (longSideVertical === null) return { w, h }
      const turn = longSideVertical ? w > h : w < h
      const fits = turn
        ? h <= usableW + gap && w <= usableH + gap
        : w <= usableW + gap && h <= usableH + gap
      return turn && fits ? { w: h, h: w } : { w, h }
    })
    .sort((a, b) => b.h - a.h)

  const sheets: Shelf[][] = []
  let usedArea = 0
  for (const box of boxes) {
    let placed = false
    for (const shelves of sheets) {
      const shelf = shelves.find((s) => s.height >= box.h && s.used + box.w <= usableW + gap)
      if (shelf) {
        shelf.used += box.w
        placed = true
        break
      }
      const stacked = shelves.reduce((sum, s) => sum + s.height, 0)
      if (stacked + box.h <= usableH + gap && box.w <= usableW + gap) {
        shelves.push({ height: box.h, used: box.w })
        placed = true
        break
      }
    }
    if (!placed) sheets.push([{ height: box.h, used: box.w }])
    usedArea += (box.w - gap) * (box.h - gap)
  }
  const capacity = sheets.length * usableW * usableH
  return { sheets: sheets.length, fill: capacity > 0 ? (usedArea / capacity) * 100 : 0 }
}
