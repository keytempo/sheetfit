import { ImagesIcon, LayoutPanelTopIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { ImagePanel } from '@/features/images/image-panel'
import { PreviewPanel } from '@/features/preview/preview-panel'
import { PrintOptionsSheet } from '@/features/print-options/print-options-sheet'
import { fadeSlide } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useTotalPieces } from '@/store/derived'
import type { MobileTab } from '@/store/types'

const TABS = [
  { id: 'images', label: 'Images', icon: ImagesIcon },
  { id: 'preview', label: 'Preview', icon: LayoutPanelTopIcon },
] as const satisfies readonly { id: MobileTab; label: string; icon: unknown }[]

/** Narrow screens: one panel at a time with a bottom navigation, and the options full screen. */
export function MobileLayout() {
  const tab = useAppStore((state) => state.mobileTab)
  const setTab = useAppStore((state) => state.setMobileTab)
  const totalPieces = useTotalPieces()

  return (
    <div className="flex size-full flex-col">
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} {...fadeSlide} className="absolute inset-0">
            {tab === 'images' ? <ImagePanel /> : <PreviewPanel />}
          </motion.div>
        </AnimatePresence>
      </div>

      <nav
        aria-label="Views"
        className="grid shrink-0 grid-cols-2 border-t bg-card pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              tab === id ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <span className="relative">
              <Icon className="size-5" />
              {id === 'images' && totalPieces > 0 && (
                <span className="absolute -top-1.5 left-3 min-w-4 rounded-full bg-primary px-1 text-center font-mono text-[10px] leading-4 text-primary-foreground">
                  {totalPieces}
                </span>
              )}
            </span>
            {label}
          </button>
        ))}
      </nav>

      <PrintOptionsSheet />
    </div>
  )
}
