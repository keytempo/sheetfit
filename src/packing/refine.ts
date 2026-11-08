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

/**
 * Why a run ended. `time-limit` and `step-limit` mean the search was cut short and could go on;
 * `finished` means it has nothing left to try (the layout is proven optimal, or every
 * possibility has been tried); `aborted` means the caller cancelled it.
 */
export type StopReason = 'finished' | 'time-limit' | 'step-limit' | 'aborted'

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
  stopped: StopReason
}

/** The same function in the main thread and in the worker client. */
export type RefineFunction = (input: LayoutInput, options?: RefineOptions) => Promise<RefineSummary>

export interface PackedSummary {
  layout: PackedLayout
  steps: number
  elapsedMs: number
  aborted: boolean
  stopped: StopReason
}

/** What one run of a refinement may spend. The seed and the rest are fixed when it is created. */
export type RunLimits = Pick<RefineLimits, 'signal' | 'budgetMs' | 'maxSteps'>

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
 * One search, which can be run again and again. The first `run` starts from exactly the layout
 * `packLayout` returns; each later `run` carries on from the state the last one stopped in, with
 * the best layout found so far as its starting point, so a layout it reports is always strictly
 * better than the best before it. The search itself is a deterministic state machine: running
 * 50 steps and then 50 more reaches exactly the state 100 steps reach in one run.
 */
export class Refinement {
  private readonly packer: Packer
  /** Where the first run's clock starts: before the packer is built, so building it counts. */
  private clockStart: number | null

  constructor(input: EngineInput, options: PackOptions = {}) {
    this.clockStart = performance.now()
    this.packer = new Packer(input, options)
  }

  /** The best layout so far: the starting layout until something improves on it. */
  get layout(): PackedLayout {
    return this.packer.layout
  }

  /**
   * Searches until the budget is spent, the step bound is reached, the search has nothing left to
   * try, or the signal aborts. Every strict improvement is reported the moment it is found. The time
   * budget counts from the start of this run, so a second run gets a full budget of its own.
   */
  async run(
    { signal, budgetMs = REFINEMENT_BUDGET_MS, maxSteps }: RunLimits,
    onImprovement: (layout: PackedLayout) => void,
  ): Promise<PackedSummary> {
    const started = this.clockStart ?? performance.now()
    this.clockStart = null
    const { packer } = this
    const stepBound = maxSteps ?? Infinity

    let steps = 0
    let sliceStarted = started
    while (!signal?.aborted && !packer.finished && steps < stepBound) {
      if (maxSteps === undefined && performance.now() - started >= budgetMs) break
      const improved = packer.step()
      steps++
      if (improved && !signal?.aborted) onImprovement(improved)
      if (performance.now() - sliceStarted >= SLICE_MS) {
        await yieldToEventLoop()
        sliceStarted = performance.now()
      }
    }
    const aborted = signal?.aborted ?? false
    let stopped: StopReason = 'time-limit'
    if (aborted) stopped = 'aborted'
    else if (packer.finished) stopped = 'finished'
    else if (maxSteps !== undefined) stopped = 'step-limit'
    return {
      layout: packer.layout,
      steps,
      elapsedMs: performance.now() - started,
      aborted,
      stopped,
    }
  }
}

/**
 * The refinement loop on plain data, run once. It starts from exactly the layout `packLayout`
 * returns, reports that layout through `onFirst`, and then every strict improvement through
 * `onImprovement`.
 */
export async function refinePacked(
  input: EngineInput,
  limits: RefineLimits,
  onImprovement: (layout: PackedLayout) => void,
  onFirst?: (layout: PackedLayout) => void,
): Promise<PackedSummary> {
  const refinement = new Refinement(input, limits)
  if (!limits.signal?.aborted) onFirst?.(refinement.layout)
  return refinement.run(limits, onImprovement)
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
