import { NumberField } from '@/components/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LIMITS, type BaseSizeMode } from '@/lib/print-options'
import { formatLength } from '@/lib/units'
import { useAppStore } from '@/store'
import { Field } from './field'
import { LengthField } from './length-field'
import { useOption } from './use-option'

const MODE_LABELS: Record<BaseSizeMode, string> = {
  width: 'Fixed width',
  height: 'Fixed height',
  longest: 'Longest side',
  native: 'Native size at a set DPI',
}

const LENGTH_LABELS = { width: 'Width', height: 'Height', longest: 'Longest side' } as const

const SIDE_NAMES = { width: 'width', height: 'height', longest: 'longest side' } as const

export function BaseSizeSection() {
  const [mode, setMode] = useOption('baseMode')
  const [length, setLength] = useOption('baseLength')
  const [dpi, setDpi] = useOption('baseDpi')
  const unit = useAppStore((state) => state.options.unit)

  const explanation =
    mode === 'native'
      ? `At 100%, every photo prints at ${dpi} DPI, so a larger photo prints larger.`
      : `At 100%, the ${SIDE_NAMES[mode]} of every photo is ${formatLength(length, unit)} ${unit}. The other side follows its aspect ratio.`

  return (
    <>
      <Field
        label="Size at 100%"
        tooltip="Decides what 100% means on every image's size slider. Each slider then scales from this base."
        helper={explanation}
      >
        {({ controlId }) => (
          <Select value={mode} onValueChange={(value) => setMode(value as BaseSizeMode)}>
            <SelectTrigger id={controlId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABELS) as BaseSizeMode[]).map((option) => (
                <SelectItem key={option} value={option}>
                  {MODE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      {mode === 'native' ? (
        <Field
          label="Print resolution"
          tooltip="Dots per inch. 300 DPI is sharp for photos; lower values print each photo larger."
          helper="Photos that end up below 150 DPI are flagged in the list."
        >
          {({ controlId }) => (
            <NumberField
              id={controlId}
              aria-label="Print resolution in DPI"
              value={dpi}
              onChange={setDpi}
              min={LIMITS.dpi.min}
              max={LIMITS.dpi.max}
              decimals={0}
              suffix="DPI"
            />
          )}
        </Field>
      ) : (
        <Field
          label={LENGTH_LABELS[mode]}
          tooltip="The size every photo gets at 100%. Individual sliders then make it smaller or larger."
        >
          {({ controlId }) => (
            <LengthField
              id={controlId}
              label={`Base ${LENGTH_LABELS[mode].toLowerCase()}`}
              valueMm={length}
              onChangeMm={setLength}
              minMm={LIMITS.baseLength.min}
              maxMm={LIMITS.baseLength.max}
            />
          )}
        </Field>
      )}
    </>
  )
}
