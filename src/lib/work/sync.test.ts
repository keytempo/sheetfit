import { describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from './testing/memory-store'
import { createWorkSync, type SyncState, type WorkImage, type WorkSource } from './sync'
import { WorkStorageError, type WorkStore } from './types'

const image = (id: string, extra: Partial<WorkImage> = {}, size = 3): WorkImage => ({
  id,
  name: `${id}.jpg`,
  file: new File(['x'.repeat(size)], `${id}.jpg`, { type: 'image/jpeg' }),
  thumbnail: new Blob(['t']),
  width: 800,
  height: 600,
  copies: 1,
  percent: 100,
  ...extra,
})

function source(initial: WorkImage[] = []) {
  let images = initial
  const listeners = new Set<() => void>()
  const api: WorkSource & { set: (next: WorkImage[]) => void; listeners: number } = {
    read: () => images,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next) => {
      images = next
      listeners.forEach((l) => l())
    },
    get listeners() {
      return listeners.size
    },
  }
  return api
}

const start = (
  src: WorkSource,
  memory = createMemoryStore(),
  initial: { ids: string[]; items: null | [] } = { ids: [], items: [] },
) => {
  const states: SyncState[] = []
  const onSaved = vi.fn()
  const sync = createWorkSync({
    store: memory.store,
    source: src,
    initial,
    onState: (s) => states.push(s),
    onSaved,
  })
  return { sync, memory, states, onSaved }
}

