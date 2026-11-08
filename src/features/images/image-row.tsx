import { ChevronDownIcon, ChevronUpIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { IconButton } from '@/components/icon-button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { rowDomId } from '@/lib/dom-ids'
import { getSheetGeometry } from '@/lib/sheet'
import { getPrintInfo, LOW_DPI_THRESHOLD } from '@/lib/sizing'
import { formatSize } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { ImageItem } from '@/store/types'
import { CopiesStepper } from './copies-stepper'
import type { PreviewState } from './image-preview-dialog'
import { removeImageWithUndo } from './remove-image'
import { SizeControl } from './size-control'

interface ImageRowProps {
  image: ImageItem
  index: number
  count: number
  /** The drag grip. The sortable wrapper supplies the interactive one. */
  handle: ReactNode
  /** Whether the row is the single tab stop of the list. */
  tabbable?: boolean
  /** True for the copy shown under the pointer while dragging. */
  lifted?: boolean
  /** A React state setter, so its identity never changes and rows can be memoised. */
  onPreview?: (preview: PreviewState) => void
}

const focusRow = (imageId: string) => document.getElementById(rowDomId(imageId))?.focus()

export function ImageRow({
  image,
  index,
  count,
  handle,
  tabbable = false,
  lifted = false,
  onPreview,
}: ImageRowProps) {
  const options = useAppStore((state) => state.options)
  const selected = useAppStore((state) => state.selectedImageId === image.id)
  const hovered = useAppStore((state) => state.hoveredPiece?.imageId === image.id)
  const selectImage = useAppStore((state) => state.selectImage)
  const moveImage = useAppStore((state) => state.moveImage)
  const setCopies = useAppStore((state) => state.setCopies)

  const info = getPrintInfo(image, options, getSheetGeometry(options))
  const unit = options.unit

  const moveBy = (offset: number) => {
    flushSync(() => moveImage(image.id, index + offset))
    focusRow(image.id)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Shortcuts apply only when the row itself has focus, never while typing in one of its fields.
    if (event.target !== event.currentTarget) return
    const { images } = useAppStore.getState()

    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        const offset = event.key === 'ArrowUp' ? -1 : 1
        if (event.altKey) {
          moveBy(offset)
        } else {
          const neighbour = images[index + offset]
          if (neighbour) {
            selectImage(neighbour.id)
            focusRow(neighbour.id)
          }
        }
        break
      }
      case 'Delete':
      case 'Backspace': {
        const neighbour = images[index + 1] ?? images[index - 1]
        flushSync(() => {
          removeImageWithUndo(image.id)
          selectImage(neighbour?.id ?? null)
        })
        if (neighbour) focusRow(neighbour.id)
        break
      }
      case '+':
      case '=':
        setCopies(image.id, image.copies + 1)
        break
      case '-':
      case '_':
        setCopies(image.id, image.copies - 1)
        break
      case 'Enter':
      case ' ':
        onPreview?.({ image, open: true })
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div
      id={lifted ? undefined : rowDomId(image.id)}
      role="group"
      data-image-row=""
      aria-label={image.name}
      aria-current={selected ? 'true' : undefined}
      tabIndex={lifted ? undefined : tabbable ? 0 : -1}
      data-empty={image.copies === 0}
      onClick={() => selectImage(image.id)}
      onKeyDown={handleKeyDown}
      className={cn(
        'group/row relative flex gap-1.5 border-b bg-card px-2 py-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary before:opacity-0 before:transition-opacity',
        hovered && 'bg-accent/40',
        selected && 'bg-accent/70 before:opacity-100',
        lifted && 'rounded-lg border shadow-xl ring-1 ring-primary/40',
      )}
    >
      {handle}

      <div className="flex min-w-0 flex-1 flex-col gap-3 pr-1">
        <div className="flex gap-3">
          <button
            type="button"
            aria-label={`Preview ${image.name}`}
            onClick={() => onPreview?.({ image, open: true })}
            className="size-16 shrink-0 overflow-hidden rounded-md border bg-muted p-0.5 outline-none transition-[border-color,box-shadow,opacity] group-data-[empty=true]/row:opacity-50 hover:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <img
              src={image.thumbUrl}
              alt=""
              draggable={false}
              className="size-full rounded-[4px] object-contain"
            />
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-start gap-1">
              <div className="min-w-0 flex-1 group-data-[empty=true]/row:opacity-50">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="truncate text-sm leading-5 font-medium">{image.name}</p>
                  </TooltipTrigger>
                  <TooltipContent>{image.name}</TooltipContent>
                </Tooltip>
                <p className="font-mono text-xs text-muted-foreground tabular-nums">
                  {image.width} × {image.height} px
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <IconButton
                  label="Move up"
                  size="icon-xs"
                  disabled={index === 0}
                  onClick={() => moveBy(-1)}
                >
                  <ChevronUpIcon />
                </IconButton>
                <IconButton
                  label="Move down"
                  size="icon-xs"
                  disabled={index === count - 1}
                  onClick={() => moveBy(1)}
                >
                  <ChevronDownIcon />
                </IconButton>
                <IconButton
                  label="Remove image"
                  size="icon-xs"
                  className="hover:text-destructive"
                  onClick={() => removeImageWithUndo(image.id)}
                >
                  <XIcon />
                </IconButton>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <CopiesStepper image={image} />
              <div className="flex items-center gap-2 group-data-[empty=true]/row:opacity-50">
                <span className="font-mono text-xs font-medium tabular-nums">
                  {formatSize(info.width, info.height, unit)}
                </span>
                {info.lowResolution && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="warning"
                        tabIndex={0}
                        aria-label={`Low resolution: about ${Math.round(info.dpi)} DPI`}
                        className="font-mono"
                      >
                        <TriangleAlertIcon />
                        {Math.round(info.dpi)} DPI
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      At this size the print resolution is about {Math.round(info.dpi)} DPI. Below{' '}
                      {LOW_DPI_THRESHOLD} DPI a photo can look soft.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="group-data-[empty=true]/row:opacity-50">
          <SizeControl image={image} info={info} />
        </div>
      </div>
    </div>
  )
}
