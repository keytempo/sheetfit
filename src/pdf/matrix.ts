/**
 * PDF transformation matrices, written [a b c d e f] as in the `cm` operator: a point (x, y)
 * moves to (a·x + c·y + e, b·x + d·y + f).
 */
export type Matrix = readonly [number, number, number, number, number, number]

/** The matrix that applies `first`, then `then`. */
export function compose(first: Matrix, then: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first
  const [a2, b2, c2, d2, e2, f2] = then
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ]
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/**
 * Where the pixels of an image as stored land in the image as it should be seen, both as unit
 * squares with the origin at the bottom left (the way a PDF draws an image). Entry n is EXIF
 * orientation n: 2 mirrors, 3 turns half way, 6 turns a quarter clockwise, and so on.
 */
export const EXIF_MATRICES: Record<ExifOrientation, Matrix> = {
  1: [1, 0, 0, 1, 0, 0],
  2: [-1, 0, 0, 1, 1, 0],
  3: [-1, 0, 0, -1, 1, 1],
  4: [1, 0, 0, -1, 0, 1],
  5: [0, -1, -1, 0, 1, 1],
  6: [0, -1, 1, 0, 0, 1],
  7: [0, 1, 1, 0, 0, 0],
  8: [0, 1, -1, 0, 1, 0],
}

/** Orientations 5 to 8 swap the width and the height of the picture. */
export const swapsAxes = (orientation: ExifOrientation) => orientation >= 5

/**
 * Places an upright unit-square image on a page. The box is the image's footprint in points, with
 * (left, bottom) in the PDF's coordinate system. A rotated piece is the upright image turned a
 * quarter clockwise, exactly as the preview draws it, so its footprint is as wide as the image is
 * tall.
 */
export function footprintMatrix(
  left: number,
  bottom: number,
  width: number,
  height: number,
  rotated: boolean,
): Matrix {
  return rotated
    ? [0, -height, width, 0, left, bottom + height]
    : [width, 0, 0, height, left, bottom]
}
