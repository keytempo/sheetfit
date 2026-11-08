import { useAppStore } from '@/store'

/** Deselects the selected image, if any, and tells screen readers. */
export function clearSelection() {
  const { selectedImageId, images, selectImage, announce } = useAppStore.getState()
  if (selectedImageId === null) return
  const name = images.find((image) => image.id === selectedImageId)?.name
  selectImage(null)
  announce(name ? `Deselected ${name}` : 'Selection cleared')
}
