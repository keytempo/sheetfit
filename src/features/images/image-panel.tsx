import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { fade } from '@/lib/motion'
import { useAppStore } from '@/store'
import { EmptyState } from './empty-state'
import { ImageList } from './image-list'
import { ImageListToolbar } from './image-list-toolbar'
import { ShortcutsDialog } from './shortcuts-dialog'

/** The left panel: an empty state until the first image is added, then the reorderable list. */
export function ImagePanel() {
  const hasContent = useAppStore((state) => state.images.length > 0 || state.loadingCount > 0)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  return (
    <section aria-label="Images" className="flex h-full min-h-0 flex-col bg-card">
      <AnimatePresence mode="wait" initial={false}>
        {hasContent ? (
          <motion.div key="list" {...fade} className="flex min-h-0 flex-1 flex-col">
            <ImageListToolbar onShowShortcuts={() => setShortcutsOpen(true)} />
            <ImageList />
          </motion.div>
        ) : (
          <motion.div key="empty" {...fade} className="flex min-h-0 flex-1 flex-col">
            <EmptyState />
          </motion.div>
        )}
      </AnimatePresence>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </section>
  )
}
