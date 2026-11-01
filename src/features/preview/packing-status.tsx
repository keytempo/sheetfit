import { CircleCheckIcon, CircleDotIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { pluralize } from '@/lib/format'
import type { LayoutResult } from '@/lib/layout-types'

interface PackingStatusProps {
  layout: LayoutResult
  /** The packer has not yet answered for the latest inputs, or is still improving on its answer. */
  searching: boolean
}

/**
 * Tells the truth about the layout on screen: still being improved, proven to use the fewest
 * sheets possible, or the best the packer found. Copies that fit on no sheet get their own notice.
 */
export function PackingStatus({ layout, searching }: PackingStatusProps) {
  const unplaced = layout.unplaceable.length

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col items-start gap-1.5">
      {unplaced > 0 && (
        <Badge variant="warning" className="bg-card/85 backdrop-blur-sm">
          <TriangleAlertIcon />
          {pluralize(unplaced, 'copy', 'copies')} {unplaced === 1 ? 'does' : 'do'} not fit on the
          sheet
        </Badge>
      )}
      {layout.sheets.length > 0 && (
        <Badge
          role="status"
          variant="outline"
          className="bg-card/85 text-muted-foreground backdrop-blur-sm"
        >
          {searching ? (
            <>
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              Optimizing…
            </>
          ) : layout.status === 'optimal' ? (
            <>
              <CircleCheckIcon />
              Optimal
            </>
          ) : (
            <>
              <CircleDotIcon />
              Best found
            </>
          )}
        </Badge>
      )}
    </div>
  )
}
