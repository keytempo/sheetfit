import { describe, expect, it } from 'vitest'
import { Random } from '../packing/random'
import {
  compose,
  EXIF_MATRICES,
  footprintMatrix,
  swapsAxes,
  type ExifOrientation,
  type Matrix,
} from './matrix'
import { format, placement, POINTS_PER_MM } from './pages'
import { handLayout } from './testing/fixtures'

const apply = (m: Matrix, u: number, v: number): [number, number] => [
  m[0] * u + m[2] * v + m[4],
  m[1] * u + m[3] * v + m[5],
]

/**
 * Where a pixel (column, row) of a stored picture ends up once EXIF orientation `o` is applied.
 * This is written from the EXIF specification's description of each value, independently of the
 * matrices the PDF uses, so the two can be compared.
 */
function orientedPixel(
  o: ExifOrientation,
  column: number,
  row: number,
  width: number,
  height: number,
) {
  switch (o) {
    case 1:
      return [column, row]
    case 2:
      return [width - 1 - column, row]
    case 3:
      return [width - 1 - column, height - 1 - row]
    case 4:
      return [column, height - 1 - row]
    case 5:
      return [row, column]
    case 6:
      return [height - 1 - row, column]
    case 7:
      return [height - 1 - row, width - 1 - column]
    case 8:
      return [row, width - 1 - column]
  }
}

describe('EXIF orientation matrices', () => {
  const width = 5
  const height = 3
  for (let o = 1; o <= 8; o++) {
    it(`orientation ${o} moves every pixel to where the specification puts it`, () => {
      const orientation = o as ExifOrientation
      const [orientedWidth, orientedHeight] = swapsAxes(orientation)
        ? [height, width]
        : [width, height]
      for (let column = 0; column < width; column++) {
        for (let row = 0; row < height; row++) {
          // The pixel's centre in the stored image's unit square (origin bottom left).
          const u = (column + 0.5) / width
          const v = 1 - (row + 0.5) / height
          const [U, V] = apply(EXIF_MATRICES[orientation], u, v)
          const [expectedColumn, expectedRow] = orientedPixel(
            orientation,
            column,
            row,
            width,
            height,
          )
          expect(U * orientedWidth).toBeCloseTo(expectedColumn + 0.5, 9)
          expect((1 - V) * orientedHeight).toBeCloseTo(expectedRow + 0.5, 9)
        }
      }
    })
  }

  it('keeps the picture un-mirrored for the turns and mirrored for the flips', () => {
    const determinant = (m: Matrix) => m[0] * m[3] - m[1] * m[2]
    const turns = [1, 3, 6, 8] as const
    const flips = [2, 4, 5, 7] as const
    for (const o of turns) expect(determinant(EXIF_MATRICES[o])).toBe(1)
    for (const o of flips) expect(determinant(EXIF_MATRICES[o])).toBe(-1)
  })
})

describe('footprintMatrix', () => {
  it('puts an upright image in its box', () => {
    const m = footprintMatrix(10, 20, 30, 40, false)
    expect(apply(m, 0, 0)).toEqual([10, 20])
    expect(apply(m, 1, 1)).toEqual([40, 60])
  })

  it('turns a rotated image a quarter clockwise inside its box', () => {
    // Footprint 30 wide and 40 tall: the upright image is 40 wide and 30 tall before the turn.
    const m = footprintMatrix(10, 20, 30, 40, true)
    expect(apply(m, 0, 1)).toEqual([40, 60]) // top left corner goes to the top right
    expect(apply(m, 1, 1)).toEqual([40, 20]) // top right goes to the bottom right
    expect(apply(m, 1, 0)).toEqual([10, 20]) // bottom right goes to the bottom left
    expect(apply(m, 0, 0)).toEqual([10, 60]) // bottom left goes to the top left
  })
})

describe('placement', () => {
  it('converts the layout’s top-left millimetres to the page’s bottom-left points', () => {
    const layout = handLayout([[{ imageId: 'a', x: 15, y: 25, width: 50, height: 30 }]])
    const m = placement(layout.sheets[0].pieces[0], layout.sheetHeight, EXIF_MATRICES[1])
    const k = POINTS_PER_MM
    expect(m[0]).toBeCloseTo(50 * k, 9)
    expect(m[3]).toBeCloseTo(30 * k, 9)
    expect(m[4]).toBeCloseTo(15 * k, 9)
    expect(m[5]).toBeCloseTo((297 - 25 - 30) * k, 9)
  })

  it('composes orientation first and placement second', () => {
    const random = new Random(3)
    for (let trial = 0; trial < 50; trial++) {
      const o = (1 + random.int(8)) as ExifOrientation
      const layout = handLayout([
        [
          {
            imageId: 'a',
            x: random.next() * 100,
            y: random.next() * 100,
            width: 10 + random.next() * 50,
            height: 10 + random.next() * 50,
            rotated: random.chance(0.5),
          },
        ],
      ])
      const piece = layout.sheets[0].pieces[0]
      const combined = placement(piece, layout.sheetHeight, EXIF_MATRICES[o])
      const onPage = placement(piece, layout.sheetHeight, EXIF_MATRICES[1])
      const [U, V] = apply(EXIF_MATRICES[o], 0.3, 0.8)
      const [x, y] = apply(combined, 0.3, 0.8)
      const [ex, ey] = apply(onPage, U, V)
      expect(x).toBeCloseTo(ex, 9)
      expect(y).toBeCloseTo(ey, 9)
      expect(compose(EXIF_MATRICES[o], onPage)).toEqual(combined)
    }
  })
})

describe('format', () => {
  it('writes short, plain numbers with at most four decimals', () => {
    expect(format(595.27559055)).toBe('595.2756')
    expect(format(0.5)).toBe('0.5')
    expect(format(-0.00001)).toBe('0')
    expect(format(12)).toBe('12')
    expect(format(0.0001)).toBe('0.0001')
    expect(format(1e-9)).toBe('0')
  })
})
