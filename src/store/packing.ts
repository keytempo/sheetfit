import { startTransition, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { LayoutInput, LayoutResult } from '@/lib/layout-types'
import { buildLayoutInput } from '@/lib/layout-input'
import type { LayoutOptions } from '@/lib/print-options'
import { packLayout } from '@/packing'
import { createWorkerRefiner, type WorkerRefiner } from '@/packing/worker/client'
import { useAppStore } from './index'
import type { AppState } from './types'

export interface SheetLayoutState {
  /** The layout on screen. */
  layout: LayoutResult
  /**
   * True from the moment the images or options change until the layout for them arrives. The
   * layout shown is then still the one for the inputs before, so nothing may be exported from it.
   */
  pending: boolean
  /** True while the packer is still looking for a better layout than the one shown. */
  optimizing: boolean
}

/** Only these options can change a layout. Unit, cut guides and the preview switches cannot. */
const selectLayoutOptions = ({ options }: AppState): LayoutOptions => ({
  sheetSize: options.sheetSize,
  customWidth: options.customWidth,
  customHeight: options.customHeight,
  orientation: options.orientation,
  baseMode: options.baseMode,
  baseLength: options.baseLength,
  baseDpi: options.baseDpi,
  margin: options.margin,
  gap: options.gap,
  allowRotation: options.allowRotation,
  ordering: options.ordering,
})

let refiner: WorkerRefiner | undefined
const getRefiner = () => (refiner ??= createWorkerRefiner())

/**
 * Packs the current images with the current options, all in a worker, so the page never waits for
 * the packer. The worker reports a first layout almost at once and then every better one it finds;
 * each replaces the one on screen as it arrives, and the run for earlier inputs is cancelled the
 * moment the inputs change, so a layout for earlier inputs is never delivered late.
 *
 * Until the layout for the new inputs arrives the previous one stays on screen, and `pending` says
 * so. If the worker cannot run, the layout is packed on the page instead.
 *
 * The packer input is rebuilt only when an image or a layout option changes. Hover, selection, the
 * unit and the preview switches leave it untouched, so they never restart the search.
 */
export function usePacking(): SheetLayoutState {
  const images = useAppStore((state) => state.images)
  const options = useAppStore(useShallow(selectLayoutOptions))
  const input = useMemo(() => buildLayoutInput(images, options), [images, options])

  // There are no images when the app starts, so this first packing is empty and instant.
  const [shown, setShown] = useState(() => ({ input, layout: packLayout(input) }))
  const [settled, setSettled] = useState<LayoutInput | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let delivered = false
    const show = (layout: LayoutResult) => {
      delivered = true
      startTransition(() => setShown({ input, layout }))
    }
    getRefiner()
      .refine(input, { signal: controller.signal, onFirst: show, onImprovement: show })
      .then(
        () => {
          if (!controller.signal.aborted) setSettled(input)
        },
        () => {
          if (controller.signal.aborted) return
          if (!delivered) setShown({ input, layout: packLayout(input) })
          setSettled(input)
        },
      )
    return () => controller.abort()
  }, [input])

  const pending = shown.input !== input
  // Strict order has no refinement: the layout it starts with is final.
  const final = shown.layout.status === 'optimal' || input.ordering === 'strict'
  return { layout: shown.layout, pending, optimizing: !pending && !final && settled !== input }
}
