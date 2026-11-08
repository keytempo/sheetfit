import { assembleLoad } from '../meta'
import {
  WorkStorageError,
  type LoadResult,
  type StorageFailure,
  type StoredImage,
  type WorkMeta,
  type WorkStore,
} from '../types'

/**
 * A `WorkStore` that lives in memory, for tests. It is as strict as the real one about the one thing
 * that matters: `save` is all or nothing. It can be told to fail, to run out of room, or to hold
 * damaged data, and it counts what was done to it.
 */
export function createMemoryStore(options: { capacity?: number } = {}) {
  const records = new Map<string, unknown>()
  let meta: unknown
  const state = {
    saves: [] as { put: string[]; remove: string[]; items: number }[],
    loads: 0,
    clears: 0,
    closed: false,
    failNext: null as StorageFailure | null,
    capacity: options.capacity ?? Infinity,
  }

  const bytesOf = (value: unknown) =>
    value && typeof value === 'object' && 'file' in value
      ? (value as StoredImage).file.size + (value as StoredImage).thumbnail.size
      : 0
  const used = () => [...records.values()].reduce<number>((total, r) => total + bytesOf(r), 0)

  const store: WorkStore = {
    load: (): Promise<LoadResult> => {
      state.loads += 1
      const listed = new Map<string, unknown>()
      const parsed = (meta as { items?: { id?: unknown }[] } | undefined)?.items
      if (Array.isArray(parsed))
        for (const item of parsed)
          if (typeof item?.id === 'string' && records.has(item.id))
            listed.set(item.id, records.get(item.id))
      return Promise.resolve(assembleLoad(meta, listed, [...records.keys()]))
    },
    save: (put, remove, next: WorkMeta) => {
      if (state.failNext) {
        const failure = state.failNext
        state.failNext = null
        return Promise.reject(new WorkStorageError(failure))
      }
      const incoming = put.reduce((total, image) => total + bytesOf(image), 0)
      const freed = remove.reduce((total, id) => total + bytesOf(records.get(id)), 0)
      if (used() - freed + incoming > state.capacity)
        return Promise.reject(new WorkStorageError('full'))
      for (const image of put) records.set(image.id, image)
      for (const id of remove) records.delete(id)
      meta = structuredClone({ ...next, items: next.items })
      state.saves.push({ put: put.map((i) => i.id), remove: [...remove], items: next.items.length })
      return Promise.resolve()
    },
    clear: () => {
      state.clears += 1
      records.clear()
      meta = undefined
      return Promise.resolve()
    },
    close: () => {
      state.closed = true
    },
  }

  return {
    store,
    state,
    /** Direct access, for arranging and checking. */
    records,
    get meta() {
      return meta
    },
    set meta(value: unknown) {
      meta = value
    },
  }
}
