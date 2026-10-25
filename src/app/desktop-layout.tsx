import { useState } from 'react'
import { ImagePanel } from '@/features/images/image-panel'
import { PreviewPanel } from '@/features/preview/preview-panel'
import { PrintOptionsSheet } from '@/features/print-options/print-options-sheet'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useAppStore } from '@/store'
import { DEFAULT_PANEL_LAYOUT } from '@/store/ui-slice'

/** Two resizable panels side by side. The print options slide over the left one only. */
export function DesktopLayout() {
  // The saved split is only the starting point: from then on the panel group owns the sizes.
  const [initialLayout] = useState(() => useAppStore.getState().panelLayout)
  const setPanelLayout = useAppStore((state) => state.setPanelLayout)
  const [sheetContainer, setSheetContainer] = useState<HTMLDivElement | null>(null)

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={initialLayout}
      onLayoutChanged={(layout, meta) => setPanelLayout(meta.requestedLayout ?? layout)}
    >
      <ResizablePanel
        id="images"
        defaultSize={`${DEFAULT_PANEL_LAYOUT.images}%`}
        minSize="340px"
        maxSize="60%"
      >
        <div ref={setSheetContainer} className="relative size-full overflow-hidden">
          <ImagePanel />
          <PrintOptionsSheet container={sheetContainer} />
        </div>
      </ResizablePanel>
      <ResizableHandle aria-label="Resize the image list and the preview" />
      <ResizablePanel id="preview" defaultSize={`${DEFAULT_PANEL_LAYOUT.preview}%`} minSize="360px">
        <PreviewPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
