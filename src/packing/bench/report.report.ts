import { describe, it } from 'vitest'
import type { LayoutInput } from '../../lib/layout-types.ts'
import { RULE } from '../maxrects.ts'
import { SKYLINE_RULE } from '../skyline.ts'
import { construct, type Heuristic } from '../construct.ts'
import { buildInstance } from '../instance.ts'
import { packLayout } from '../pack.ts'
import { QUICK_EFFORT, QUICK_STOCK_EFFORT } from '../patterns.ts'
import { refineLayout, REFINEMENT_BUDGET_MS } from '../refine.ts'
import { validateLayout } from '../testing/validate.ts'
import { chunk1Shelf, sortedShelf } from './baselines.ts'
import { suite, type Case } from './suite.ts'

/*
 * The evidence report: `npm run bench:report`. It prints Markdown tables. Every layout it reports
 * is checked by the independent validator first, so a number is never printed for an invalid one.
 */

const SIZES = [100, 500, 2000]
const fixed = (x: number, digits = 1) => x.toFixed(digits)

interface Row {
  family: string
  pieces: number
  sheets: number
  bound: number
  fill: number
  fillExceptLast: number
  firstMs: number
  finalMs: number
  lastImprovementMs: number
  status: string
  syncSheets: number
  chunk1: number
  sorted: number
}

async function measure({ family, input }: Case): Promise<Row> {
  let started = performance.now()
  const first = packLayout(input)
  const firstMs = performance.now() - started
  if (validateLayout(input, first).length > 0) throw new Error(`${family}: invalid first layout`)

  started = performance.now()
  let lastImprovementMs = 0
  const run = await refineLayout(input, {
    onImprovement: () => (lastImprovementMs = performance.now() - started),
  })
  const layout = run.layout!
  const errors = validateLayout(input, layout)
  if (errors.length > 0) throw new Error(`${family}: invalid final layout: ${errors[0]}`)
  return {
    family,
    pieces: input.pieces.length,
    sheets: layout.sheets.length,
    bound: layout.lowerBound ?? 0,
    fill: layout.totals?.fillPercent ?? 0,
    fillExceptLast: layout.totals?.fillPercentExceptLast ?? 0,
    firstMs,
    finalMs: run.elapsedMs,
    lastImprovementMs,
    status: layout.status ?? '',
    syncSheets: first.sheets.length,
    chunk1: chunk1Shelf(input).sheets,
    sorted: sortedShelf(input).sheets,
  }
}

function printTable(rows: readonly Row[]) {
  const lines = [
    '| family | pieces | sheets | lower bound | gap | fill % | fill % (all but last) | first result ms | final ms (last improvement) | status | sorted shelf | Chunk 1 shelf |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|',
  ]
  for (const r of rows) {
    const gap = r.sheets - r.bound
    lines.push(
      `| ${r.family} | ${r.pieces} | ${r.sheets} | ${r.bound} | ${gap} (${fixed((gap / Math.max(1, r.bound)) * 100)} %) | ${fixed(r.fill)} | ${fixed(r.fillExceptLast)} | ${fixed(r.firstMs, 0)} | ${fixed(r.finalMs, 0)} (${fixed(r.lastImprovementMs, 0)}) | ${r.status} | ${r.sorted} | ${r.chunk1} |`,
    )
  }
  console.log(lines.join('\n'))
}

/** The five generic heuristics, fixed here so the comparison does not move when the engine is tuned. */
const GENERIC: readonly Heuristic[] = [
  { algorithm: 'maxrects', rule: RULE.BSSF, order: 'area' },
  { algorithm: 'maxrects', rule: RULE.BAF, order: 'long' },
  { algorithm: 'maxrects', rule: RULE.BL, order: 'height' },
  { algorithm: 'guillotine', rule: RULE.BAF, order: 'area' },
  { algorithm: 'skyline', rule: SKYLINE_RULE.MIN_WASTE, order: 'height' },
]

/** How many sheets each ingredient reaches alone, on one instance. */
function ablation(name: string, input: LayoutInput) {
  const inst = buildInstance(input, 'portrait')
  const sheetsOf = (heuristic: Heuristic) => construct(inst, heuristic).length
  const pattern = (effort: typeof QUICK_EFFORT): Heuristic => ({
    algorithm: 'pattern',
    rule: RULE.BSSF,
    order: 'area',
    effort,
  })
  const generic = GENERIC.map(sheetsOf)
  const quick = packLayout(input).sheets.length
  return `| ${name} | ${generic[0]} | ${Math.min(...generic)} | ${sheetsOf(pattern(QUICK_EFFORT))} | ${sheetsOf(pattern(QUICK_STOCK_EFFORT))} | ${quick} |`
}

const TIMEOUT = { timeout: 20 * 60 * 1000 }

describe('report', () => {
  it('environment', TIMEOUT, () => {
    const environment = `${navigator.userAgent}, ${navigator.hardwareConcurrency} logical core(s)`
    console.log(`\n## Environment\n${environment}\nRefinement budget: ${REFINEMENT_BUDGET_MS} ms\n`)
    // Cold: the very first call in a fresh process, before any code has been optimised.
    const cold = suite(500).find((c) => c.family === 'photos: mixed event set')!
    const started = performance.now()
    packLayout(cold.input)
    console.log(
      `Cold first result, 500-piece mixed photo set: ${fixed(performance.now() - started, 0)} ms\n`,
    )
  })

  for (const size of SIZES) {
    it(`about ${size} pieces`, TIMEOUT, async () => {
      const rows: Row[] = []
      for (const testCase of suite(size)) rows.push(await measure(testCase))
      console.log(`\n## About ${size} pieces\n`)
      printTable(rows)
    })
  }

  it('ingredients', TIMEOUT, () => {
    console.log('\n## What each ingredient reaches alone (sheets, portrait)\n')
    console.log(
      '| instance | MaxRects BSSF | best of 5 generic heuristics | greedy patterns | cutting-stock plan (quick) | packLayout (quick portfolio) |',
    )
    console.log('|---|--:|--:|--:|--:|--:|')
    for (const size of [500, 2000]) {
      for (const family of [
        'photos: mixed event set',
        'photos: mixed event set, 2 mm gap, auto',
        'photos: ID photos 35x45',
      ]) {
        const c = suite(size).find((x) => x.family === family)!
        console.log(ablation(`${family}, ${c.input.pieces.length}`, c.input))
      }
    }
  })
})
