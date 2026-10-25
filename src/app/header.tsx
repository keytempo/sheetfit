import { DownloadIcon, ImagePlusIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useState } from 'react'
import { LogoMark } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { ExportDialog } from '@/features/export/export-dialog'
import { AddImagesButton } from '@/features/images/add-images-button'
import { PRINT_OPTIONS_BUTTON_ID } from '@/lib/dom-ids'
import { useAppStore } from '@/store'
import { useTotalPieces } from '@/store/derived'
import { ThemeMenu } from './theme-menu'

export function Header() {
  const printOptionsOpen = useAppStore((state) => state.printOptionsOpen)
  const setPrintOptionsOpen = useAppStore((state) => state.setPrintOptionsOpen)
  const totalPieces = useTotalPieces()
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 pt-[env(safe-area-inset-top)] sm:px-4">
      <div className="flex items-center gap-2.5">
        <LogoMark className="size-7 shrink-0" />
        <h1 className="font-display text-lg font-bold tracking-tight">Sheetfit</h1>
      </div>

      {/* The open space between the brand and the actions has room for the presets menu. */}
      <div className="min-w-0 flex-1" />

      <nav aria-label="Actions" className="flex items-center gap-1.5">
        <AddImagesButton variant="outline" aria-label="Add images">
          <ImagePlusIcon />
          <span className="hidden md:inline">Add images</span>
        </AddImagesButton>
        <Button
          id={PRINT_OPTIONS_BUTTON_ID}
          variant={printOptionsOpen ? 'secondary' : 'outline'}
          aria-label="Print options"
          aria-pressed={printOptionsOpen}
          aria-expanded={printOptionsOpen}
          onClick={() => setPrintOptionsOpen(!printOptionsOpen)}
        >
          <SlidersHorizontalIcon />
          <span className="hidden md:inline">Print options</span>
        </Button>
        {/* Room for the help button sits between these two groups. */}
        <ThemeMenu />
        <Button
          aria-label="Download PDF"
          disabled={totalPieces === 0}
          onClick={() => setExportOpen(true)}
        >
          <DownloadIcon />
          <span className="hidden sm:inline">Download PDF</span>
        </Button>
      </nav>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </header>
  )
}
