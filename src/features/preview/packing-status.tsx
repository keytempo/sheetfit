import {
  CircleCheckIcon,
  CircleDotIcon,
  LoaderCircleIcon,
  TimerIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { pluralize } from '@/lib/format'
import type { LayoutResult } from '@/lib/layout-types'

interface PackingStatusProps {
  layout: LayoutResult
  /** The packer has not yet answered for the latest inputs, or is still improving on its answer. */
  searching: boolean
  /** The search stopped at its time limit, not because it was done, and can be continued. */
  limitReached: boolean
  onContinue: () => void
}

/**
 * Tells the truth about the layout on screen: still being improved, proven to use the fewest
 * sheets possible, the best the packer found, or the best it found when the time limit ran out,
 * which comes with a Continue button. Copies that fit on no sheet get their own notice.
 */
export function PackingStatus({ layout, searching, limitReached, onContinue }: PackingStatusProps) {
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
      {layout.sheets.length > 0 && !searching && limitReached && (
        <Badge
          variant="outline"
          className="pointer-events-auto bg-card/85 py-0 pr-0.5 text-muted-foreground backdrop-blur-sm"
        >
          <span role="status" className="inline-flex items-center gap-1">
            <TimerIcon />
            Time limit reached
          </span>
          <Button
            variant="ghost"
            className="h-6 rounded-full px-2 text-xs"
            aria-label="Continue searching for a tighter layout"
            onClick={onContinue}
          >
            Continue
          </Button>
        </Badge>
      )}
      {layout.sheets.length > 0 && (searching || !limitReached) && (
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
