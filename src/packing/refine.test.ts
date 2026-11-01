import { describe, expect, it } from 'vitest'
import type { LayoutResult } from '../lib/layout-types.ts'
import { packLayout } from './pack.ts'
import { refineLayout, REFINEMENT_BUDGET_MS } from './refine.ts'
import { inputOf } from './testing/fixtures.ts'
import { PHOTO_SETS } from './testing/generators.ts'
import { sameLayout, signature } from './testing/helpers.ts'
import { validateLayout } from './testing/validate.ts'

const hard = inputOf(
  PHOTO_SETS['mixed event set'].map((i) => ({ ...i, copies: i.copies * 4 })),
  {
    gap: 2,
    orientation: 'auto',
  },
)

/** Strict order never refines: the layout it starts with is final. */
const strictInput = inputOf([{ width: 40, height: 30, copies: 6 }], { ordering: 'strict' })

describe('refineLayout', () => {
  it('reports every improvement and ends with the last one', async () => {
    const reported: string[] = []
    const run = await refineLayout(hard, {
      maxSteps: 1500,
      onImprovement: (layout) => reported.push(signature(layout)),
    })
    expect(reported.length).toBeGreaterThan(0)
    expect(new Set(reported).size).toBe(reported.length)
    expect(signature(run.layout!) === reported.at(-1), 'the result is the last update').toBe(true)
    expect(run.aborted).toBe(false)
  })

  it('reports the starting layout once, first, and it is the synchronous result', async () => {
    const events: string[] = []
    const first: LayoutResult[] = []
    await refineLayout(hard, {
      maxSteps: 300,
      onFirst: (layout) => {
        events.push('first')
        first.push(layout)
      },
      onImprovement: () => events.push('improved'),
    })
    expect(events.filter((e) => e === 'first')).toHaveLength(1)
    expect(events[0]).toBe('first')
    expect(sameLayout(first[0], packLayout(hard))).toBe(true)
  })

  it('reports the starting layout even when nothing can be improved, and never when already aborted', async () => {
    let reported = 0
    await refineLayout(strictInput, { onFirst: () => (reported += 1) })
    expect(reported).toBe(1)

    const controller = new AbortController()
    controller.abort()
    await refineLayout(hard, { signal: controller.signal, onFirst: () => (reported += 1) })
    expect(reported).toBe(1)
  })

  it('starts from exactly the layout the synchronous packer returns', async () => {
    const run = await refineLayout(hard, { maxSteps: 0 })
    expect(sameLayout(run.layout!, packLayout(hard))).toBe(true)
    expect(run.steps).toBe(0)
  })

  it('gives the same result for the same input and step budget, on any run', async () => {
    const first = await refineLayout(hard, { maxSteps: 400, seed: 7 })
    const second = await refineLayout(hard, { maxSteps: 400, seed: 7 })
    expect(sameLayout(first.layout!, second.layout!)).toBe(true)
  })

  it('uses the seed: different seeds explore differently', async () => {
    const results = new Set<string>()
    for (const seed of [1, 2, 3, 4]) {
      const run = await refineLayout(hard, { maxSteps: 600, seed })
      expect(validateLayout(hard, run.layout!)).toEqual([])
      results.add(signature(run.layout!))
    }
    expect(results.size).toBeGreaterThan(1)
  })

  it('respects the time budget', async () => {
    const started = performance.now()
    const run = await refineLayout(hard, { budgetMs: 200 })
    const elapsed = performance.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(150)
    // The budget is checked between steps; the longest step is under 100 ms.
    expect(elapsed).toBeLessThan(700)
    expect(run.elapsedMs).toBeLessThan(700)
  })

  it('has one named budget constant', () => {
    expect(REFINEMENT_BUDGET_MS).toBeGreaterThan(0)
  })

  it('stops as soon as the layout is proven optimal', async () => {
    const input = inputOf(
      [
        { width: 60, height: 90, copies: 3 },
        { width: 100, height: 70, copies: 2 },
        { width: 40, height: 40, copies: 4 },
      ],
      { sheetSize: { width: 150, height: 200 }, margin: 5 },
    )
    const started = performance.now()
    const run = await refineLayout(input, { budgetMs: 10_000 })
    expect(performance.now() - started).toBeLessThan(2000)
    expect(run.layout!.status).toBe('optimal')
  })

  it('publishes the proof even when the geometry does not change', async () => {
    // A layout the quick pass already finds, which only the exact solver can prove.
    const input = inputOf(
      [
        { width: 100, height: 150, copies: 1 },
        { width: 90, height: 140, copies: 1 },
        { width: 80, height: 130, copies: 1 },
      ],
      { sheetSize: { width: 150, height: 200 }, margin: 0 },
    )
    const sync = packLayout(input)
    const updates: string[] = []
    const run = await refineLayout(input, {
      maxSteps: 50,
      onImprovement: (l) => updates.push(l.status ?? ''),
    })
    expect(run.layout!.status).toBe('optimal')
    if (sync.status !== 'optimal') expect(updates).toContain('optimal')
  })
})

describe('cancellation', () => {
  it('stops at once and publishes nothing afterwards', async () => {
    const controller = new AbortController()
    let after = 0
    let aborted = false
    const promise = refineLayout(hard, {
      budgetMs: 10_000,
      signal: controller.signal,
      onImprovement: () => {
        if (aborted) after++
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    controller.abort()
    aborted = true
    const started = performance.now()
    const run = await promise
    expect(performance.now() - started).toBeLessThan(400)
    expect(run.aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(after).toBe(0)
  })

  it('does nothing when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const run = await refineLayout(hard, {
      signal: controller.signal,
      onImprovement: () => calls++,
    })
    expect(run.aborted).toBe(true)
    expect(run.steps).toBe(0)
    expect(calls).toBe(0)
  })

  it('lets the event loop run while refining, so a cancel can be heard', async () => {
    let ticks = 0
    const timer = setInterval(() => ticks++, 5)
    await refineLayout(hard, { budgetMs: 300 })
    clearInterval(timer)
    expect(ticks).toBeGreaterThan(10)
  })
})
