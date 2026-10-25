import {
  defaultAnimateLayoutChanges,
  useSortable,
  type AnimateLayoutChanges,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import { memo } from 'react'
import { transitions } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { ImageItem } from '@/store/types'
import { DragGrip } from './drag-grip'
import type { PreviewState } from './image-preview-dialog'
import { ImageRow } from './image-row'

const SORT_TRANSITION = { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }

/** Also glide when an order change comes from the buttons or the keyboard rather than a drag. */
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  args.wasDragging ? defaultAnimateLayoutChanges(args) : true

interface SortableImageRowProps {
  image: ImageItem
  index: number
  count: number
  tabbable: boolean
  onPreview: (preview: PreviewState) => void
}

/**
 * Memoised on purpose: dragging a slider changes one image, and without this every row in the list
 * re-rendered on every pointer move. All props are primitives, the image object itself, or a stable setter.
 */
export const SortableImageRow = memo(function SortableImageRow({
  image,
  ...rowProps
}: SortableImageRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id, transition: SORT_TRANSITION, animateLayoutChanges })

  return (
    <motion.li
      initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
      animate={{
        opacity: 1,
        height: 'auto',
        transition: transitions.enter,
        transitionEnd: { overflow: 'visible' },
      }}
      exit={{ opacity: 0, height: 0, overflow: 'hidden', transition: transitions.exit }}
    >
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn('relative', isDragging && 'opacity-40')}
      >
        <ImageRow
          image={image}
          {...rowProps}
          handle={
            <DragGrip
              ref={setActivatorNodeRef}
              aria-label={`Reorder ${image.name}`}
              className="cursor-grab active:cursor-grabbing"
              {...attributes}
              {...listeners}
            />
          }
        />
      </div>
    </motion.li>
  )
})
