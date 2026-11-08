import { assembleLoad } from './meta'
import {
  WorkStorageError,
  type LoadResult,
  type StorageFailure,
  type StoredImage,
  type WorkMeta,
  type WorkStore,
} from './types'

const DB_NAME = 'sheetfit-work'
const DB_VERSION = 1
const IMAGES = 'images'
const META = 'meta'
const META_KEY = 'work'

const FAILURE_BY_ERROR_NAME: Record<string, StorageFailure> = {
  QuotaExceededError: 'full',
  VersionError: 'newer',
  SecurityError: 'unavailable',
  InvalidStateError: 'unavailable',
  NotAllowedError: 'unavailable',
}

/** Turns whatever IndexedDB threw into the few failures the app tells apart. */
function classify(error: unknown): WorkStorageError {
  if (error instanceof WorkStorageError) return error
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  const message = error instanceof Error ? error.message : undefined
  return new WorkStorageError(FAILURE_BY_ERROR_NAME[name] ?? 'failed', message)
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(classify(request.error))
  })

/** Resolves when the transaction has committed, rejects if it was aborted for any reason. */
const committed = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(classify(transaction.error))
    transaction.onabort = () => reject(classify(transaction.error))
  })

/** The ids a saved list names, read loosely: only to know which records to fetch. */
function listedIds(rawMeta: unknown): string[] {
  const items = (rawMeta as { items?: unknown } | undefined)?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((item: unknown) => {
    const id = (item as { id?: unknown } | null)?.id
    return typeof id === 'string' ? [id] : []
  })
}

/**
 * The work store on IndexedDB. Photos go in one object store, keyed by id, as the original `File`
 * (stored as it is, never re-encoded) with a small thumbnail beside it; the list (order, copies,
 * sizes) is one small record in another. Every change is one `readwrite` transaction over both, so
 * it commits whole or not at all, including when the tab is closed in the middle of it.
 *
 * The connection is opened when first needed and dropped if the browser closes it, so a database
 * the browser deleted (storage cleared while the page was open) is simply opened again, empty.
 */
export function createIndexedDbStore(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): WorkStore {
  let connection: Promise<IDBDatabase> | null = null

  const attempt = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      if (!factory) {
        reject(new WorkStorageError('unavailable'))
        return
      }
      let request: IDBOpenDBRequest
      try {
        request = factory.open(DB_NAME, DB_VERSION)
      } catch (error) {
        reject(classify(error))
        return
      }
      request.onupgradeneeded = () => {
        request.result.createObjectStore(IMAGES, { keyPath: 'id' })
        request.result.createObjectStore(META)
      }
      request.onsuccess = () => {
        const db = request.result
        const forget = () => {
          connection = null
        }
        db.onclose = forget
        db.onversionchange = () => {
          db.close()
          forget()
        }
        resolve(db)
      }
      request.onerror = () => reject(classify(request.error))
      request.onblocked = () => reject(new WorkStorageError('failed', 'The database is blocked.'))
    })

  const connect = () => {
    connection ??= attempt().catch((error: unknown) => {
      connection = null
      throw classify(error)
    })
    return connection
  }

  return {
    async load(): Promise<LoadResult> {
      const db = await connect()
      const transaction = db.transaction([IMAGES, META], 'readonly')
      const images = transaction.objectStore(IMAGES)
      const [rawMeta, keys] = await Promise.all([
        requestResult<unknown>(transaction.objectStore(META).get(META_KEY)),
        requestResult(images.getAllKeys()),
      ])
      const storedIds = keys.map(String)
      const present = new Set(storedIds)
      const ids = listedIds(rawMeta).filter((id) => present.has(id))
      const found = await Promise.all(ids.map((id) => requestResult<unknown>(images.get(id))))
      return assembleLoad(rawMeta, new Map(ids.map((id, i) => [id, found[i]])), storedIds)
    },

    async save(put: readonly StoredImage[], remove: readonly string[], meta: WorkMeta) {
      const db = await connect()
      const transaction = db.transaction([IMAGES, META], 'readwrite')
      const done = committed(transaction)
      try {
        const images = transaction.objectStore(IMAGES)
        for (const record of put) images.put(record)
        for (const id of remove) images.delete(id)
        transaction.objectStore(META).put(meta, META_KEY)
      } catch (error) {
        // A put can throw at once (a value that cannot be stored). The transaction is still open
        // and would commit what came before; aborting it keeps the step all or nothing.
        transaction.abort()
        done.catch(() => undefined)
        throw classify(error)
      }
      await done
    },

    async clear() {
      const db = await connect()
      const transaction = db.transaction([IMAGES, META], 'readwrite')
      const done = committed(transaction)
      transaction.objectStore(IMAGES).clear()
      transaction.objectStore(META).clear()
      await done
    },

    close() {
      void connection?.then(
        (db) => db.close(),
        () => undefined,
      )
      connection = null
    },
  }
}
