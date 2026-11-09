import { CircleCheckIcon, CircleDotIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react'
import { Badge, badgeVariants } from '@/components/ui/badge'
import { pluralize } from '@/lib/format'
import type { LayoutResult } from '@/lib/layout-types'
import { cn } from '@/lib/utils'

/** What the status pill looks like in every state, Continue included: the same tokens, nothing added. */
const STATUS_PILL = 'bg-card/85 text-muted-foreground backdrop-blur-sm'

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
 * which shows as a Continue pill that looks like the others. Copies that fit on no sheet get
 * their own notice.
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
        <>
          {/* What a screen reader hears; what everyone sees is the Continue pill. */}
          <span role="status" className="sr-only">
            Time limit reached
          </span>
          <button
            type="button"
            aria-label="Continue searching for a tighter layout"
            className={cn(
              badgeVariants({ variant: 'outline' }),
              STATUS_PILL,
              // Looks like the pill beside it. What is added is invisible: the pointer, the focus ring, and a
              // clickable margin round it (wider on touch screens) so a 22 px pill is still an easy target.
              'pointer-events-auto relative cursor-pointer overflow-visible outline-none after:absolute after:-inset-1 pointer-coarse:after:-inset-3 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            )}
            onClick={onContinue}
          >
            Continue
          </button>
        </>
      )}
      {layout.sheets.length > 0 && (searching || !limitReached) && (
        <Badge role="status" variant="outline" className={STATUS_PILL}>
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
