import { motion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { rowDomId } from '@/lib/dom-ids'
import type { PlacedPiece } from '@/lib/layout-types'
import { transitions } from '@/lib/motion'
import { scrollBehavior } from '@/lib/scroll'
import { formatSize } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { ImageItem } from '@/store/types'

interface PieceProps {
  placed: PlacedPiece
  image: ImageItem
  sheetWidth: number
  sheetHeight: number
}

/**
 * One printed copy on a sheet. It is positioned in percentages of the page, so it follows every
 * zoom level for free, and moved with a Motion layout animation (transforms only) when anything
 * about the layout changes.
 */
export function Piece({ placed, image, sheetWidth, sheetHeight }: PieceProps) {
  const { piece } = placed
  const unit = useAppStore((state) => state.options.unit)
  const cutGuides = useAppStore((state) => state.options.cutGuides)
  const selected = useAppStore((state) => state.selectedImageId === piece.imageId)
  const dimmed = useAppStore(
    (state) => state.selectedImageId !== null && state.selectedImageId !== piece.imageId,
  )
  const selectImage = useAppStore((state) => state.selectImage)
  const setHoveredPiece = useAppStore((state) => state.setHoveredPiece)

  const handleClick = () => {
    selectImage(piece.imageId)
    document
      .getElementById(rowDomId(piece.imageId))
      ?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }

  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <motion.div
          layout
          initial={{ opacity: 0 }}
          animate={{ opacity: dimmed ? 0.35 : 1 }}
          exit={{ opacity: 0, transition: transitions.exit }}
          transition={{ layout: transitions.layout, opacity: transitions.enter }}
          className={cn('group/piece absolute cursor-pointer', selected && 'z-10')}
          style={{
            left: `${(placed.x / sheetWidth) * 100}%`,
            top: `${(placed.y / sheetHeight) * 100}%`,
            width: `${(placed.width / sheetWidth) * 100}%`,
            height: `${(placed.height / sheetHeight) * 100}%`,
          }}
          onPointerEnter={() => setHoveredPiece({ id: piece.id, imageId: piece.imageId })}
          onPointerLeave={() => setHoveredPiece(null)}
          onClick={handleClick}
        >
          {placed.rotated ? (
            <img
              src={image.thumbUrl}
              alt=""
              draggable={false}
              className="absolute top-1/2 left-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90 select-none"
              style={{
                width: `${(placed.height / placed.width) * 100}%`,
                height: `${(placed.width / placed.height) * 100}%`,
              }}
            />
          ) : (
            <img
              src={image.thumbUrl}
              alt=""
              draggable={false}
              className="size-full object-fill select-none"
            />
          )}
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-0 border transition-[box-shadow,background-color,border-color]',
              cutGuides ? 'border-neutral-900/80' : 'border-neutral-900/15',
              'group-hover/piece:bg-primary/10',
              selected && 'shadow-[0_0_0_2px_var(--primary)]',
            )}
          />
        </motion.div>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex flex-col gap-0.5">
        <span className="font-medium">{image.name}</span>
        <span className="font-mono tabular-nums opacity-80">
          Copy {piece.copy} of {piece.copies} · {formatSize(piece.width, piece.height, unit)}
        </span>
        <span className="opacity-80">{placed.rotated ? 'Rotated 90°' : 'Not rotated'}</span>
      </TooltipContent>
    </Tooltip>
  )
}
