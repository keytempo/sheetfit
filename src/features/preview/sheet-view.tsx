import { AnimatePresence } from 'motion/react'
import type { LayoutResult, PlacedSheet } from '@/lib/layout-types'
import { formatNumber } from '@/lib/units'
import { useAppStore } from '@/store'
import type { ImageItem } from '@/store/types'
import { HoverStats } from './hover-stats'
import { Piece } from './piece'
import { SheetFrame } from './sheet-frame'

interface SheetViewProps {
  sheet: PlacedSheet
  sheetCount: number
  layout: LayoutResult
  imagesById: ReadonlyMap<string, ImageItem>
}

export function SheetView({ sheet, sheetCount, layout, imagesById }: SheetViewProps) {
  const showSheetNumbers = useAppStore((state) => state.options.showSheetNumbers)
  const { stats } = sheet

  return (
    <div
      data-sheet-index={sheet.index}
      role="img"
      aria-label={`Sheet ${sheet.index + 1} of ${sheetCount}: ${stats.pieceCount} pieces, ${formatNumber(stats.fillPercent, 0)}% of the usable area filled`}
      className="group/sheet relative mx-auto scroll-mt-(--sheet-pad)"
    >
      <SheetFrame layout={layout}>
        <AnimatePresence initial={false}>
          {sheet.pieces.map((placed) => {
            const image = imagesById.get(placed.piece.imageId)
            return (
              image && (
                <Piece
                  key={placed.piece.id}
                  placed={placed}
                  image={image}
                  sheetWidth={layout.sheetWidth}
                  sheetHeight={layout.sheetHeight}
                />
              )
            )
          })}
        </AnimatePresence>
      </SheetFrame>

      {showSheetNumbers && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-3 -left-3 z-20 flex size-6 items-center justify-center rounded-full bg-foreground font-mono text-[11px] font-semibold text-background shadow-sm"
        >
          {sheet.index + 1}
        </span>
      )}

      <HoverStats sheet={sheet} layout={layout} />
    </div>
  )
}
