import { describe, expect, it } from 'vitest'
import type { LayoutResult } from '../../lib/layout-types.ts'
import { packLayout } from '../pack.ts'
import { refineLayout } from '../refine.ts'
import { inputOf } from '../testing/fixtures.ts'
import { PHOTO_SETS } from '../testing/generators.ts'
import { sameLayout } from '../testing/helpers.ts'
import { validateLayout } from '../testing/validate.ts'
import { createWorkerRefiner, type WorkerLike } from './client.ts'
import { createHost } from './host.ts'
import type { WorkerRequest, WorkerResponse } from './protocol.ts'

const hard = inputOf(
  PHOTO_SETS['mixed event set'].map((i) => ({ ...i, copies: i.copies * 4 })),
  { gap: 2, orientation: 'auto' },
)

/**
 * A stand-in for a Web Worker: the real host behind a pair of message ports, so every message is
 * structured-cloned exactly as it would be across a worker boundary.
 */
function fakeWorker() {
  const { port1, port2 } = new MessageChannel()
  const host = createHost({ postMessage: (message) => port2.postMessage(message) })
  port2.onmessage = (event: MessageEvent<WorkerRequest>) => host.handle(event.data)
  const worker: WorkerLike & { terminated: boolean; crash(): void } = {
    terminated: false,
    postMessage: (message) => port1.postMessage(message),
    addEventListener: (type: string, listener: unknown) => {
      if (type === 'message') {
        port1.addEventListener('message', listener as (event: MessageEvent<WorkerResponse>) => void)
        port1.start()
      } else {
        errorListeners.push(listener as (event: ErrorEvent) => void)
      }
    },
    terminate() {
      worker.terminated = true
      port1.close()
      port2.close()
    },
    crash() {
      for (const listener of errorListeners) listener({ message: 'boom' } as ErrorEvent)
    },
  }
  const errorListeners: ((event: ErrorEvent) => void)[] = []
  return worker
}

