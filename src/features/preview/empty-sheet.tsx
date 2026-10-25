import { ImagePlusIcon } from 'lucide-react'
import type { LayoutResult } from '@/lib/layout-types'
import { CropMarks } from './crop-marks'
import { SheetFrame } from './sheet-frame'

/** A blank sheet at the chosen size and orientation, shown while there is nothing to place. */
export function EmptySheet({ layout }: { layout: LayoutResult }) {
  return (
    <div className="relative mx-auto">
      <CropMarks />
      <SheetFrame layout={layout}>
        <div className="absolute inset-x-0 top-[12%] flex flex-col items-center gap-2 overflow-hidden p-6 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ImagePlusIcon className="size-5" />
          </span>
          <p className="font-display text-base font-semibold tracking-tight text-neutral-800">
            Your sheets will appear here
          </p>
          <p className="max-w-[14rem] text-xs text-balance text-neutral-500">
            Add images and every copy is placed on the page as you change the options.
          </p>
        </div>
      </SheetFrame>
    </div>
  )
}
