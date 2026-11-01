import { assemble } from './assemble.ts'
import { lowerBound } from './bounds.ts'
import { MODE, expandItems, packItems } from './decode.ts'
import {
  construct,
  deepPortfolio,
  orderTypes,
  quickPortfolio,
  suitsStock,
  type Heuristic,
} from './construct.ts'
import { solveExact } from './exact.ts'
import type { Instance } from './instance.ts'
import { MaxRectsSheet, RULE } from './maxrects.ts'
import { DEEP_EFFORT, STOCK_EFFORT } from './patterns.ts'
import { Random } from './random.ts'
import { type Objective, type Score, improvesOn, noWorse, scoreSheets } from './score.ts'
import type { Solver } from './solver.ts'
import type { PackedLayout, PackOptions } from './types.ts'

/** Pieces up to this number are solved exactly when the heuristics have not met the lower bound. */
export const EXACT_PIECE_LIMIT = 9

/** The exact solver names pieces by bits of a 32-bit mask, so it can never take more than this. */
const EXACT_PIECE_CEILING = 20

/** The first steps go to the deep portfolio; after that it gets one step in this many. */
const DEEP_FIRST = 8
const DEEP_EVERY = 6
/** Of every this many search steps, one searches type orders and the rest ruin and recreate. */
const ORDER_SEARCH_EVERY = 4
/** Instances above this many pieces skip the contact-point rule, which is slow. */
const CONTACT_RULE_LIMIT = 600
/** After this many failed order-search steps the order search restarts from a shuffled order. */
const ORDER_RESTART_AFTER = 30

const SEARCH_RULES = [RULE.BSSF, RULE.BLSF, RULE.BAF, RULE.BL, RULE.CP]

interface Genome {
  order: number[]
  modes: number[]
  rule: number
}

/**
 * Solves one orientation in Optimize mode. Construction is a fixed portfolio. Each `step` after
 * that does one unit of work: a deep heuristic, the exact solver, a ruin-and-recreate move, or a
 * step of a search over type orders and rotation choices. The state depends only on the steps
 * taken, never on the clock, so equal input and equal step counts give equal layouts.
 */
export class OptimizeSolver implements Solver {
  readonly inst: Instance
  private readonly baseBound: number
  private readonly exactLimit: number
  private readonly rng: Random
  private sheets: MaxRectsSheet[]
  private score: Score
  private shown: Score
  private proven = 0
  private steps = 0
  private deepQueue: Heuristic[]
  private exactTried = false
  private genome: Genome
  private genomeScore: Score | null = null
  private failures = 0

  constructor(inst: Instance, options: PackOptions = {}) {
    this.inst = inst
    this.exactLimit = Math.min(options.exactLimit ?? EXACT_PIECE_LIMIT, EXACT_PIECE_CEILING)
    this.rng = new Random((options.seed ?? 0x5eed) + (inst.orientation === 'landscape' ? 7919 : 0))
    this.baseBound = lowerBound(inst)

    let best: MaxRectsSheet[] = []
    let bestScore = scoreSheets([], inst.usableArea)
    let first = true
    for (const heuristic of quickPortfolio(inst)) {
      if (!first && bestScore.sheets <= this.baseBound) break
      const sheets = construct(inst, heuristic)
      const score = scoreSheets(sheets, inst.usableArea)
      if (first || improvesOn(score, bestScore)) {
        best = sheets
        bestScore = score
        first = false
      }
    }
    this.sheets = best
    this.score = bestScore
    this.shown = bestScore

    const planned: Heuristic[] = suitsStock(inst)
      ? [
          { algorithm: 'pattern', rule: RULE.BSSF, order: 'area', effort: STOCK_EFFORT },
          { algorithm: 'pattern', rule: RULE.BAF, order: 'long', effort: STOCK_EFFORT },
        ]
      : []
    this.deepQueue = [
      ...planned,
      { algorithm: 'pattern', rule: RULE.BAF, order: 'long', effort: DEEP_EFFORT },
      { algorithm: 'pattern', rule: RULE.BSSF, order: 'area', effort: DEEP_EFFORT },
      ...deepPortfolio(inst),
    ]
    this.genome = {
      order: orderTypes(inst, 'area'),
      modes: inst.types.map(() => MODE.FREE),
      rule: RULE.BSSF,
    }
  }

  get lowerBound() {
    return Math.max(this.baseBound, this.proven)
  }

  get objective(): Objective {
    return {
      unplaceable: this.inst.unplaceable.length,
      sheets: this.score.sheets,
      minUsed: this.score.minUsed,
    }
  }

  get finished() {
    return this.score.sheets <= this.lowerBound
  }

  step(): boolean {
    if (this.finished) return false
    this.steps++
    const deepTurn =
      this.deepQueue.length > 0 && (this.steps <= DEEP_FIRST || this.steps % DEEP_EVERY === 0)
    if (deepTurn) this.runDeep()
    else if (!this.exactTried && this.exactApplies()) this.runExact()
    else if (this.inst.types.length > 1 && this.steps % ORDER_SEARCH_EVERY === 0) this.searchOrder()
    else this.ruinAndRecreate()

    const improved = improvesOn(this.score, this.shown)
    if (improved) this.shown = this.score
    return improved
  }

  toPacked(): PackedLayout {
    const status = this.score.sheets <= this.lowerBound ? 'optimal' : 'best-found'
    return assemble(this.inst, this.sheets, status, this.lowerBound)
  }

  private adopt(sheets: MaxRectsSheet[], score: Score) {
    if (noWorse(score, this.score)) {
      this.sheets = sheets
      this.score = score
    }
  }

