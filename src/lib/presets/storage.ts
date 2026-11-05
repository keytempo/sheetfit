import { readEntries, totalSkipped, type SkipCounts } from './read'
import {
  isRecord,
  isValidId,
  newId,
  PRESET_LIMITS,
  STORAGE_KEY,
  STORAGE_VERSION,
  type Preset,
} from './schema'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/**
 * `ok`: saved presets are read and written. `unavailable`: the browser gives no storage, so
 * presets last as long as the tab. `full`: storage is there but refused the last write; same
 * consequence until a write works again. `read-only`: the stored presets come from a newer version,
 * which may hold things this one cannot read, so they are shown and used but never overwritten.
 */
export type Availability = 'ok' | 'unavailable' | 'full' | 'read-only'

export type LoadNotice =
  | { kind: 'unreadable' }
  | { kind: 'newer-version' }
  | { kind: 'skipped'; counts: SkipCounts; adjusted: number }

export interface Loaded {
  presets: Preset[]
  activeId: string | null
  availability: 'ok' | 'unavailable' | 'read-only'
  notice: LoadNotice | null
}

type SaveOutcome = 'ok' | 'full' | 'unavailable'

/** `localStorage`, or null where touching it throws (some privacy settings do that). */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const loaded = (partial: Partial<Loaded>): Loaded => ({
  presets: [],
  activeId: null,
  availability: 'ok',
  notice: null,
  ...partial,
})

/**
 * Reads the saved presets. Nothing in storage is trusted: each preset is checked on its own, the bad
 * ones are skipped and counted, and whatever comes back is valid. Reading never writes, so nothing
 * is deleted until the person's next change saves the list again.
 */
export function loadPresets(storage: StorageLike | null, makeId: () => string = newId): Loaded {
  if (!storage) return loaded({ availability: 'unavailable' })
  let text: string | null
  try {
    text = storage.getItem(STORAGE_KEY)
  } catch {
    return loaded({ availability: 'unavailable' })
  }
  if (text === null) return loaded({})

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return loaded({ notice: { kind: 'unreadable' } })
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.version !== 'number' ||
    !Number.isInteger(parsed.version) ||
    parsed.version < 1 ||
    !Array.isArray(parsed.presets)
  ) {
    return loaded({ notice: { kind: 'unreadable' } })
  }

  const report = readEntries(parsed.presets, PRESET_LIMITS.count, new Set())
  const ids = new Set<string>()
  const presets = report.entries.map((entry): Preset => {
    const id = isValidId(entry.id) && !ids.has(entry.id) ? entry.id : makeId()
    ids.add(id)
    return { id, name: entry.name, settings: entry.settings }
  })
  const adjusted = report.entries.filter((entry) => entry.adjusted).length
  const activeId =
    typeof parsed.activeId === 'string' && ids.has(parsed.activeId) ? parsed.activeId : null

  if (parsed.version > STORAGE_VERSION) {
    return loaded({
      presets,
      activeId,
      availability: 'read-only',
      notice: { kind: 'newer-version' },
    })
  }
  const notice =
    totalSkipped(report.counts) + adjusted > 0
      ? ({ kind: 'skipped', counts: report.counts, adjusted } as const)
      : null
  return loaded({ presets, activeId, notice })
}

const isQuotaError = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 ||
    error.code === 1014)

/** Writes the presets and which one is active. Says why when it could not. */
export function savePresets(
  storage: StorageLike | null,
  presets: readonly Preset[],
  activeId: string | null,
): SaveOutcome {
  if (!storage) return 'unavailable'
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, presets, activeId }))
    return 'ok'
  } catch (error) {
    return isQuotaError(error) ? 'full' : 'unavailable'
  }
}
