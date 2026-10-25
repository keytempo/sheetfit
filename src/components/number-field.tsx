import { useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { formatNumber } from '@/lib/units'
import { clamp, cn } from '@/lib/utils'

interface NumberFieldProps {
  id?: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  /** Amount added or removed by the arrow keys. Shift multiplies it by ten. */
  step?: number
  /** Most decimals the field accepts and shows. 0 makes it an integer field. */
  decimals: number
  suffix?: string
  disabled?: boolean
  className?: string
  inputClassName?: string
  'aria-label': string
}

const TYPEABLE = /^\d*[.,]?\d*$/

/**
 * A numeric text field. While the person types it keeps their text and reports every value that is
 * already valid and in range; on blur it clamps and tidies the text. Arrow keys step the value.
 */
export function NumberField({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals,
  suffix,
  disabled,
  className,
  inputClassName,
  'aria-label': ariaLabel,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const normalise = (raw: number) => Number(clamp(raw, min, max).toFixed(decimals))
  const parse = (text: string) => Number.parseFloat(text.replace(',', '.'))

  const commitDraft = () => {
    if (draft === null) return
    const parsed = parse(draft)
    if (Number.isFinite(parsed)) onChange(normalise(parsed))
    setDraft(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitDraft()
    } else if (event.key === 'Escape') {
      setDraft(null)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' ? 1 : -1
      onChange(normalise(value + direction * step * (event.shiftKey ? 10 : 1)))
      setDraft(null)
    }
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        type="text"
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        disabled={disabled}
        value={draft ?? formatNumber(value, decimals)}
        onChange={(event) => {
          const text = event.target.value
          if (!TYPEABLE.test(text)) return
          setDraft(text)
          const parsed = parse(text)
          if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
            onChange(Number(parsed.toFixed(decimals)))
          }
        }}
        onFocus={(event) => event.target.select()}
        onBlur={commitDraft}
        onKeyDown={handleKeyDown}
        className={cn('font-mono tabular-nums', suffix && 'pr-9', inputClassName)}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center font-mono text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  )
}
