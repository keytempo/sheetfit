import { FlaskConicalIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/store'
import { useSheetLayout } from '@/store/derived'
import { PreviewToolbar } from './preview-toolbar'
import { SheetCanvas } from './sheet-canvas'

/** The right panel. It computes the layout once and hands it to the toolbar and the canvas. */
export function PreviewPanel() {
  const layout = useSheetLayout()
  const images = useAppStore((state) => state.images)

  return (
    <section aria-label="Sheet preview" className="flex h-full min-h-0 flex-col bg-canvas">
      <PreviewToolbar sheetCount={layout.sheets.length} sheetWidth={layout.sheetWidth} />
      <div className="relative min-h-0 flex-1">
        <SheetCanvas layout={layout} images={images} />
        {layout.sheets.length > 0 && (
          <Badge
            variant="outline"
            className="pointer-events-none absolute bottom-3 left-3 z-20 bg-card/85 text-muted-foreground backdrop-blur-sm"
          >
            <FlaskConicalIcon />
            Placeholder layout
          </Badge>
        )}
      </div>
    </section>
  )
}
