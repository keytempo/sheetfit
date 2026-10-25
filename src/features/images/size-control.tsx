import { RotateCcwIcon } from 'lucide-react'
import { NumberField } from '@/components/number-field'
import { IconButton } from '@/components/icon-button'
import { Slider } from '@/components/ui/slider'
import { formatPercent } from '@/lib/format'
import type { PrintInfo } from '@/lib/sizing'
import { useAppStore } from '@/store'
import type { ImageItem } from '@/store/types'

interface SizeControlProps {
  image: ImageItem
  info: PrintInfo
}

/** The relative size slider with its numeric twin and reset button. */
export function SizeControl({ image, info }: SizeControlProps) {
  const setPercent = useAppStore((state) => state.setPercent)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Slider
          aria-label={`Print size of ${image.name}`}
          min={info.minPercent}
          max={info.maxPercent}
          step={1}
          value={[info.percent]}
          onValueChange={([percent]) => setPercent(image.id, percent)}
        />
        <NumberField
          aria-label={`Print size of ${image.name} in percent`}
          value={info.percent}
          onChange={(percent) => setPercent(image.id, percent)}
          min={info.minPercent}
          max={info.maxPercent}
          decimals={1}
          suffix="%"
          className="w-[4.75rem] shrink-0"
          inputClassName="h-8 px-2 text-xs pointer-coarse:h-11"
        />
        <IconButton
          label="Reset size to 100%"
          disabled={image.percent === 100}
          onClick={() => setPercent(image.id, 100)}
        >
          <RotateCcwIcon />
        </IconButton>
      </div>
      {info.limited && (
        <p className="text-xs text-warning-foreground">
          Limited by the sheet: {formatPercent(info.maxPercent)}% is the largest that fits.
        </p>
      )}
    </div>
  )
}
