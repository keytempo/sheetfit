import { pluralize } from '@/lib/format'
import { useAppStore } from '@/store'
import { useTotalPieces } from '@/store/derived'

/**
 * The line under "Images": how many pieces and images there are, or how far a batch has got. It
 * reads its own state, so progress that changes with every decoded photo re-renders only this line.
 */
export function ListSummary() {
  const imageCount = useAppStore((state) => state.images.length)
  const loadingCount = useAppStore((state) => state.loadingCount)
  const decodedCount = useAppStore((state) => state.decodedCount)
  const importKind = useAppStore((state) => state.importKind)
  const restoring = useAppStore((state) => state.workStatus === 'restoring')
  const totalPieces = useTotalPieces()

  return (
    <p className="truncate font-mono text-xs text-muted-foreground tabular-nums">
      {loadingCount > 0
        ? `${importKind === 'restore' ? 'Restoring' : 'Adding'} ${decodedCount} of ${loadingCount}…`
        : restoring
          ? 'Restoring your work…'
          : `${pluralize(totalPieces, 'piece')} · ${pluralize(imageCount, 'image')}`}
    </p>
  )
}
