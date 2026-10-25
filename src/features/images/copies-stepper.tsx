import { MinusIcon, PlusIcon } from 'lucide-react'
import { NumberField } from '@/components/number-field'
import { Button } from '@/components/ui/button'
import { LIMITS } from '@/lib/print-options'
import { useAppStore } from '@/store'
import type { ImageItem } from '@/store/types'

export function CopiesStepper({ image }: { image: ImageItem }) {
  const setCopies = useAppStore((state) => state.setCopies)
  const { min, max } = LIMITS.copies

  return (
    <div
      role="group"
      aria-label={`Copies of ${image.name}`}
      className="inline-flex items-center rounded-lg border border-input bg-background p-0.5 shadow-xs"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Fewer copies"
        disabled={image.copies <= min}
        onClick={() => setCopies(image.id, image.copies - 1)}
      >
        <MinusIcon />
      </Button>
      <NumberField
        aria-label={`Number of copies of ${image.name}`}
        value={image.copies}
        onChange={(copies) => setCopies(image.id, copies)}
        min={min}
        max={max}
        decimals={0}
        className="w-12"
        inputClassName="h-8 border-0 bg-transparent px-1 text-center text-base font-semibold shadow-none focus-visible:ring-2"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="More copies"
        disabled={image.copies >= max}
        onClick={() => setCopies(image.id, image.copies + 1)}
      >
        <PlusIcon />
      </Button>
    </div>
  )
}
