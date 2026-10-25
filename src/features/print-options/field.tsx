import { InfoIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          className="flex size-4 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-11"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[16rem]">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

interface FieldProps {
  label: string
  /** Longer explanation, shown in the tooltip of the info icon. */
  tooltip: string
  /** Short helper line under the control. */
  helper?: ReactNode
  className?: string
  /** Receives the ids to attach to the control and, for grouped controls, to its group. */
  children: (ids: { controlId: string; labelId: string }) => ReactNode
}

/** A labelled control with a tooltip and a short helper line. */
export function Field({ label, tooltip, helper, className, children }: FieldProps) {
  const controlId = useId()
  const labelId = `${controlId}-label`

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-1.5">
        <Label id={labelId} htmlFor={controlId}>
          {label}
        </Label>
        <InfoTip label={label}>{tooltip}</InfoTip>
      </div>
      {children({ controlId, labelId })}
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  )
}

interface SwitchFieldProps {
  label: string
  tooltip: string
  helper: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/** A labelled on/off setting with the switch at the right-hand edge. */
export function SwitchField({
  label,
  tooltip,
  helper,
  checked,
  onCheckedChange,
}: SwitchFieldProps) {
  const id = useId()

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          <InfoTip label={label}>{tooltip}</InfoTip>
        </div>
        <p className="text-xs text-muted-foreground">{helper}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />
    </div>
  )
}
