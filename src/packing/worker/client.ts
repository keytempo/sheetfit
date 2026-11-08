import type { LayoutInput, LayoutResult } from '../../lib/layout-types.ts'
import type { RefineFunction, RefineOptions, RefineSummary } from '../refine.ts'
import { toLayoutResult } from '../result.ts'
import type { WorkerRequest, WorkerResponse } from './protocol.ts'

/** The part of a Web Worker the client uses; a real `Worker` fits. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  terminate(): void
}

/** Created the way Vite expects, so the worker is bundled as its own chunk. */
const createPackingWorker = (): WorkerLike =>
  new Worker(new URL('./packing.worker.ts', import.meta.url), { type: 'module' })

interface Run {
  fail: (error: Error) => void
  first: (response: Extract<WorkerResponse, { type: 'first' }>) => void
  improved: (response: Extract<WorkerResponse, { type: 'improved' }>) => void
  finish: (response: Extract<WorkerResponse, { type: 'done' }>) => void
}

export interface ResumeOptions {
  /** Cancels the run. Nothing is published once it is aborted. */
  signal?: AbortSignal
  /** Wall-clock budget of this run in milliseconds. */
  budgetMs?: number
  maxSteps?: number
  /** Called with every layout that strictly improves on the best one so far. */
  onImprovement?: (layout: LayoutResult) => void
}

export interface WorkerRefiner {
  /** The same function as `refineLayout`, but the work happens in the worker. */
  refine: RefineFunction
  /**
   * Carries on with the latest run if it stopped at its time limit, from the best layout it had
   * found, as a run of its own. Rejects when there is nothing to continue: the latest run ended
   * some other way, or a newer run has started since.
   */
  resume: (options?: ResumeOptions) => Promise<RefineSummary>
  /** Stops the worker. A later `refine` starts a new one. */
  terminate: () => void
}

/**
 * Runs refinements in a Web Worker behind the same interface as `refineLayout`. One worker is
 * reused; a new run, or an abort, cancels the run before it, and anything a stale run still sends
 * is dropped by its id, so a stale run never publishes.
 */
export function createWorkerRefiner(
  createWorker: () => WorkerLike = createPackingWorker,
): WorkerRefiner {
  let worker: WorkerLike | null = null
  let nextId = 1
  const runs = new Map<number, Run>()
  /** The latest run, if it stopped at its time limit and so can be continued. */
  let resumable: { id: number; input: LayoutInput } | null = null

  const start = () => {
    if (worker) return worker
    const created = createWorker()
    created.addEventListener('message', (event) => {
      const response = event.data
      const run = runs.get(response.id)
      if (!run) return
      if (response.type === 'first') run.first(response)
      else if (response.type === 'improved') run.improved(response)
      else if (response.type === 'done') run.finish(response)
      else run.fail(new Error(response.message))
    })
    created.addEventListener('error', (event) => {
      resumable = null
      for (const run of [...runs.values()])
        run.fail(new Error(event.message || 'The packing worker crashed.'))
      created.terminate()
      if (worker === created) worker = null
    })
    worker = created
    return created
  }

  /** What `refine` and `resume` share: one run in the worker, reported through callbacks. */
  const launch = (
    input: LayoutInput,
    signal: AbortSignal | undefined,
    callbacks: Pick<RefineOptions, 'onFirst' | 'onImprovement'>,
    request: (id: number) => WorkerRequest,
  ) =>
    new Promise<RefineSummary>((resolve, reject) => {
      const startedAt = performance.now()
      const aborted = (layout: RefineSummary['layout']): RefineSummary => ({
        layout,
        steps: 0,
        elapsedMs: performance.now() - startedAt,
        aborted: true,
        stopped: 'aborted',
      })
      if (signal?.aborted) {
        resolve(aborted(null))
        return
      }

      const id = nextId++
      let latest: RefineSummary['layout'] = null
      const end = () => {
        runs.delete(id)
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        worker?.postMessage({ type: 'cancel', id })
        end()
        resolve(aborted(latest))
      }

      runs.set(id, {
        fail: (error) => {
          end()
          reject(error)
        },
        first: ({ layout }) => {
          latest = toLayoutResult(input, layout)
          callbacks.onFirst?.(latest)
        },
        improved: ({ layout }) => {
          latest = toLayoutResult(input, layout)
          callbacks.onImprovement?.(latest)
        },
        finish: ({ summary }) => {
          end()
          if (summary.stopped === 'time-limit') resumable = { id, input }
          resolve({ ...summary, layout: toLayoutResult(input, summary.layout) })
        },
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      start().postMessage(request(id))
    })

  const refine: RefineFunction = (input: LayoutInput, options = {}) => {
    const { onFirst, onImprovement, signal, ...limits } = options
    resumable = null
    return launch(input, signal, { onFirst, onImprovement }, (id) => ({
      type: 'run',
      id,
      input: {
        sheetSize: input.sheetSize,
        orientation: input.orientation,
        margin: input.margin,
        gap: input.gap,
        allowRotation: input.allowRotation,
        ordering: input.ordering,
        pieces: input.pieces.map(({ width, height }) => ({ width, height })),
      },
      limits,
    }))
  }

  const resume = (options: ResumeOptions = {}) => {
    const from = resumable
    resumable = null
    if (!from) return Promise.reject(new Error('There is no search to continue.'))
    const { signal, onImprovement, ...limits } = options
    return launch(from.input, signal, { onImprovement }, (id) => ({
      type: 'continue',
      id,
      from: from.id,
      limits,
    }))
  }

  return {
    refine,
    resume,
    terminate: () => {
      resumable = null
      worker?.terminate()
      worker = null
      for (const run of [...runs.values()])
        run.fail(new Error('The packing worker was terminated.'))
    },
  }
}
