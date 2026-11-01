import { useAppStore } from '@/store'
import { useSheetLayout } from '@/store/layout-context'
import { PackingStatus } from './packing-status'
import { PreviewToolbar } from './preview-toolbar'
import { SheetCanvas } from './sheet-canvas'

/** The right panel. It hands the layout on screen to the toolbar, the canvas and the status. */
export function PreviewPanel() {
  const { layout, pending, optimizing } = useSheetLayout()
  const images = useAppStore((state) => state.images)

  return (
    <section aria-label="Sheet preview" className="flex h-full min-h-0 flex-col bg-canvas">
      <PreviewToolbar sheetCount={layout.sheets.length} sheetWidth={layout.sheetWidth} />
      <div className="relative min-h-0 flex-1">
        <SheetCanvas layout={layout} images={images} />
        <PackingStatus layout={layout} searching={pending || optimizing} />
      </div>
    </section>
  )
}
