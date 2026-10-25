import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import type { LayoutResult } from '@/lib/layout-types'
import { fade } from '@/lib/motion'
import { clamp } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { ImageItem } from '@/store/types'
import { EmptySheet } from './empty-sheet'
import { scrollToSheet } from './sheet-navigation'
import { SheetView } from './sheet-view'
import { ZoomScroller } from './zoom-scroller'

interface SheetCanvasProps {
  layout: LayoutResult
  images: readonly ImageItem[]
}

/** Draws the sheets either stacked in one scrolling column or one at a time, cross-fading. */
export function SheetCanvas({ layout, images }: SheetCanvasProps) {
  const viewMode = useAppStore((state) => state.viewMode)
  const requestedSheet = useAppStore((state) => state.currentSheet)
  const { sheets } = layout
  const current = clamp(requestedSheet, 0, Math.max(0, sheets.length - 1))
  const imagesById = new Map(images.map((image) => [image.id, image]))

  useEffect(() => {
    if (viewMode === 'scroll') scrollToSheet(useAppStore.getState().currentSheet, 'instant')
  }, [viewMode])

  const view = (index: number) => (
    <SheetView
      key={index}
      sheet={sheets[index]}
      sheetCount={sheets.length}
      layout={layout}
      imagesById={imagesById}
    />
  )

  return (
    <ZoomScroller sheetWidth={layout.sheetWidth} sheetHeight={layout.sheetHeight}>
      <AnimatePresence mode="popLayout" initial={false}>
        {sheets.length === 0 ? (
          <motion.div key="empty" {...fade} className="m-auto">
            <EmptySheet layout={layout} />
          </motion.div>
        ) : viewMode === 'scroll' ? (
          <motion.div key="scroll" {...fade} data-sheet-column className="flex flex-col gap-8">
            {sheets.map((_, index) => view(index))}
          </motion.div>
        ) : (
          <motion.div key={`sheet-${current}`} {...fade} className="m-auto">
            {view(current)}
          </motion.div>
        )}
      </AnimatePresence>
    </ZoomScroller>
  )
}
