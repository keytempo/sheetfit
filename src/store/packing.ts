import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
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
  /**
   * True when the search stopped because it used up the time limit, not because it was done: the
   * layout shown is the best found so far and `resume` can look for a better one.
   */
  limitReached: boolean
  /** Searches again from the best layout found, for another time limit. Does nothing unless `limitReached`. */
  resume: () => void
}

/** What the search for a set of inputs is doing. No phase for the current inputs means it has just begun. */
interface Phase {
  input: LayoutInput
  state: 'searching' | 'time-limit' | 'done'
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
 * The time limit as it is when a search starts. It is read then, not followed: changing it while a
 * search runs leaves that search alone and applies from the next one, and it never restarts a search.
 */
const timeLimitMs = () => useAppStore.getState().options.timeLimit * 1000

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
 *
 * A search runs for the time limit and then stops. If it stopped for that reason, and not because
 * the layout is proven optimal or nothing is left to try, `limitReached` is true and `resume`
 * continues from the best layout found, for another time limit, as often as asked. Any change to
 * the inputs cancels a search, resumed or not, and starts a fresh one with the limit as it is then.
 */
export function usePacking(): SheetLayoutState {
  const images = useAppStore((state) => state.images)
  const options = useAppStore(useShallow(selectLayoutOptions))
  const input = useMemo(() => buildLayoutInput(images, options), [images, options])

  // There are no images when the app starts, so this first packing is empty and instant.
  const [shown, setShown] = useState(() => ({ input, layout: packLayout(input) }))
  const [phase, setPhase] = useState<Phase | null>(null)
  const resuming = useRef<AbortController | null>(null)

  const showFor = (forInput: LayoutInput) => (layout: LayoutResult) =>
    startTransition(() => setShown({ input: forInput, layout }))

  useEffect(() => {
    const controller = new AbortController()
    let delivered = false
    const show = (layout: LayoutResult) => {
      delivered = true
      showFor(input)(layout)
    }
    getRefiner()
      .refine(input, {
        signal: controller.signal,
        budgetMs: timeLimitMs(),
        onFirst: show,
        onImprovement: show,
      })
      .then(
        ({ stopped }) => {
          // In the same transition as the layouts, so the status never says the search is over
          // while an older layout is still being painted.
          if (controller.signal.aborted) return
          startTransition(() =>
            setPhase({ input, state: stopped === 'time-limit' ? 'time-limit' : 'done' }),
          )
        },
        () => {
          if (controller.signal.aborted) return
          startTransition(() => {
            if (!delivered) setShown({ input, layout: packLayout(input) })
            setPhase({ input, state: 'done' })
          })
        },
      )
    return () => {
      controller.abort()
      resuming.current?.abort()
    }
  }, [input])

  const pending = shown.input !== input
  const current = phase?.input === input ? phase.state : 'searching'
  // Strict order has no refinement: the layout it starts with is final.
  const final = shown.layout.status === 'optimal' || input.ordering === 'strict'
  const limitReached = !pending && !final && current === 'time-limit'

  const resume = () => {
    if (!limitReached) return
    const controller = new AbortController()
    resuming.current = controller
    setPhase({ input, state: 'searching' })
    getRefiner()
      .resume({
        signal: controller.signal,
        budgetMs: timeLimitMs(),
        onImprovement: showFor(input),
      })
      .then(
        ({ stopped }) => {
          if (controller.signal.aborted) return
          startTransition(() =>
            setPhase({ input, state: stopped === 'time-limit' ? 'time-limit' : 'done' }),
          )
        },
        () => {
          if (!controller.signal.aborted) setPhase({ input, state: 'done' })
        },
      )
  }

  return {
    layout: shown.layout,
    pending,
    optimizing: !pending && !final && current === 'searching',
    limitReached,
    resume,
  }
}
