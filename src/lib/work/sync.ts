import {
  WORK_SCHEMA,
  WorkStorageError,
  type StorageFailure,
  type StoredImage,
  type WorkItem,
  type WorkStore,
} from './types'

/** A photo as the app holds it. */
export interface WorkImage {
  id: string
  name: string
  file: File
  thumbnail: Blob
  width: number
  height: number
  copies: number
  percent: number
}

export interface WorkSource {
  read: () => readonly WorkImage[]
  /** Calls `listener` whenever what `read` returns may have changed; returns the way to stop. */
  subscribe: (listener: () => void) => () => void
}

export type SyncState = { kind: 'saved' } | { kind: 'failed'; failure: StorageFailure }

interface SyncOptions {
  store: WorkStore
  source: WorkSource
  /**
   * What is in the store when syncing starts: every id that has a record (listed or not, so strays
   * can be cleared) and the list as saved, or `null` when it cannot be trusted and must be rewritten.
   */
  initial: { ids: readonly string[]; items: readonly WorkItem[] | null }
  onState: (state: SyncState) => void
  /** Called after each successful save with the number of photos now saved. */
  onSaved?: (count: number) => void
}

const failureOf = (error: unknown): StorageFailure =>
  error instanceof WorkStorageError ? error.failure : 'failed'

const toStored = (image: WorkImage): StoredImage => ({
  id: image.id,
  name: image.name,
  type: image.file.type,
  width: image.width,
  height: image.height,
  bytes: image.file.size,
  file: image.file,
  thumbnail: image.thumbnail,
})

const toItem = ({ id, name, copies, percent }: WorkImage): WorkItem => ({
  id,
  name,
  copies,
  percent,
})

/**
 * Keeps the store in step with the app's photos. It follows the photos and does what is needed to
 * make the store match them: a photo's bytes are written once, when it first appears, and only a
 * small list (order, copies, sizes) is rewritten when those change, so moving a slider never
 * rewrites a photo. Every write is one atomic `store.save`, with the photos it needs and the list
 * that names them together, so a tab that dies in the middle leaves the last complete state.
 *
 * Writes are one at a time. Changes that arrive during a write are not queued one by one: when the
 * write ends there is one more, from the app's state as it is then, so a slider drag costs at most
 * one write in flight and one waiting however many changes it makes. There is no timer.
 *
 * When a save fails the app carries on: nothing is thrown away, the failure is reported, and the
 * next change tries again with everything still unsaved. If the store is full and the failed save
 * included new photos, it first frees what the person has removed, which may be what makes room.
 * When the app has no photos left it clears the store outright.
 */
export function createWorkSync({ store, source, initial, onState, onSaved }: SyncOptions) {
  const stored = new Set(initial.ids)
  let lastList = initial.items === null ? null : JSON.stringify(initial.items)
  let running: Promise<void> | null = null
  let dirty = false
  let stopped = false

  /** Reports a failed write. A store that is full is first given a chance to drop what was removed. */
  async function failed(
    error: unknown,
    freeing?: { remove: string[]; items: WorkItem[] },
  ): Promise<void> {
    const failure = failureOf(error)
    // The saved work is a newer version's: this one must not write over it, now or later.
    if (failure === 'newer') stopped = true
    onState({ kind: 'failed', failure })
    if (failure !== 'full' || !freeing || freeing.remove.length === 0) return
    const kept = freeing.items.filter((item) => stored.has(item.id))
    try {
      await store.save([], freeing.remove, {
        schema: WORK_SCHEMA,
        items: kept,
        savedAt: Date.now(),
      })
      for (const id of freeing.remove) stored.delete(id)
      lastList = JSON.stringify(kept)
    } catch {
      // Nothing more can be done; the failure has been reported.
    }
  }

  async function writeOnce() {
    const images = source.read()
    const items = images.map(toItem)
    const list = JSON.stringify(items)

    if (images.length === 0) {
      if (stored.size === 0 && list === lastList) return
      // Nothing is left to keep: clear the lot in one step, strays included.
      try {
        await store.clear()
      } catch (error) {
        await failed(error)
        return
      }
      stored.clear()
      lastList = list
      onState({ kind: 'saved' })
      onSaved?.(0)
      return
    }

    const wanted = new Set(images.map((image) => image.id))
    const add = images.filter((image) => !stored.has(image.id))
    const remove = [...stored].filter((id) => !wanted.has(id))
    if (add.length === 0 && remove.length === 0 && list === lastList) return

    try {
      await store.save(add.map(toStored), remove, {
        schema: WORK_SCHEMA,
        items,
        savedAt: Date.now(),
      })
    } catch (error) {
      await failed(error, add.length > 0 ? { remove, items } : undefined)
      return
    }
    for (const image of add) stored.add(image.id)
    for (const id of remove) stored.delete(id)
    lastList = list
    onState({ kind: 'saved' })
    onSaved?.(images.length)
  }

  async function loop() {
    while (dirty && !stopped) {
      dirty = false
      await writeOnce()
    }
  }

  const schedule = () => {
    dirty = true
    if (running) return
    // Cleared in `finally`, which runs after `running` has been assigned even when the loop has
    // nothing to do and ends at once.
    running = loop().finally(() => {
      running = null
    })
  }

  const unsubscribe = source.subscribe(schedule)
  // Whatever the app already holds that the store does not (and strays the store holds that the
  // app does not) is settled straight away; when the two already agree this writes nothing.
  schedule()

  return {
    stop: () => {
      stopped = true
      unsubscribe()
    },
    /** Resolves when nothing is being written and nothing is waiting. */
    settled: async () => {
      while (running) await running
    },
  }
}
