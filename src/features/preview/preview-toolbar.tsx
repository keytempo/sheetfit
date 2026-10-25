import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GalleryVerticalIcon,
  SquareIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { IconButton } from '@/components/icon-button'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { clamp } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { ViewMode, Zoom } from '@/store/types'
import { goToSheet } from './sheet-navigation'
import { stepZoom, zoomLabel, ZOOM_MENU_PRESETS } from './zoom'

interface PreviewToolbarProps {
  sheetCount: number
  sheetWidth: number
}

const zoomMenuValue = (zoom: Zoom) => (zoom.kind === 'custom' ? String(zoom.value) : zoom.kind)

export function PreviewToolbar({ sheetCount, sheetWidth }: PreviewToolbarProps) {
  const zoom = useAppStore((state) => state.zoom)
  const setZoom = useAppStore((state) => state.setZoom)
  const viewMode = useAppStore((state) => state.viewMode)
  const setViewMode = useAppStore((state) => state.setViewMode)
  const requestedSheet = useAppStore((state) => state.currentSheet)

  const current = clamp(requestedSheet, 0, Math.max(0, sheetCount - 1))

  const handleZoomChange = (value: string) => {
    if (value === 'fit-width' || value === 'fit-page') setZoom({ kind: value })
    else setZoom({ kind: 'custom', value: Number(value) })
  }

  return (
    <div
      role="toolbar"
      aria-label="Preview controls"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-card px-3 py-2"
    >
      <div className="flex items-center gap-1">
        <IconButton label="Zoom out" onClick={() => stepZoom(-1, sheetWidth)}>
          <ZoomOutIcon />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Zoom: ${zoomLabel(zoom)}`}
              className="w-[6.75rem] justify-between font-mono text-xs"
            >
              {zoomLabel(zoom)}
              <ChevronDownIcon className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={zoomMenuValue(zoom)} onValueChange={handleZoomChange}>
              <DropdownMenuRadioItem value="fit-width">Fit width</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="fit-page">Fit page</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {ZOOM_MENU_PRESETS.map((preset) => (
                <DropdownMenuRadioItem key={preset} value={String(preset)}>
                  {Math.round(preset * 100)}%
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton label="Zoom in" onClick={() => stepZoom(1, sheetWidth)}>
          <ZoomInIcon />
        </IconButton>
      </div>

      <ToggleGroup
        type="single"
        value={viewMode}
        onValueChange={(value) => value && setViewMode(value as ViewMode)}
        aria-label="View mode"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <ToggleGroupItem value="scroll" aria-label="Scroll all sheets">
              <GalleryVerticalIcon />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>Scroll all sheets</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToggleGroupItem value="single" aria-label="One sheet at a time">
              <SquareIcon />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>One sheet at a time</TooltipContent>
        </Tooltip>
      </ToggleGroup>

      <div className="ml-auto flex items-center gap-1">
        <IconButton
          label="Previous sheet"
          disabled={sheetCount === 0 || current === 0}
          onClick={() => goToSheet(current - 1)}
        >
          <ChevronLeftIcon />
        </IconButton>
        <span
          aria-live="polite"
          className="min-w-[6rem] text-center font-mono text-xs whitespace-nowrap tabular-nums"
        >
          {sheetCount === 0 ? 'No sheets' : `Sheet ${current + 1} of ${sheetCount}`}
        </span>
        <IconButton
          label="Next sheet"
          disabled={sheetCount === 0 || current >= sheetCount - 1}
          onClick={() => goToSheet(current + 1)}
        >
          <ChevronRightIcon />
        </IconButton>
      </div>
    </div>
  )
}
