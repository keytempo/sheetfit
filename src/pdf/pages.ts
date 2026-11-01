import type { PlacedPiece, PlacedSheet } from '@/lib/layout-types'
import type { EmbeddedImage } from './embed'
import { compose, EXIF_MATRICES, footprintMatrix, type Matrix } from './matrix'

/** PDF points per millimetre. */
export const POINTS_PER_MM = 72 / 25.4

/** The stroke width of the cut guides, in points. It is the finest line that still prints visibly. */
const GUIDE_WIDTH = 0.25

/** A number as short as it can be at 0.0001 point, which is a tenth of a micrometre. */
export const format = (value: number) => String(Number(value.toFixed(4)))

/**
 * Where an image's stored pixels land on the page, in points: first they are turned upright by
 * their EXIF orientation, then the upright picture is scaled, turned if the packer rotated it,
 * and moved to its place. The page's origin is its bottom left, the layout's is its top left.
 */
export function placement(piece: PlacedPiece, sheetHeight: number, orientation: Matrix): Matrix {
  const bottom = (sheetHeight - piece.y - piece.height) * POINTS_PER_MM
  const onPage = footprintMatrix(
    piece.x * POINTS_PER_MM,
    bottom,
    piece.width * POINTS_PER_MM,
    piece.height * POINTS_PER_MM,
    piece.rotated,
  )
  return compose(orientation, onPage)
}

/**
 * The drawing instructions of one sheet: every piece as an image placed by a matrix and, when cut
 * guides are on, a hairline around each piece's footprint. The guides sit inside the footprint, as
 * the preview's borders do, and are drawn last so the photos never cover them.
 */
export function pageContent(
  sheet: PlacedSheet,
  sheetHeight: number,
  imageNames: ReadonlyMap<string, { name: string; image: EmbeddedImage }>,
  cutGuides: boolean,
): string {
  const lines: string[] = []
  for (const placed of sheet.pieces) {
    const entry = imageNames.get(placed.piece.imageId)
    if (!entry)
      throw new Error(
        `A piece refers to an image (${placed.piece.imageId}) that is not in the export`,
      )
    const matrix = placement(placed, sheetHeight, EXIF_MATRICES[entry.image.orientation])
    lines.push(`q ${matrix.map(format).join(' ')} cm /${entry.name} Do Q`)
  }

  if (cutGuides) {
    const inset = GUIDE_WIDTH / 2
    lines.push(`q 0 G ${format(GUIDE_WIDTH)} w`)
    for (const placed of sheet.pieces) {
      const left = placed.x * POINTS_PER_MM + inset
      const bottom = (sheetHeight - placed.y - placed.height) * POINTS_PER_MM + inset
      const width = placed.width * POINTS_PER_MM - GUIDE_WIDTH
      const height = placed.height * POINTS_PER_MM - GUIDE_WIDTH
      lines.push(`${format(left)} ${format(bottom)} ${format(width)} ${format(height)} re`)
    }
    lines.push('S Q')
  }
  return lines.join('\n')
}
