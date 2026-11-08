import { describe, expect, it } from 'vitest'
import type { LayoutResult } from '../lib/layout-types.ts'
import { Refinement, refinePacked } from './refine.ts'
import { toLayoutResult } from './result.ts'
import { fakeWorker } from './testing/fake-worker.ts'
import { inputOf } from './testing/fixtures.ts'
import { PHOTO_SETS } from './testing/generators.ts'
import { sameLayout, signature, strictlyBetter } from './testing/helpers.ts'
import { validateLayout } from './testing/validate.ts'
import { createWorkerRefiner } from './worker/client.ts'
import { createHost } from './worker/host.ts'
import type { WorkerRequest, WorkerResponse } from './worker/protocol.ts'

const hard = inputOf(
  PHOTO_SETS['mixed event set'].map((i) => ({ ...i, copies: i.copies * 4 })),
  { gap: 2, orientation: 'auto' },
)
/** Four copies of one photo that fit on one sheet: provably optimal at once. */
const easy = inputOf([{ width: 40, height: 30, copies: 4 }])

/** A layout reported while resuming is never worse than the best before it. */
const neverWorse = (next: LayoutResult, best: LayoutResult) =>
  next.sheets.length <= best.sheets.length &&
  (strictlyBetter(next, best) || next.status === 'optimal')

describe('Refinement', () => {
  it('reaches the same layout whether a stepped search runs at once or in two parts', async () => {
    const seen = { whole: [] as string[], split: [] as string[] }
    const whole = new Refinement(hard, { seed: 3 })
    await whole.run({ maxSteps: 600 }, (l) => seen.whole.push(signature(toLayoutResult(hard, l))))

    const split = new Refinement(hard, { seed: 3 })
    const record = (l: Parameters<typeof toLayoutResult>[1]) =>
      seen.split.push(signature(toLayoutResult(hard, l)))
    await split.run({ maxSteps: 250 }, record)
    await split.run({ maxSteps: 350 }, record)

    expect(seen.split).toEqual(seen.whole)
    expect(signature(toLayoutResult(hard, split.layout))).toBe(
      signature(toLayoutResult(hard, whole.layout)),
    )
  })

  it('reports why a run stopped', async () => {
    expect((await new Refinement(hard).run({ maxSteps: 20 }, () => {})).stopped).toBe('step-limit')
    expect((await new Refinement(hard).run({ budgetMs: 0 }, () => {})).stopped).toBe('time-limit')
    expect((await new Refinement(easy).run({ budgetMs: 5000 }, () => {})).stopped).toBe('finished')
    const controller = new AbortController()
    controller.abort()
    expect((await new Refinement(hard).run({ signal: controller.signal }, () => {})).stopped).toBe(
      'aborted',
    )
  })

  it('does nothing more once the search is finished, and says so again', async () => {
    const refinement = new Refinement(easy)
    await refinement.run({ budgetMs: 5000 }, () => {})
    const again = await refinement.run({ budgetMs: 5000 }, () => {})
    expect(again).toMatchObject({ steps: 0, stopped: 'finished' })
  })

  it('gives every run a full time budget of its own, measured from its own start', async () => {
    const refinement = new Refinement(hard)
    const first = await refinement.run({ budgetMs: 40 }, () => {})
    await new Promise((resolve) => setTimeout(resolve, 60))
    const second = await refinement.run({ budgetMs: 40 }, () => {})
    expect(first.stopped).toBe('time-limit')
    expect(second.stopped).toBe('time-limit')
    expect(second.steps).toBeGreaterThan(0)
  })

  it('keeps improving a search that stopped at its time limit, never worsening it, and stays valid', async () => {
    const refinement = new Refinement(hard, { seed: 5 })
    await refinement.run({ budgetMs: 30 }, () => {})
    let best = toLayoutResult(hard, refinement.layout)
    for (let round = 0; round < 3; round++) {
      const reported: LayoutResult[] = []
      await refinement.run({ budgetMs: 60 }, (l) => reported.push(toLayoutResult(hard, l)))
      for (const next of reported) {
        expect(neverWorse(next, best)).toBe(true)
        expect(validateLayout(hard, next)).toEqual([])
        best = next
      }
      expect(sameLayout(toLayoutResult(hard, refinement.layout), best)).toBe(true)
    }
  })

  it('still finds improvements in the part that comes after a stop, and ends better than it stopped', async () => {
    const refinement = new Refinement(hard, { seed: 3 })
    await refinement.run({ maxSteps: 5 }, () => {})
    const stopped = toLayoutResult(hard, refinement.layout)
    const found: LayoutResult[] = []
    await refinement.run({ maxSteps: 900 }, (l) => found.push(toLayoutResult(hard, l)))
    expect(found.length).toBeGreaterThan(0)
    expect(strictlyBetter(toLayoutResult(hard, refinement.layout), stopped)).toBe(true)
  })

  it('behaves as refinePacked always did', async () => {
    const events: string[] = []
    const summary = await refinePacked(
      hard,
      { maxSteps: 100 },
      () => events.push('improved'),
      () => events.push('first'),
    )
    expect(events[0]).toBe('first')
    expect(summary).toMatchObject({ stopped: 'step-limit', aborted: false })
  })
})

