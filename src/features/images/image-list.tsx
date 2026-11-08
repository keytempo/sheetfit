import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type DndContextProps,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { listEmptyClick } from '@/features/selection/empty-space'
import { useAppStore } from '@/store'
import { DragGrip } from './drag-grip'
import { ImagePreviewDialog, type PreviewState } from './image-preview-dialog'
import { ImageRow } from './image-row'
import { SortableImageRow } from './sortable-image-row'

/*
 * dnd-kit memoises on the identity of everything passed to it. These are module constants, not
 * inline values, so they keep the same identity on every render and the rows are not
 * re-rendered each time one of them changes.
 */
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } }
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates }
const MODIFIERS = [restrictToVerticalAxis]

const nameOf = (id: string | number) =>
  useAppStore.getState().images.find((image) => image.id === id)?.name ?? 'image'
const positionOf = (id: string | number) =>
  useAppStore.getState().images.findIndex((image) => image.id === id) + 1
const total = () => useAppStore.getState().images.length

const announcements: Announcements = {
  onDragStart: ({ active }) =>
    `Picked up ${nameOf(active.id)}, position ${positionOf(active.id)} of ${total()}.`,
  onDragOver: ({ active, over }) =>
    over ? `${nameOf(active.id)} is over position ${positionOf(over.id)}.` : undefined,
  onDragEnd: ({ active, over }) =>
    `Dropped ${nameOf(active.id)} at position ${positionOf(over?.id ?? active.id)} of ${total()}.`,
  onDragCancel: ({ active }) =>
    `Reordering cancelled. ${nameOf(active.id)} stays at position ${positionOf(active.id)}.`,
}

const ACCESSIBILITY: DndContextProps['accessibility'] = {
  announcements,
  screenReaderInstructions: {
    draggable:
      'To reorder, press Space or Enter on an image’s grip, move it with the arrow keys, then press Space or Enter to drop it or Escape to cancel.',
  },
}

function SkeletonRow() {
  return (
    <li aria-hidden="true" className="flex gap-3 border-b px-3 py-3 pl-9">
      <Skeleton className="size-16 shrink-0" />
      <div className="flex flex-1 flex-col gap-2.5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-9 w-32" />
      </div>
    </li>
  )
}

export function ImageList() {
  const images = useAppStore((state) => state.images)
  const loadingCount = useAppStore((state) => state.loadingCount)
  const restoring = useAppStore((state) => state.workStatus === 'restoring')
  const selectedImageId = useAppStore((state) => state.selectedImageId)
  const moveImage = useAppStore((state) => state.moveImage)
  // The ids only change when images are added, removed or reordered, not when one is resized.
  const ids = useAppStore(useShallow((state) => state.images.map((image) => image.id)))

  const [activeId, setActiveId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  )

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id))

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (over && active.id !== over.id) {
      moveImage(
        String(active.id),
        images.findIndex((image) => image.id === over.id),
      )
    }
  }

  const activeIndex = images.findIndex((image) => image.id === activeId)
  const activeImage = activeIndex >= 0 ? images[activeIndex] : undefined
  const tabbableId = images.some((image) => image.id === selectedImageId)
    ? selectedImageId
    : images[0]?.id

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={MODIFIERS}
        accessibility={ACCESSIBILITY}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ScrollArea
            className="min-h-0 flex-1"
            onPointerDown={listEmptyClick.onPointerDown}
            onPointerCancel={listEmptyClick.onPointerCancel}
            onClick={listEmptyClick.onClick}
          >
            <ul
              aria-label="Images"
              aria-busy={loadingCount > 0 || restoring}
              className="flex flex-col"
            >
              <AnimatePresence initial={false}>
                {images.map((image, index) => (
                  <SortableImageRow
                    key={image.id}
                    image={image}
                    index={index}
                    count={images.length}
                    tabbable={image.id === tabbableId}
                    onPreview={setPreview}
                  />
                ))}
              </AnimatePresence>
              {Array.from(
                { length: Math.min(restoring ? Math.max(loadingCount, 3) : loadingCount, 4) },
                (_, i) => (
                  <SkeletonRow key={`loading-${i}`} />
                ),
              )}
            </ul>
          </ScrollArea>
        </SortableContext>

        <DragOverlay>
          {activeImage && (
            <ImageRow
              lifted
              image={activeImage}
              index={activeIndex}
              count={images.length}
              handle={<DragGrip tabIndex={-1} aria-hidden="true" className="cursor-grabbing" />}
            />
          )}
        </DragOverlay>
      </DndContext>

      {preview && (
        <ImagePreviewDialog
          image={preview.image}
          open={preview.open}
          onOpenChange={(open) => setPreview({ image: preview.image, open })}
        />
      )}
    </>
  )
}
