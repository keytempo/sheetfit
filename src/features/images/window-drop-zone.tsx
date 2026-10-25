import { ImageDownIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { fade, fadeSlide } from '@/lib/motion'
import { addImageFiles } from './add-images'

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false

/**
 * The whole browser window is the drop target. This component only listens and shows the overlay;
 * the overlay ignores the pointer so the drop itself lands on whatever is underneath.
 */
export function WindowDropZone() {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // dragenter and dragleave also fire for every child element, so count the nesting depth.
    let depth = 0

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth += 1
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      void addImageFiles([...(event.dataTransfer?.files ?? [])])
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <AnimatePresence>
      {dragging && (
        <motion.div
          {...fade}
          className="pointer-events-none fixed inset-0 z-[70] bg-background/75 p-3 backdrop-blur-sm"
        >
          <div className="flex size-full items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5">
            <motion.div
              {...fadeSlide}
              className="flex flex-col items-center gap-3 rounded-xl bg-card px-8 py-6 text-center shadow-lg"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <ImageDownIcon className="size-6" />
              </span>
              <p className="font-display text-xl font-semibold tracking-tight">
                Drop images to add them
              </p>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