/** The host with its messages collected, and a way to wait for the end of one run. */
function hostWithLog() {
  const log: WorkerResponse[] = []
  const waiters = new Map<number, () => void>()
  const host = createHost({
    postMessage: (message) => {
      log.push(message)
      if (message.type === 'done' || message.type === 'failed') waiters.get(message.id)?.()
    },
  })
  const send = (request: WorkerRequest) =>
    new Promise<void>((resolve) => {
      waiters.set(request.id, resolve)
      host.handle(request)
    })
  const of = (id: number) => log.filter((m) => m.id === id)
  return { send, of }
}

describe('worker host: continue', () => {
  const engine = (input: typeof hard) => ({
    sheetSize: input.sheetSize,
    orientation: input.orientation,
    margin: input.margin,
    gap: input.gap,
    allowRotation: input.allowRotation,
    ordering: input.ordering,
    pieces: input.pieces.map(({ width, height }) => ({ width, height })),
  })
  const run = (id: number, input = hard, budgetMs = 40): WorkerRequest => ({
    type: 'run',
    id,
    input: engine(input),
    limits: { budgetMs },
  })

  it('continues the search a run left at its time limit, with improvements only', async () => {
    const { send, of } = hostWithLog()
    await send(run(1))
    const done = of(1).at(-1)
    expect(done).toMatchObject({ type: 'done', summary: { stopped: 'time-limit' } })

    await send({ type: 'continue', id: 2, from: 1, limits: { budgetMs: 60 } })
    const messages = of(2)
    expect(messages.at(-1)).toMatchObject({ type: 'done', summary: { stopped: 'time-limit' } })
    expect(messages.some((m) => m.type === 'first')).toBe(false)
  })

  it('can be continued again and again, each time from the run before', async () => {
    const { send, of } = hostWithLog()
    await send(run(1))
    await send({ type: 'continue', id: 2, from: 1, limits: { budgetMs: 40 } })
    await send({ type: 'continue', id: 3, from: 2, limits: { budgetMs: 40 } })
    expect(of(3).at(-1)).toMatchObject({ type: 'done' })
  })

  it('refuses to continue a run that is not the one paused', async () => {
    const { send, of } = hostWithLog()
    await send(run(1))
    await send({ type: 'continue', id: 2, from: 99, limits: {} })
    expect(of(2)).toEqual([{ type: 'failed', id: 2, message: 'There is no search to continue.' }])
  })

  it('forgets a paused search the moment any newer run starts', async () => {
    const { send, of } = hostWithLog()
    await send(run(1))
    await send(run(2, easy))
    await send({ type: 'continue', id: 3, from: 1, limits: {} })
    expect(of(3)[0]).toMatchObject({ type: 'failed' })
  })

  it('does not pause a search that finished, or one a step bound stopped', async () => {
    const { send, of } = hostWithLog()
    await send(run(1, easy, 5000))
    expect(of(1).at(-1)).toMatchObject({ summary: { stopped: 'finished' } })
    await send({ type: 'continue', id: 2, from: 1, limits: {} })
    expect(of(2)[0]).toMatchObject({ type: 'failed' })

    await send({ type: 'run', id: 3, input: engine(hard), limits: { maxSteps: 30 } })
    expect(of(3).at(-1)).toMatchObject({ summary: { stopped: 'step-limit' } })
    await send({ type: 'continue', id: 4, from: 3, limits: {} })
    expect(of(4)[0]).toMatchObject({ type: 'failed' })
  })

  it('can be used only once per pause: the run it started is the next one to continue', async () => {
    const { send, of } = hostWithLog()
    await send(run(1))
    await send({ type: 'continue', id: 2, from: 1, limits: { budgetMs: 30 } })
    await send({ type: 'continue', id: 3, from: 1, limits: {} })
    expect(of(3)[0]).toMatchObject({ type: 'failed' })
  })
})

