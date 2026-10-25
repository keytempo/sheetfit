import { toast } from 'sonner'
import { useAppStore } from '@/store'

/** Removes an image and offers to bring it back, in the same place, from the toast. */
export function removeImageWithUndo(id: string) {
  const { images, removeImages, restoreImages, announce } = useAppStore.getState()
  const image = images.find((candidate) => candidate.id === id)
  if (!image) return

  const removed = removeImages([id])
  announce(`Removed ${image.name}`)
  toast(`Removed ${image.name}`, {
    duration: 6000,
    action: {
      label: 'Undo',
      onClick: () => {
        restoreImages(removed)
        announce(`Restored ${image.name}`)
      },
    },
  })
}
