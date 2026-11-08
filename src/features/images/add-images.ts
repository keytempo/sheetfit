import { toast } from 'sonner'
import { pluralize } from '@/lib/format'
import { decodeImage } from '@/lib/image-decode'
import { newImageId } from '@/lib/image-id'
import { createSerialQueue, decodeBatch } from '@/lib/import-batch'
import { useAppStore } from '@/store'

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i

const isImageFile = (file: File) =>
  file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name)

/** One batch at a time, in the order they arrived, so a second batch never overtakes the first. */
const queue = createSerialQueue()

/**
 * Adds the files as one batch: they are decoded one after another, off the busy path, and then
 * added to the list together in a single update, so the packer starts once for the batch and not
 * once for every photo. The list shows a placeholder per file until then. Files that cannot be
 * used are skipped with a toast and do not hold up the rest.
 */
export function addImageFiles(files: readonly File[]): Promise<void> {
  const candidates = files.filter((file) => {
    if (isImageFile(file)) return true
    toast.error(`Skipped ${file.name}`, { description: 'This is not an image file' })
    return false
  })
  if (candidates.length === 0) return Promise.resolve()

  const epoch = useAppStore.getState().beginImport(candidates.length)
  return queue(async () => {
    const items = await decodeBatch(candidates, {
      decode: decodeImage,
      makeId: newImageId,
      onProcessed: () => useAppStore.getState().reportDecoded(),
      onSkipped: (file, message) => toast.error(`Skipped ${file.name}`, { description: message }),
    })
    const { commitImport, announce } = useAppStore.getState()
    if (commitImport(items, candidates.length, epoch) && items.length > 0)
      announce(`Added ${pluralize(items.length, 'image')}`)
  })
}
