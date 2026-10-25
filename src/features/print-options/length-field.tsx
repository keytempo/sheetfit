import { NumberField } from '@/components/number-field'
import { Slider } from '@/components/ui/slider'
import { FIELD_DECIMALS, mmToUnit, unitToMm } from '@/lib/units'
import { useAppStore } from '@/store'

const ARROW_STEP_MM = 0.5

interface LengthFieldProps {
  id?: string
  label: string
  valueMm: number
  onChangeMm: (mm: number) => void
  minMm: number
  maxMm: number
  className?: string
}

/** A numeric field that shows a length in the chosen unit and stores it in millimetres. */
export function LengthField({
  id,
  label,
  valueMm,
  onChangeMm,
  minMm,
  maxMm,
  className,
}: LengthFieldProps) {
  const unit = useAppStore((state) => state.options.unit)

  return (
    <NumberField
      id={id}
      aria-label={label}
      value={mmToUnit(valueMm, unit)}
      onChange={(value) => onChangeMm(unitToMm(value, unit))}
      min={mmToUnit(minMm, unit)}
      max={mmToUnit(maxMm, unit)}
      step={mmToUnit(ARROW_STEP_MM, unit)}
      decimals={FIELD_DECIMALS[unit]}
      suffix={unit}
      className={className}
    />
  )
}

interface LengthSliderProps extends LengthFieldProps {
  stepMm: number
}

/** A slider and a length field bound to the same millimetre value. */
export function LengthSlider({ stepMm, ...field }: LengthSliderProps) {
  return (
    <div className="flex items-center gap-3">
      <Slider
        aria-label={field.label}
        min={field.minMm}
        max={field.maxMm}
        step={stepMm}
        value={[field.valueMm]}
        onValueChange={([value]) => field.onChangeMm(value)}
      />
      <LengthField {...field} className="w-28 shrink-0" />
    </div>
  )
}
