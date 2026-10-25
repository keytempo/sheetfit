import { useAppStore } from '@/store'

/** Announces adds, removals and reorders to screen readers. */
export function LiveRegion() {
  const announcement = useAppStore((state) => state.announcement)
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  )
}