describe('worker client: resume', () => {
  it('rejects when there is nothing to continue', async () => {
    const refiner = createWorkerRefiner(fakeWorker)
    await expect(refiner.resume()).rejects.toThrow('no search to continue')
    refiner.terminate()
  })

  it('continues the latest run after its time limit, never worsening what is on screen', async () => {
    const refiner = createWorkerRefiner(fakeWorker)
    const first = await refiner.refine(hard, { budgetMs: 40 })
    expect(first.stopped).toBe('time-limit')

    let best = first.layout!
    const reported: LayoutResult[] = []
    const second = await refiner.resume({ budgetMs: 80, onImprovement: (l) => reported.push(l) })
    for (const next of reported) {
      expect(neverWorse(next, best)).toBe(true)
      expect(validateLayout(hard, next)).toEqual([])
      best = next
    }
    expect(second.layout!.sheets.length).toBeLessThanOrEqual(first.layout!.sheets.length)
    expect(sameLayout(second.layout!, best)).toBe(true)
    refiner.terminate()
  })

  it('can be continued again and again, each time from the last run', async () => {
    const refiner = createWorkerRefiner(fakeWorker)
    await refiner.refine(hard, { budgetMs: 30 })
    const resumed = await refiner.resume({ budgetMs: 30 })
    expect(resumed.stopped).toBe('time-limit')
    await expect(refiner.resume({ budgetMs: 30 })).resolves.toMatchObject({ stopped: 'time-limit' })
    refiner.terminate()
  })

  it('cannot continue after a search finished or a step bound stopped it', async () => {
    const refiner = createWorkerRefiner(fakeWorker)
    await refiner.refine(easy, { budgetMs: 5000 })
    await expect(refiner.resume()).rejects.toThrow()
    await refiner.refine(hard, { maxSteps: 50 })
    await expect(refiner.resume()).rejects.toThrow()
    refiner.terminate()
  })

  it('cannot continue a run once a newer one has started, so stale layouts never come back', async () => {
    const refiner = createWorkerRefiner(fakeWorker)
    await refiner.refine(hard, { budgetMs: 30 })
    const newer = new AbortController()
    const running = refiner.refine(easy, { signal: newer.signal, budgetMs: 5000 })
    await expect(refiner.resume()).rejects.toThrow('no search to continue')
    await running
    refiner.terminate()
  })

  it('publishes nothing after it is aborted', async () => {
    const refiner = createWorkerRefiner(fakeWorker)
    await refiner.refine(hard, { budgetMs: 30 })
    const controller = new AbortController()
    const reported: LayoutResult[] = []
    const running = refiner.resume({
      budgetMs: 5000,
      signal: controller.signal,
      onImprovement: (l) => reported.push(l),
    })
    controller.abort()
    const summary = await running
    const countAtAbort = reported.length
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(summary.stopped).toBe('aborted')
    expect(reported.length).toBe(countAtAbort)
    refiner.terminate()
  })

  it('rejects after the worker is terminated', async () => {
    const refiner = createWorkerRefiner(fakeWorker)
    await refiner.refine(hard, { budgetMs: 30 })
    refiner.terminate()
    await expect(refiner.resume()).rejects.toThrow()
  })
})
