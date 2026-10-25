import { LIMITS } from '@/lib/print-options'
import { getMaxMargin, getSheetGeometry } from '@/lib/sheet'
import { useAppStore } from '@/store'
import { Field } from './field'
import { LengthSlider } from './length-field'
import { useOption } from './use-option'

export function SpacingSection() {
  const options = useAppStore((state) => state.options)
  const [, setMargin] = useOption('margin')
  const [gap, setGap] = useOption('gap')

  const margin = getSheetGeometry(options).margin

  return (
    <>
      <Field
        label="Page margin"
        tooltip="A blank border kept clear around every sheet. Many printers cannot print right to the edge."
        helper="Nothing is placed inside this border."
      >
        {({ controlId }) => (
          <LengthSlider
            id={controlId}
            label="Page margin"
            valueMm={margin}
            onChangeMm={setMargin}
            minMm={LIMITS.margin.min}
            maxMm={getMaxMargin(options)}
            stepMm={0.5}
          />
        )}
      </Field>
      <Field
        label="Gap between photos"
        tooltip="Space left between neighbouring photos so there is room for the blade when you cut."
        helper="Zero packs photos edge to edge."
      >
        {({ controlId }) => (
          <LengthSlider
            id={controlId}
            label="Gap between photos"
            valueMm={gap}
            onChangeMm={setGap}
            minMm={LIMITS.gap.min}
            maxMm={LIMITS.gap.max}
            stepMm={0.5}
          />
        )}
      </Field>
    </>
  )
}
