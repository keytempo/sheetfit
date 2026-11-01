import type { ExportInput, ExportProgress } from '@/lib/export-types'
import { ascii, throwIfAborted } from './bytes'
import type { DecodeImage } from './browser-decode'
import { byteLength, deflate } from './deflate'
import { ImageEmbedder, type EmbeddedImage } from './embed'
import { format, pageContent, POINTS_PER_MM } from './pages'
import { PdfWriter } from './writer'

export interface BuildHooks {
  decode: DecodeImage
  onProgress?: (progress: ExportProgress) => void
  /** Rejects the build with an AbortError at the next safe point once it is aborted. */
  signal?: AbortSignal
}

/** The share of the progress bar that writing the pages takes. The photos take the rest. */
const PAGES_SHARE = 0.05

/**
 * Builds the PDF for a layout: one page per sheet, every photo stored once and drawn wherever it
 * is placed. The same input always gives the same bytes: nothing here reads the clock or a random
 * number.
 */
export async function buildPdf(input: ExportInput, hooks: BuildHooks): Promise<Blob> {
  const { layout, cutGuides } = input
  const { signal, onProgress } = hooks
  if (layout.sheets.length === 0)
    throw new Error('There is nothing to export: no copy is placed on a sheet.')

  const used = new Set(layout.sheets.flatMap((sheet) => sheet.pieces.map((p) => p.piece.imageId)))
  const images = input.images.filter((image) => used.has(image.id))
  const missing = [...used].find((id) => !images.some((image) => image.id === id))
  if (missing) throw new Error(`A piece refers to an image (${missing}) that is not in the export`)

  const writer = new PdfWriter()
  const catalogId = writer.reserve()
  const pagesId = writer.reserve()
  const infoId = writer.addObject('<</Producer(Sheetfit)>>')
  const embedder = new ImageEmbedder(writer, hooks.decode, signal)

  // Photos cost time roughly in proportion to their pixels.
  const weights = images.map((image) => Math.max(1, (image.width * image.height) / 1e6))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const photosShare = 1 - PAGES_SHARE
  let weightDone = 0

  const embedded = new Map<string, { name: string; image: EmbeddedImage }>()
  for (const [index, image] of images.entries()) {
    throwIfAborted(signal)
    const label = `Embedding photo ${index + 1} of ${images.length}`
    onProgress?.({ fraction: (photosShare * weightDone) / totalWeight, label })
    const result = await embedder.embed(image, (fraction) =>
      onProgress?.({
        fraction: (photosShare * (weightDone + weights[index] * fraction)) / totalWeight,
        label,
      }),
    )
    weightDone += weights[index]
    embedded.set(image.id, { name: `Im${index}`, image: result })
  }

  const pageIds: number[] = []
  for (const [index, sheet] of layout.sheets.entries()) {
    throwIfAborted(signal)
    onProgress?.({
      fraction: photosShare + (PAGES_SHARE * index) / layout.sheets.length,
      label: `Writing sheet ${index + 1} of ${layout.sheets.length}`,
    })
    const content = await deflate(
      [ascii(pageContent(sheet, layout.sheetHeight, embedded, cutGuides))],
      signal,
    )
    const contentId = writer.addStream('/Filter/FlateDecode', {
      parts: content,
      length: byteLength(content),
    })

    pageIds.push(writer.addObject(`<</Type/Page/Parent ${pagesId} 0 R/Contents ${contentId} 0 R>>`))
  }

  // Every sheet has the same size and may draw any photo, so both are stated once, on the page
  // tree, which each page inherits from.
  const mediaBox = `[0 0 ${format(layout.sheetWidth * POINTS_PER_MM)} ${format(layout.sheetHeight * POINTS_PER_MM)}]`
  const resources = [...new Set(embedded.values())]
    .map(({ name, image }) => `/${name} ${image.id} 0 R`)
    .join(' ')
  writer.writeObject(
    pagesId,
    `<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(' ')}]/Count ${pageIds.length}/MediaBox${mediaBox}/Resources<</XObject<<${resources}>>>>>>`,
  )
  writer.writeObject(catalogId, `<</Type/Catalog/Pages ${pagesId} 0 R>>`)
  onProgress?.({ fraction: 1, label: 'Finishing the file' })
  return writer.finish(catalogId, infoId)
}
