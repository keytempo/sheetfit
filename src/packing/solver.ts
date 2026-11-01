import type { Instance } from './instance.ts'
import type { Objective } from './score.ts'
import type { PackedLayout } from './types.ts'

/** Solves one sheet orientation. A solver is deterministic: its state depends only on its steps. */
export interface Solver {
  readonly inst: Instance
  /** The proven fewest sheets this orientation can need, as far as is known. */
  readonly lowerBound: number
  readonly objective: Objective
  /** True when no step can improve the sheet count any more. */
  readonly finished: boolean
  /** Does one unit of improvement work; true when the objective strictly improved. */
  step(): boolean
  toPacked(): PackedLayout
}
