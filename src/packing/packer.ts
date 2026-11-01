import { buildInstance } from './instance.ts'
import type { ResolvedOrientation } from '../lib/sheet.ts'
import { OptimizeSolver } from './optimize.ts'
import { betterObjective } from './score.ts'
import type { Solver } from './solver.ts'
import { StrictSolver } from './strict.ts'
import type { EngineInput, PackedLayout, PackOptions } from './types.ts'

function orientationsOf(input: EngineInput): ResolvedOrientation[] {
  if (input.orientation === 'auto') return ['portrait', 'landscape']
  return [input.orientation]
}

/**
 * Packs one input. It solves each allowed orientation, keeps the better result (ties go to the
 * first, which is portrait), and can be asked for improvements one step at a time.
 */
export class Packer {
  private readonly solvers: Solver[]
  private best: Solver
  private shown: PackedLayout

  constructor(input: EngineInput, options: PackOptions = {}) {
    this.solvers = orientationsOf(input).map((orientation) => {
      const inst = buildInstance(input, orientation)
      return input.ordering === 'strict'
        ? new StrictSolver(inst)
        : new OptimizeSolver(inst, options)
    })
    this.best = this.pickBest()
    this.shown = this.describe()
  }

  /** The best layout so far: always the last one returned by `step`, or the first one before any. */
  get layout(): PackedLayout {
    return this.shown
  }

  /** True when nothing more can improve the sheet count. */
  get finished() {
    return this.solvers.every((solver) => solver.finished || this.cannotBeat(solver))
  }

  /**
   * Does one unit of work. Returns the layout when it strictly improved, or when it has just been
   * proven optimal (the layout is then unchanged and only its status is new). Otherwise null.
   */
  step(): PackedLayout | null {
    const solver = this.solvers.find((s) => !s.finished && !this.cannotBeat(s))
    if (!solver) return null
    const before = this.best.objective
    const wasOptimal = this.isOptimal()
    solver.step()
    this.best = this.pickBest()
    const improved = betterObjective(this.best.objective, before)
    if (!improved && (wasOptimal || !this.isOptimal())) return null
    this.shown = this.describe()
    return this.shown
  }

  private describe(): PackedLayout {
    return { ...this.best.toPacked(), status: this.isOptimal() ? 'optimal' : 'best-found' }
  }

  private pickBest() {
    let best = this.solvers[0]
    for (const solver of this.solvers) {
      if (betterObjective(solver.objective, best.objective)) best = solver
    }
    return best
  }

  /** An orientation whose bound cannot undercut the best sheet count is not worth working on. */
  private cannotBeat(solver: Solver) {
    return (
      solver !== this.best &&
      solver.lowerBound >= this.best.objective.sheets &&
      solver.objective.unplaceable >= this.best.objective.unplaceable
    )
  }

  /** The sheet count is proven fewest: the best orientation meets its bound and no other can beat it. */
  private isOptimal() {
    const { best } = this
    return this.solvers.every((s) =>
      s === best
        ? s.objective.sheets <= s.lowerBound
        : s.objective.unplaceable > best.objective.unplaceable ||
          s.lowerBound >= best.objective.sheets,
    )
  }
}
