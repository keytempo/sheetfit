import type { EngineInput, PackedLayout } from '../types.ts'
import type { PackedSummary, RefineLimits, RunLimits } from '../refine.ts'

/** What the worker is asked to do. A run is named by an id chosen by the caller. */
export type WorkerRequest =
  | { type: 'run'; id: number; input: EngineInput; limits: Omit<RefineLimits, 'signal'> }
  /**
   * Carries on with the search that run `from` left paused at its time limit, as a run of its own
   * named `id`. Answered with `failed` when run `from` is not the one that is paused.
   */
  | { type: 'continue'; id: number; from: number; limits: Omit<RunLimits, 'signal'> }
  | { type: 'cancel'; id: number }

/** What the worker reports. Every message carries the id of the run it belongs to. */
export type WorkerResponse =
  | { type: 'first'; id: number; layout: PackedLayout }
  | { type: 'improved'; id: number; layout: PackedLayout }
  | { type: 'done'; id: number; summary: PackedSummary }
  | { type: 'failed'; id: number; message: string }
