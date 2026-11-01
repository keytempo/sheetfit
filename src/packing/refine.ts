import type { LayoutInput, LayoutResult } from '../lib/layout-types.ts'
import { Packer } from './packer.ts'
import { toLayoutResult } from './result.ts'
import type { EngineInput, PackedLayout, PackOptions } from './types.ts'

/** How long a refinement may run before it settles for the best layout found. */
export const REFINEMENT_BUDGET_MS = 3000

/** How much work is done between two yields to the event loop. */
const SLICE_MS = 8

export interface RefineLimits extends PackOptions {
  /** Cancels the run. Nothing is published once it is aborted. */
  signal?: AbortSignal
  /** Wall-clock budget in milliseconds. */
  budgetMs?: number
  /**
   * A budget in improvement steps instead of time. Use it where results must be reproducible:
   * the same input, seed and step count always give the same layout, on any machine.
   */
  maxSteps?: number
}

export interface RefineOptions extends RefineLimits {
  /**
   * Called once, before anything else, with the layout `packLayout` returns for the input. It is
   * the layout every improvement is measured against, and it is never reported twice.
   */
  onFirst?: (layout: LayoutResult) => void
  /** Called with every layout that strictly improves on the one before, as it is found. */
  onImprovement?: (layout: LayoutResult) => void
}

export interface RefineSummary {
  /**
   * The best layout of the run: the last improvement, or the synchronous result when nothing
   * improved on it. Null only when the run was aborted before it reported anything.
   */
  layout: LayoutResult | null
  steps: number
  elapsedMs: number
  /** True when the run was cancelled. */
  aborted: boolean
}

/** The same function in the main thread and in the worker client. */
export type RefineFunction = (input: LayoutInput, options?: RefineOptions) => Promise<RefineSummary>

export interface PackedSummary {
  layout: PackedLayout
  steps: number
  elapsedMs: number
  aborted: boolean
}

/** Lets pending messages (a cancel, for one) run, without the 4 ms floor nested timers have. */
function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/**
 * The refinement loop on plain data. It starts from exactly the layout `packLayout` returns,
 * reports that layout through `onFirst`, and then every strict improvement through `onImprovement`.
 */
export async function refinePacked(
  input: EngineInput,
  limits: RefineLimits,
  onImprovement: (layout: PackedLayout) => void,
  onFirst?: (layout: PackedLayout) => void,
): Promise<PackedSummary> {
  const started = performance.now()
  const packer = new Packer(input, limits)
  const budgetMs = limits.budgetMs ?? REFINEMENT_BUDGET_MS
  const maxSteps = limits.maxSteps ?? Infinity
  const { signal } = limits
  if (!signal?.aborted) onFirst?.(packer.layout)

  let steps = 0
  let sliceStarted = started
  while (!signal?.aborted && !packer.finished && steps < maxSteps) {
    if (limits.maxSteps === undefined && performance.now() - started >= budgetMs) break
    const improved = packer.step()
    steps++
    if (improved && !signal?.aborted) onImprovement(improved)
    if (performance.now() - sliceStarted >= SLICE_MS) {
      await yieldToEventLoop()
      sliceStarted = performance.now()
    }
  }
  return {
    layout: packer.layout,
    steps,
    elapsedMs: performance.now() - started,
    aborted: signal?.aborted ?? false,
  }
}

/**
 * Improves on `packLayout` in the background. The starting layout is reported through `onFirst` and
 * every strict improvement through `onImprovement` the moment it is found; the promise resolves
 * when the budget is spent, the
 * layout is proven optimal, or the run is aborted. It yields to the event loop often, so it can
 * run on the main thread in tests, but the app should use the worker client.
 */
export const refineLayout: RefineFunction = async (input, options = {}) => {
  const { onFirst, onImprovement, ...limits } = options
  let reported = false
  const summary = await refinePacked(
    input,
    limits,
    (packed) => {
      reported = true
      onImprovement?.(toLayoutResult(input, packed))
    },
    (packed) => {
      reported = true
      onFirst?.(toLayoutResult(input, packed))
    },
  )
  const layout = summary.aborted && !reported ? null : toLayoutResult(input, summary.layout)
  return { ...summary, layout }
}
