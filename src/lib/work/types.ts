/** The version of the saved work this build reads and writes. */
export const WORK_SCHEMA = 1

/** One photo as it is saved: the original bytes, untouched, and a small copy for the list. */
export interface StoredImage {
  id: string
  name: string
  /** The original file's MIME type, so the restored file is the same file. */
  type: string
  width: number
  height: number
  /** The size of `file` when it was saved, to tell a whole file from a cut-off one. */
  bytes: number
  file: Blob
  thumbnail: Blob
}

/** What is saved about a photo besides its bytes: its place in the list and its settings. */
export interface WorkItem {
  id: string
  name: string
  copies: number
  percent: number
}

/** The saved list. Committed in the same step as the photos it names, never before. */
export interface WorkMeta {
  schema: number
  /** In list order. */
  items: WorkItem[]
  savedAt: number
}

/** Why saving or loading could not be done. */
export type StorageFailure =
  /** There is no storage to use: disabled, private mode, blocked by the browser. */
  | 'unavailable'
  /** The browser said there is no room left. */
  | 'full'
  /** The saved work was written by a newer version of the app, which this one leaves alone. */
  | 'newer'
  /** Anything else. */
  | 'failed'

export class WorkStorageError extends Error {
  readonly failure: StorageFailure

  constructor(failure: StorageFailure, message?: string) {
    super(message ?? failure)
    this.name = 'WorkStorageError'
    this.failure = failure
  }
}

export type LoadResult =
  | { kind: 'empty' }
  /** Written by a newer version of the app. */
  | { kind: 'newer' }
  /** There was something, but it could not be read as a list. */
  | { kind: 'corrupt'; ids: string[] }
  | {
      kind: 'work'
      meta: WorkMeta
      /** The record of each listed id that has one; `'unreadable'` for one that is not shaped like a photo. */
      records: Map<string, StoredImage | 'unreadable'>
      /** Every id that has a record, listed or not, so strays can be cleaned up. */
      storedIds: string[]
    }

/**
 * Where work is kept. The one place the rest of the app meets a database, small enough to be
 * replaced by a plain in-memory object in tests. Every method either does all of what it says or
 * nothing: a failure part-way leaves the store as it was.
 */
export interface WorkStore {
  load: () => Promise<LoadResult>
  /** In one step: store `put`, delete `remove`, and make `meta` the saved list. */
  save: (put: readonly StoredImage[], remove: readonly string[], meta: WorkMeta) => Promise<void>
  /** Deletes everything. */
  clear: () => Promise<void>
  /** Lets go of the connection. */
  close: () => void
}