  private runDeep() {
    const heuristic = this.deepQueue.shift()
    if (!heuristic) return
    const sheets = construct(this.inst, heuristic)
    this.adopt(sheets, scoreSheets(sheets, this.inst.usableArea))
  }

  private exactApplies() {
    return this.inst.placeableCount <= this.exactLimit && this.inst.placeableCount > 0
  }

  private runExact() {
    this.exactTried = true
    const outcome = solveExact(this.inst, this.baseBound, this.score.sheets)
    if (outcome.plans) {
      const sheets = outcome.plans.map((p) =>
        MaxRectsSheet.fromPlaced(this.inst.binW, this.inst.binH, p.placed, p.used),
      )
      this.adopt(sheets, scoreSheets(sheets, this.inst.usableArea))
      if (outcome.optimal) this.proven = sheets.length
    } else if (outcome.optimal) {
      this.proven = this.score.sheets
    }
  }

  /** Empties the emptiest sheet and a few others, then places their pieces again anywhere. */
  private ruinAndRecreate() {
    const { inst, rng } = this
    const count = this.sheets.length
    if (count < 2) return

    const byFill = this.sheets
      .map((_, i) => i)
      .sort((a, b) => this.sheets[a].used - this.sheets[b].used)
    const extra = 1 + rng.int(Math.min(3, count - 1))
    let ruined: number[]
    switch (rng.int(3)) {
      case 0:
        ruined = byFill.slice(0, extra + 1)
        break
      case 1:
        ruined = [byFill[0], ...rng.shuffle(byFill.slice(1)).slice(0, extra)]
        break
      default:
        ruined = rng.shuffle(byFill.slice()).slice(0, extra + 1)
    }

    const kept = this.sheets.filter((_, i) => !ruined.includes(i))
    const removed: number[] = []
    for (const i of ruined) {
      const { placed } = this.sheets[i]
      for (let k = 0; k < placed.length; k += 6) removed.push(placed[k])
    }

    const items = this.recreationOrder(removed)
    const candidate = kept.slice()
    const owned = kept.length
    const copied = new Set<number>()
    packItems(
      inst,
      candidate,
      () => new MaxRectsSheet(inst.binW, inst.binH),
      items,
      this.randomModes(items),
      this.pickRule(),
      (i) => {
        if (i >= owned || copied.has(i)) return candidate[i]
        copied.add(i)
        candidate[i] = candidate[i].clone()
        return candidate[i]
      },
    )
    this.adopt(candidate, scoreSheets(candidate, inst.usableArea))
  }

  /** Mostly largest first with noise, sometimes one type at a time, sometimes fully shuffled. */
  private recreationOrder(types: number[]): number[] {
    const { inst, rng } = this
    const roll = rng.next()
    if (roll < 0.15) return rng.shuffle(types.slice())
    const noise = roll < 0.6 ? 0.2 : 0.5
    const weight = inst.types.map((t) => t.w * t.h * (1 - noise + 2 * noise * rng.next()))
    const sorted = types.slice().sort((a, b) => weight[b] - weight[a] || a - b)
    return sorted
  }

  /** Occasionally pins every piece of a type to one orientation, which finds grid-like blocks. */
  private randomModes(items: readonly number[]): number[] | null {
    if (!this.inst.rotate || !this.rng.chance(0.25)) return null
    const perType = this.inst.types.map(() => this.rng.int(3))
    return items.map((type) => perType[type])
  }

  private pickRule() {
    const rules =
      this.inst.placeableCount > CONTACT_RULE_LIMIT ? SEARCH_RULES.slice(0, -1) : SEARCH_RULES
    return rules[this.rng.int(rules.length)]
  }

  /** Mutates the type order, orientation pins or rule, and keeps the change if it is no worse. */
  private searchOrder() {
    const { inst, rng } = this
    const types = inst.types.length
    if (this.genomeScore === null) this.genomeScore = this.decode(this.genome).score

    let next: Genome
    if (this.failures >= ORDER_RESTART_AFTER) {
      next = {
        order: rng.shuffle(this.genome.order.slice()),
        modes: this.genome.modes.slice(),
        rule: this.pickRule(),
      }
      this.failures = 0
    } else {
      next = {
        order: this.genome.order.slice(),
        modes: this.genome.modes.slice(),
        rule: this.genome.rule,
      }
      switch (rng.int(4)) {
        case 0: {
          const a = rng.int(types)
          const b = rng.int(types)
          ;[next.order[a], next.order[b]] = [next.order[b], next.order[a]]
          break
        }
        case 1: {
          const [moved] = next.order.splice(rng.int(types), 1)
          next.order.splice(rng.int(types), 0, moved)
          break
        }
        case 2:
          next.modes[rng.int(types)] = inst.rotate ? rng.int(3) : MODE.FREE
          break
        default:
          next.rule = this.pickRule()
      }
    }

    const { sheets, score } = this.decode(next)
    if (noWorse(score, this.genomeScore)) {
      if (improvesOn(score, this.genomeScore)) this.failures = 0
      else this.failures++
      this.genome = next
      this.genomeScore = score
      this.adopt(sheets, score)
    } else {
      this.failures++
    }
  }

  private decode(genome: Genome) {
    const { inst } = this
    const items = expandItems(inst, genome.order)
    const modes = items.map((type) => genome.modes[type])
    const sheets: MaxRectsSheet[] = []
    packItems(
      inst,
      sheets,
      () => new MaxRectsSheet(inst.binW, inst.binH),
      items,
      modes,
      genome.rule,
    )
    return { sheets, score: scoreSheets(sheets, inst.usableArea) }
  }
}
