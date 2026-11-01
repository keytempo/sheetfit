import type { ExportInput } from '@/lib/export-types'
import type { LayoutResult } from '@/lib/layout-types'
import { useAppStore } from './index'

export function useTotalPieces() {
  return useAppStore((state) => state.images.reduce((sum, image) => sum + image.copies, 0))
}

/**
 * What an export contains, frozen at the moment Download PDF is pressed: the layout that is on
 * screen (never a recomputed one), the images it places, and the cut-guide choice. Later changes
 * to the sheets, and layouts the packer finds while the file is written, do not touch it.
 */
export function snapshotExportInput(layout: LayoutResult): ExportInput {
  const { images, options } = useAppStore.getState()
  const used = new Set(layout.sheets.flatMap((sheet) => sheet.pieces.map((p) => p.piece.imageId)))
  return {
    layout,
    images: images
      .filter((image) => used.has(image.id))
      .map(({ id, name, file, width, height }) => ({ id, name, file, width, height })),
    cutGuides: options.cutGuides,
  }
}
