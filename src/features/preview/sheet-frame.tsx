import type { ReactNode } from 'react'
import type { LayoutResult } from '@/lib/layout-types'
import { useAppStore } from '@/store'

/** One white page at the chosen size, with the optional dashed margin boundary. */
export function SheetFrame({ layout, children }: { layout: LayoutResult; children: ReactNode }) {
  const showMargins = useAppStore((state) => state.options.showMargins)
  const { sheetWidth, sheetHeight, margin } = layout
  const inlineInset = `${(margin / sheetWidth) * 100}%`
  const blockInset = `${(margin / sheetHeight) * 100}%`

  return (
    <div
      data-sheet-page
      className="sheet-page sheet-paper relative"
      style={{ width: 'var(--sheet-w)', aspectRatio: `${sheetWidth} / ${sheetHeight}` }}
    >
      {showMargins && margin > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute border border-dashed border-primary/50"
          style={{ left: inlineInset, right: inlineInset, top: blockInset, bottom: blockInset }}
        />
      )}
      {children}
    </div>
  )
}
