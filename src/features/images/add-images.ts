import { toast } from 'sonner'
import { pluralize } from '@/lib/format'
import { decodeImage } from '@/lib/image-decode'
import { useAppStore } from '@/store'

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i

let nextId = 1

const isImageFile = (file: File) =>
  file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name)

/**
 * Decodes the files one after another and adds each image as soon as it is ready, so the list
 * grows while a large batch is still loading. Files that cannot be used are skipped with a toast.
 */
export async function addImageFiles(files: readonly File[]) {
  const { addImages, changeLoadingCount, announce } = useAppStore.getState()

  const candidates = files.filter((file) => {
    if (isImageFile(file)) return true
    toast.error(`Skipped ${file.name}`, { description: 'This is not an image file' })
    return false
  })
  if (candidates.length === 0) return

  changeLoadingCount(candidates.length)
  let added = 0
  for (const file of candidates) {
    try {
      const { width, height, thumbnail } = await decodeImage(file)
      addImages([
        {
          id: `image-${nextId++}`,
          name: file.name,
          file,
          thumbnail,
          url: URL.createObjectURL(file),
          thumbUrl: URL.createObjectURL(thumbnail),
          width,
          height,
          copies: 1,
          percent: 100,
        },
      ])
      added += 1
    } catch (error) {
      toast.error(`Skipped ${file.name}`, {
        description: error instanceof Error ? error.message : 'The file could not be decoded',
      })
    } finally {
      changeLoadingCount(-1)
    }
  }
  if (added > 0) announce(`Added ${pluralize(added, 'image')}`)
}
