import { AnimatePresence, motion } from 'motion/react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { transitions } from '@/lib/motion'
import { LIMITS, type Orientation, type SheetSizeId } from '@/lib/print-options'
import { SHEET_PRESETS } from '@/lib/sheet'
import { formatSize, UNITS, type Unit } from '@/lib/units'
import { Field } from './field'
import { LengthField } from './length-field'
import { useOption } from './use-option'

const ORIENTATION_HELP: Record<Orientation, string> = {
  portrait: 'The sheet is taller than it is wide.',
  landscape: 'The sheet is wider than it is tall.',
  auto: 'Uses portrait or landscape, whichever needs fewer sheets.',
}

export function SheetSection() {
  const [sheetSize, setSheetSize] = useOption('sheetSize')
  const [customWidth, setCustomWidth] = useOption('customWidth')
  const [customHeight, setCustomHeight] = useOption('customHeight')
  const [orientation, setOrientation] = useOption('orientation')
  const [unit, setUnit] = useOption('unit')
  const { min, max } = LIMITS.sheetSide

  return (
    <>
      <Field
        label="Paper size"
        tooltip="The size of the sheet you load into your printer."
        helper="Pick Custom for any other size."
      >
        {({ controlId }) => (
          <Select value={sheetSize} onValueChange={(value) => setSheetSize(value as SheetSizeId)}>
            <SelectTrigger id={controlId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHEET_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label} · {formatSize(preset.width, preset.height, unit)}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom size…</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>

      <AnimatePresence initial={false}>
        {sheetSize === 'custom' && (
          <motion.div
            initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
            animate={{
              opacity: 1,
              height: 'auto',
              transition: transitions.enter,
              transitionEnd: { overflow: 'visible' },
            }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden', transition: transitions.exit }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Width"
                tooltip="The width of your custom sheet. The shorter side is used as the width in portrait."
              >
                {({ controlId }) => (
                  <LengthField
                    id={controlId}
                    label="Custom sheet width"
                    valueMm={customWidth}
                    onChangeMm={setCustomWidth}
                    minMm={min}
                    maxMm={max}
                  />
                )}
              </Field>
              <Field
                label="Height"
                tooltip="The height of your custom sheet. The longer side is used as the height in portrait."
              >
                {({ controlId }) => (
                  <LengthField
                    id={controlId}
                    label="Custom sheet height"
                    valueMm={customHeight}
                    onChangeMm={setCustomHeight}
                    minMm={min}
                    maxMm={max}
                  />
                )}
              </Field>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Field
        label="Orientation"
        tooltip="Whether the sheet is used upright or on its side. Automatic lets Sheetfit decide."
        helper={ORIENTATION_HELP[orientation]}
      >
        {({ labelId }) => (
          <ToggleGroup
            type="single"
            value={orientation}
            onValueChange={(value) => value && setOrientation(value as Orientation)}
            aria-labelledby={labelId}
            className="w-full"
          >
            <ToggleGroupItem value="portrait">Portrait</ToggleGroupItem>
            <ToggleGroupItem value="landscape">Landscape</ToggleGroupItem>
            <ToggleGroupItem value="auto">Automatic</ToggleGroupItem>
          </ToggleGroup>
        )}
      </Field>

      <Field
        label="Units"
        tooltip="Applies to every length in the app. Values are stored in millimetres, so switching units never changes a size."
        helper="Used for every length in the app."
      >
        {({ labelId }) => (
          <ToggleGroup
            type="single"
            value={unit}
            onValueChange={(value) => value && setUnit(value as Unit)}
            aria-labelledby={labelId}
            className="w-full"
          >
            {UNITS.map((option) => (
              <ToggleGroupItem key={option} value={option}>
                {option}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </Field>
    </>
  )
}