describe('createWorkSync', () => {
  it('writes nothing when it starts with nothing to write', async () => {
    const { sync, memory } = start(source())
    await sync.settled()
    expect(memory.state.saves).toEqual([])
  })

  it('saves new photos and the list that names them in one step', async () => {
    const src = source()
    const { sync, memory, onSaved } = start(src)
    src.set([image('a'), image('b')])
    await sync.settled()
    expect(memory.state.saves).toEqual([{ put: ['a', 'b'], remove: [], items: 2 }])
    expect(onSaved).toHaveBeenCalledWith(2)
  })

  it('writes a photo only once: a change of copies, size or order rewrites the list alone', async () => {
    const src = source()
    const { sync, memory } = start(src)
    src.set([image('a'), image('b')])
    await sync.settled()
    src.set([image('a', { copies: 7 }), image('b')])
    await sync.settled()
    src.set([image('b'), image('a', { copies: 7 })])
    await sync.settled()
    src.set([image('b', { percent: 150 }), image('a', { copies: 7 })])
    await sync.settled()
    expect(memory.state.saves.map((s) => s.put)).toEqual([['a', 'b'], [], [], []])
    expect((memory.meta as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('deletes the record of a removed photo in the same step as it drops it from the list', async () => {
    const src = source()
    const { sync, memory } = start(src)
    src.set([image('a'), image('b')])
    await sync.settled()
    src.set([image('b')])
    await sync.settled()
    expect(memory.state.saves.at(-1)).toEqual({ put: [], remove: ['a'], items: 1 })
    expect([...memory.records.keys()]).toEqual(['b'])
  })

  it('saves a photo again when it comes back, as Undo does', async () => {
    const src = source()
    const { sync, memory } = start(src)
    const a = image('a')
    src.set([a])
    await sync.settled()
    src.set([])
    await sync.settled()
    src.set([a])
    await sync.settled()
    expect(memory.state.saves.map((s) => [s.put, s.remove])).toEqual([
      [['a'], []],
      [['a'], []],
    ])
    expect(memory.state.clears).toBe(1)
  })

  it('writes nothing for a change that is not a change to the photos', async () => {
    const src = source([image('a')])
    const { sync, memory } = start(src)
    await sync.settled()
    const before = memory.state.saves.length
    src.set([...src.read()])
    await sync.settled()
    expect(memory.state.saves.length).toBe(before)
  })

  it('does not rewrite what is already saved, and clears away strays left by an earlier session', async () => {
    const memory = createMemoryStore()
    await memory.store.save([], [], {
      schema: 1,
      savedAt: 1,
      items: [{ id: 'a', name: 'a.jpg', copies: 1, percent: 100 }],
    })
    const same = start(source([image('a')]), memory, { ids: ['a'], items: [] })
    await same.sync.settled()
    // The list on disk had a, the app has a with the same settings: but `items: []` said otherwise, so it is fixed once.
    expect(memory.state.saves).toHaveLength(2)

    const fresh = createMemoryStore()
    const strays = start(source([]), fresh, { ids: ['stray'], items: [] })
    await strays.sync.settled()
    expect(fresh.state.saves).toEqual([])
    expect(fresh.state.clears).toBe(1)
  })

  it('rewrites the list when it cannot be trusted: with photos, saves them; with none, clears', async () => {
    const withPhotos = createMemoryStore()
    const a = start(source([image('a')]), withPhotos, { ids: ['a'], items: null })
    await a.sync.settled()
    expect(withPhotos.state.saves).toHaveLength(1)

    const empty = createMemoryStore()
    const b = start(source([]), empty, { ids: [], items: null })
    await b.sync.settled()
    expect(empty.state.clears).toBe(1)
  })

  it('writes one at a time and coalesces a burst of changes into one more write, with no timer', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const memory = createMemoryStore()
    const real = memory.store.save
    let calls = 0
    const slow: WorkStore = {
      ...memory.store,
      save: async (...args) => {
        calls += 1
        if (calls === 1) await gate
        return real(...args)
      },
    }
    const src = source([image('a')])
    const sync = createWorkSync({
      store: slow,
      source: src,
      initial: { ids: [], items: [] },
      onState: () => {},
    })
    for (let copies = 2; copies <= 60; copies++) src.set([image('a', { copies })])
    release()
    await sync.settled()
    expect(calls).toBe(2)
    expect((memory.meta as { items: { copies: number }[] }).items[0].copies).toBe(60)
  })

  it('leaves the store as it was when a save fails, reports it, and tries again on the next change', async () => {
    const src = source()
    const { sync, memory, states } = start(src)
    src.set([image('a')])
    await sync.settled()
    memory.state.failNext = 'failed'
    src.set([image('a'), image('b')])
    await sync.settled()
    expect(states.at(-1)).toEqual({ kind: 'failed', failure: 'failed' })
    expect([...memory.records.keys()]).toEqual(['a'])
    expect((memory.meta as { items: unknown[] }).items).toHaveLength(1)

    src.set([image('a'), image('b'), image('c')])
    await sync.settled()
    expect(states.at(-1)).toEqual({ kind: 'saved' })
    expect([...memory.records.keys()].sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps going in memory when there is no room, and says so', async () => {
    const memory = createMemoryStore({ capacity: 20 })
    const src = source()
    const { sync, states } = start(src, memory)
    src.set([image('a', {}, 10)])
    await sync.settled()
    src.set([image('a', {}, 10), image('big', {}, 500)])
    await sync.settled()
    expect(states.at(-1)).toEqual({ kind: 'failed', failure: 'full' })
    expect([...memory.records.keys()]).toEqual(['a'])
    expect((src.read() as WorkImage[]).length).toBe(2)
  })

  it('frees what was removed when a save that needed room fails, which may make room for next time', async () => {
    const memory = createMemoryStore({ capacity: 40 })
    const src = source()
    const { sync, states } = start(src, memory)
    src.set([image('a', {}, 30)])
    await sync.settled()
    src.set([image('b', {}, 100)])
    await sync.settled()
    expect(states.at(-1)).toEqual({ kind: 'failed', failure: 'full' })
    expect([...memory.records.keys()]).toEqual([])
    expect((memory.meta as { items: unknown[] }).items).toEqual([])

    src.set([image('b', {}, 100), image('c', {}, 5)])
    await sync.settled()
    expect(states.at(-1)).toEqual({ kind: 'failed', failure: 'full' })
    src.set([image('c', {}, 5)])
    await sync.settled()
    expect(states.at(-1)).toEqual({ kind: 'saved' })
    expect([...memory.records.keys()]).toEqual(['c'])
  })

  it("never writes again once the saved work turns out to be a newer version's", async () => {
    const src = source()
    const { sync, memory, states } = start(src)
    memory.state.failNext = 'newer'
    src.set([image('a')])
    await sync.settled()
    src.set([image('a'), image('b')])
    await sync.settled()
    expect(states).toEqual([{ kind: 'failed', failure: 'newer' }])
    expect(memory.state.saves).toEqual([])
  })

  it('treats an error it does not know as a plain failure', async () => {
    const memory = createMemoryStore()
    const boom: WorkStore = { ...memory.store, save: () => Promise.reject(new Error('boom')) }
    const states: SyncState[] = []
    const src = source([image('a')])
    const sync = createWorkSync({
      store: boom,
      source: src,
      initial: { ids: [], items: [] },
      onState: (s) => states.push(s),
    })
    await sync.settled()
    expect(states).toEqual([{ kind: 'failed', failure: 'failed' }])
  })

  it('clears everything in one step when the last photo goes, Clear all included', async () => {
    const src = source()
    const { sync, memory, onSaved } = start(src)
    src.set([image('a'), image('b')])
    await sync.settled()
    src.set([])
    await sync.settled()
    expect(memory.state.clears).toBe(1)
    expect(memory.records.size).toBe(0)
    expect(memory.meta).toBeUndefined()
    expect(onSaved).toHaveBeenLastCalledWith(0)
    src.set([])
    await sync.settled()
    expect(memory.state.clears).toBe(1)
  })

  it('reports a clear that fails, and clears on the next change', async () => {
    const src = source()
    const { sync, memory, states } = start(src)
    src.set([image('a')])
    await sync.settled()
    const real = memory.store.clear
    let fail = true
    memory.store.clear = () => (fail ? Promise.reject(new WorkStorageError('failed')) : real())
    src.set([])
    await sync.settled()
    expect(states.at(-1)).toEqual({ kind: 'failed', failure: 'failed' })
    expect(memory.records.size).toBe(1)
    fail = false
    src.set([image('b')])
    src.set([])
    await sync.settled()
    expect(memory.records.size).toBe(0)
  })

  it('stops following the photos when stopped', async () => {
    const src = source()
    const { sync, memory } = start(src)
    sync.stop()
    expect(src.listeners).toBe(0)
    src.set([image('a')])
    await sync.settled()
    expect(memory.state.saves).toEqual([])
  })

  it('reports the failure kind the store gave', async () => {
    const memory = createMemoryStore()
    const full: WorkStore = {
      ...memory.store,
      save: () => Promise.reject(new WorkStorageError('unavailable')),
    }
    const states: SyncState[] = []
    const sync = createWorkSync({
      store: full,
      source: source([image('a')]),
      initial: { ids: [], items: [] },
      onState: (s) => states.push(s),
    })
    await sync.settled()
    expect(states).toEqual([{ kind: 'failed', failure: 'unavailable' }])
  })
})