describe('worker client', () => {
  it('gives the same results across the boundary as in the same thread', async () => {
    const { refine, terminate } = createWorkerRefiner(fakeWorker)
    const reported: number[] = []
    const remote = await refine(hard, {
      maxSteps: 600,
      seed: 3,
      onImprovement: (layout) => reported.push(layout.sheets.length),
    })
    terminate()
    const local = await refineLayout(hard, { maxSteps: 600, seed: 3 })
    expect(sameLayout(remote.layout!, local.layout!)).toBe(true)
    expect(reported.length).toBeGreaterThan(0)
    expect(validateLayout(hard, remote.layout!)).toEqual([])
    expect(remote.steps).toBe(local.steps)
  })

  it('delivers the starting layout across the boundary, equal to the synchronous result', async () => {
    const worker = fakeWorker()
    const refiner = createWorkerRefiner(() => worker)
    const first: LayoutResult[] = []
    await refiner.refine(hard, { maxSteps: 50, onFirst: (layout) => first.push(layout) })
    expect(first).toHaveLength(1)
    expect(sameLayout(first[0], packLayout(hard))).toBe(true)
    expect(validateLayout(hard, first[0])).toEqual([])
    // The caller's own piece objects, so the preview's identities never change.
    expect(first[0].sheets[0].pieces[0].piece).toBe(
      hard.pieces.find((p) => p.id === first[0].sheets[0].pieces[0].piece.id),
    )
    refiner.terminate()
  })

  it('rebuilds layouts around the caller’s own piece objects', async () => {
    const { refine, terminate } = createWorkerRefiner(fakeWorker)
    const seen = new Set<object>()
    const run = await refine(hard, {
      maxSteps: 300,
      onImprovement: (layout) => {
        for (const sheet of layout.sheets) for (const placed of sheet.pieces) seen.add(placed.piece)
      },
    })
    terminate()
    expect(seen.size).toBeGreaterThan(0)
    const own = new Set<object>(hard.pieces)
    for (const piece of seen) expect(own.has(piece)).toBe(true)
    for (const sheet of run.layout!.sheets) {
      for (const placed of sheet.pieces) expect(own.has(placed.piece)).toBe(true)
    }
  })

  it('never publishes after an abort, and resolves as aborted', async () => {
    const { refine, terminate } = createWorkerRefiner(fakeWorker)
    const controller = new AbortController()
    let aborted = false
    let late = 0
    const promise = refine(hard, {
      budgetMs: 10_000,
      signal: controller.signal,
      onImprovement: () => {
        if (aborted) late++
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    controller.abort()
    aborted = true
    const run = await promise
    expect(run.aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 150))
    terminate()
    expect(late).toBe(0)
  })

  it('does nothing for a signal that is already aborted', async () => {
    const worker = fakeWorker()
    let created = 0
    const { refine, terminate } = createWorkerRefiner(() => {
      created++
      return worker
    })
    const controller = new AbortController()
    controller.abort()
    const run = await refine(hard, { signal: controller.signal })
    terminate()
    expect(run.aborted).toBe(true)
    expect(run.layout).toBeNull()
    expect(created).toBe(0)
  })

  it('lets a new run replace a running one without mixing their results', async () => {
    const { refine, terminate } = createWorkerRefiner(fakeWorker)
    const first = new AbortController()
    const firstSheets: number[] = []
    const stale = refine(hard, {
      budgetMs: 10_000,
      signal: first.signal,
      onImprovement: (layout) => firstSheets.push(layout.sheets.length),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    first.abort()
    const small = inputOf([{ width: 60, height: 80, copies: 10 }])
    const second = await refine(small, { maxSteps: 50 })
    await stale
    terminate()
    expect(validateLayout(small, second.layout!)).toEqual([])
    expect(second.layout!.totals?.pieceCount).toBe(10)
    expect(second.aborted).toBe(false)
  })

  it('reports a failure instead of hanging', async () => {
    const { refine, terminate } = createWorkerRefiner(fakeWorker)
    const broken = { ...hard, pieces: undefined } as unknown as typeof hard
    await expect(refine(broken, { maxSteps: 10 })).rejects.toThrow()
    terminate()
  })

  it('rejects the running call when the worker crashes, and starts a new worker next time', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = []
    const { refine, terminate } = createWorkerRefiner(() => {
      const worker = fakeWorker()
      workers.push(worker)
      return worker
    })
    const running = refine(hard, { budgetMs: 10_000 })
    await new Promise((resolve) => setTimeout(resolve, 30))
    workers[0].crash()
    await expect(running).rejects.toThrow('boom')
    const again = await refine(inputOf([{ width: 50, height: 50, copies: 4 }]), { maxSteps: 20 })
    expect(again.layout?.totals?.pieceCount).toBe(4)
    expect(workers).toHaveLength(2)
    expect(workers[0].terminated).toBe(true)
    terminate()
  })

  it('rejects running calls when terminated', async () => {
    const { refine, terminate } = createWorkerRefiner(fakeWorker)
    const running = refine(hard, { budgetMs: 10_000 })
    await new Promise((resolve) => setTimeout(resolve, 30))
    terminate()
    await expect(running).rejects.toThrow('terminated')
  })
})

describe('worker host', () => {
  /** Collects what the host says, with a way to wait for a message. */
  function recorder() {
    const messages: WorkerResponse[] = []
    const waiters: (() => void)[] = []
    const host = createHost({
      postMessage: (message) => {
        messages.push(message)
        for (const wake of waiters.splice(0)) wake()
      },
    })
    const until = async (done: () => boolean) => {
      while (!done()) await new Promise<void>((resolve) => waiters.push(resolve))
    }
    return { host, messages, until }
  }

  const slim = (input: typeof hard) => ({
    sheetSize: input.sheetSize,
    orientation: input.orientation,
    margin: input.margin,
    gap: input.gap,
    allowRotation: input.allowRotation,
    ordering: input.ordering,
    pieces: input.pieces.map(({ width, height }) => ({ width, height })),
  })

  it('answers a run with the starting layout first, then improvements, then done', async () => {
    const { host, messages, until } = recorder()
    host.handle({ type: 'run', id: 1, input: slim(hard), limits: { maxSteps: 500 } })
    await until(() => messages.some((m) => m.type === 'done'))
    expect(messages[0].type).toBe('first')
    expect(messages.filter((m) => m.type === 'first')).toHaveLength(1)
    const first = messages[0]
    expect(first.type === 'first' && first.layout.sheets.length).toBe(
      packLayout(hard).sheets.length,
    )
  })

  it('answers a run with improvements and then done', async () => {
    const { host, messages, until } = recorder()
    host.handle({ type: 'run', id: 1, input: slim(hard), limits: { maxSteps: 500 } })
    await until(() => messages.some((m) => m.type === 'done'))
    expect(messages.at(-1)?.type).toBe('done')
    expect(messages.filter((m) => m.type === 'improved').length).toBeGreaterThan(0)
    expect(messages.every((m) => m.id === 1)).toBe(true)
  })

  it('cancels the running run when a new one starts, and the old one stays silent', async () => {
    const { host, messages, until } = recorder()
    host.handle({ type: 'run', id: 1, input: slim(hard), limits: { budgetMs: 10_000 } })
    await until(() => messages.some((m) => m.id === 1 && m.type === 'improved'))
    host.handle({
      type: 'run',
      id: 2,
      input: slim(inputOf([{ width: 40, height: 40, copies: 5 }])),
      limits: { maxSteps: 20 },
    })
    const startOfSecond = messages.length
    await until(() => messages.some((m) => m.id === 2 && m.type === 'done'))
    await until(() => messages.some((m) => m.id === 1 && m.type === 'done'))
    const staleAfter = messages
      .slice(startOfSecond)
      .filter((m) => m.id === 1 && m.type === 'improved')
    expect(staleAfter).toHaveLength(0)
    const done = messages.find((m) => m.id === 1 && m.type === 'done')
    expect(done?.type === 'done' && done.summary.aborted).toBe(true)
  })

  it('ignores a cancel for a run that is not the current one', async () => {
    const { host, messages, until } = recorder()
    host.handle({ type: 'run', id: 5, input: slim(hard), limits: { maxSteps: 200 } })
    host.handle({ type: 'cancel', id: 4 })
    await until(() => messages.some((m) => m.type === 'done'))
    const done = messages.find((m) => m.type === 'done')
    expect(done?.type === 'done' && done.summary.aborted).toBe(false)
  })

  it('packs the slim input exactly as the full input', async () => {
    const { host, messages, until } = recorder()
    host.handle({ type: 'run', id: 1, input: slim(hard), limits: { maxSteps: 0 } })
    await until(() => messages.some((m) => m.type === 'done'))
    const done = messages.find((m) => m.type === 'done')
    expect(done?.type).toBe('done')
    const sync = packLayout(hard)
    expect(done?.type === 'done' && done.summary.layout.sheets.length).toBe(sync.sheets.length)
  })
})
