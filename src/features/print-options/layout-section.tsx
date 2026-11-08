import { Field, SwitchField } from './field'
import { NumberField } from '@/components/number-field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LIMITS, type Ordering } from '@/lib/print-options'
import { cn } from '@/lib/utils'
import { useOption } from './use-option'

const ORDERING_HELP: Record<Ordering, string> = {
  optimize: 'Optimize packing: pieces may be rearranged to waste as little paper as possible.',
  strict: 'Strict order: pieces are placed in list order, even when that wastes more paper.',
}

export function LayoutSection() {
  const [allowRotation, setAllowRotation] = useOption('allowRotation')
  const [ordering, setOrdering] = useOption('ordering')
  const [timeLimit, setTimeLimit] = useOption('timeLimit')
  const [cutGuides, setCutGuides] = useOption('cutGuides')

  return (
    <>
      <SwitchField
        label="Allow 90° rotation"
        tooltip="Lets a photo be turned sideways when that fits more on a sheet. The photo itself is never stretched or resampled."
        helper="Turned photos fit tighter, so less paper is wasted."
        checked={allowRotation}
        onCheckedChange={setAllowRotation}
      />

      <Field
        label="Ordering"
        tooltip="Choose between the tightest possible packing and keeping your list order on the sheets."
      >
        {({ labelId }) => (
          <>
            <ToggleGroup
              type="single"
              value={ordering}
              onValueChange={(value) => value && setOrdering(value as Ordering)}
              aria-labelledby={labelId}
              className="w-full"
            >
              <ToggleGroupItem value="optimize">Optimize packing</ToggleGroupItem>
              <ToggleGroupItem value="strict">Strict order</ToggleGroupItem>
            </ToggleGroup>
            <ul className="flex flex-col gap-1 text-xs">
              {(Object.keys(ORDERING_HELP) as Ordering[]).map((option) => (
                <li
                  key={option}
                  className={cn(
                    'transition-colors',
                    option === ordering ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {ORDERING_HELP[option]}
                </li>
              ))}
            </ul>
          </>
        )}
      </Field>

      <Field
        label="Packing time limit"
        tooltip="How long the packer may keep searching for a tighter layout. When the time is up the preview offers Continue, which searches again from the best layout found, for as long again."
        helper={
          ordering === 'strict'
            ? 'Not used with Strict order, which has nothing to search.'
            : 'Longer can save paper but makes you wait. Small jobs finish sooner.'
        }
      >
        {({ controlId }) => (
          <NumberField
            id={controlId}
            aria-label="Packing time limit in seconds"
            value={timeLimit}
            onChange={setTimeLimit}
            min={LIMITS.timeLimit.min}
            max={LIMITS.timeLimit.max}
            decimals={0}
            suffix="s"
            disabled={ordering === 'strict'}
          />
        )}
      </Field>

      <SwitchField
        label="Cut guides"
        tooltip="Draws a hairline border around every photo in the PDF, so you can see exactly where to cut."
        helper="A thin border marks each cut line."
        checked={cutGuides}
        onCheckedChange={setCutGuides}
      />
    </>
  )
}
