import { useEffect } from 'react'
import { addImageFiles } from './add-images'

/** Lets people paste images from the clipboard anywhere on the page. */
export function usePasteImages() {
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith('image/'),
      )
      if (files.length === 0) return
      event.preventDefault()
      void addImageFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}
