import type { LayoutInput, PieceSpec } from '../../lib/layout-types.ts'

/** Portrait sheet sizes in millimetres, as the app defines them. */
export const SHEETS = {
  a0: { width: 841, height: 1189 },
  a1: { width: 594, height: 841 },
  a2: { width: 420, height: 594 },
  a3: { width: 297, height: 420 },
  a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 },
  a6: { width: 105, height: 148 },
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
  tabloid: { width: 279.4, height: 431.8 },
} as const

export interface ImageSpec {
  /** Printed width and height in millimetres. */
  width: number
  height: number
  copies: number
}

/** Expands images into pieces the way the app does: ids are `imageId:copy`, copies 1-based. */
export function piecesOf(images: readonly ImageSpec[]): PieceSpec[] {
  return images.flatMap((image, k) =>
    Array.from({ length: image.copies }, (_, i) => ({
      id: `img${k}:${i + 1}`,
      imageId: `img${k}`,
      copy: i + 1,
      copies: image.copies,
      width: image.width,
      height: image.height,
    })),
  )
}

export function inputOf(
  images: readonly ImageSpec[],
  patch: Partial<LayoutInput> = {},
): LayoutInput {
  return {
    pieces: piecesOf(images),
    sheetSize: SHEETS.a4,
    orientation: 'portrait',
    margin: 5,
    gap: 0,
    allowRotation: true,
    ordering: 'optimize',
    ...patch,
  }
}
