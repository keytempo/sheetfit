import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'aria-label'> {
  /** The accessible name, also shown as the tooltip unless `tooltip` is given. */
  label: string
  tooltip?: ReactNode
}

export function IconButton({
  label,
  tooltip = label,
  variant = 'ghost',
  size = 'icon-sm',
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} variant={variant} size={size} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
