import { cleanName, nameKey, shorten, uniqueName } from './name'
import { isRecord, PRESET_LIMITS, type PresetSettings } from './schema'
import { readSettings } from './settings'

export type SkipReason = 'not-a-preset' | 'no-name' | 'no-settings' | 'over-limit'

export interface Skipped {
  index: number
  reason: SkipReason
  /** The name the entry had, when it had a usable one. */
  name?: string
}

export type SkipCounts = Record<SkipReason, number>

/** One entry that was accepted. Its `id` is whatever the source held and has not been checked. */
export interface ReadEntry {
  index: number
  id: unknown
  name: string
  settings: PresetSettings
  /** A name was shortened, or a setting was replaced or brought inside its limits. */
  adjusted: boolean
  /** The name the entry had before it was changed to be unique. */
  renamedFrom?: string
}

export interface ReadReport {
  entries: ReadEntry[]
  /** The first few skipped entries, for showing what was skipped and why. */
  skipped: Skipped[]
  /** How many entries were skipped for each reason, all of them. */
  counts: SkipCounts
}

const SKIPPED_DETAILS = 20

export const totalSkipped = (counts: SkipCounts) =>
  counts['not-a-preset'] + counts['no-name'] + counts['no-settings'] + counts['over-limit']

/**
 * Reads the entries of a stored list or an imported file. Each is checked on its own: a bad one is
 * skipped and counted, and never stops the others. At most `room` are accepted, in order. A name
 * that is already in `taken` (or was used by an earlier entry) is changed to be unique, so reading
 * never makes two presets share a name.
 */
export function readEntries(raw: unknown, room: number, taken: ReadonlySet<string>): ReadReport {
  const list: readonly unknown[] = Array.isArray(raw) ? raw : []
  const scanned = Math.min(list.length, PRESET_LIMITS.scanned)
  const report: ReadReport = {
    entries: [],
    skipped: [],
    counts: {
      'not-a-preset': 0,
      'no-name': 0,
      'no-settings': 0,
      'over-limit': list.length - scanned,
    },
  }
  const used = new Set(taken)

  const skip = (index: number, reason: SkipReason, name?: string) => {
    report.counts[reason] += 1
    if (report.skipped.length < SKIPPED_DETAILS) report.skipped.push({ index, reason, name })
  }

  for (let index = 0; index < scanned; index++) {
    const entry = list[index]
    const name = isRecord(entry) ? cleanName(entry.name) : ''
    if (report.entries.length >= room) {
      skip(index, 'over-limit', name || undefined)
    } else if (!isRecord(entry)) {
      skip(index, 'not-a-preset')
    } else if (name === '') {
      skip(index, 'no-name')
    } else {
      const read = readSettings(entry.settings)
      if (!read) {
        skip(index, 'no-settings', name)
        continue
      }
      const shortened = shorten(name, PRESET_LIMITS.nameLength)
      const unique = uniqueName(shortened, used)
      used.add(nameKey(unique))
      report.entries.push({
        index,
        id: entry.id,
        name: unique,
        settings: read.settings,
        adjusted: read.adjusted || shortened !== name,
        renamedFrom: unique === shortened ? undefined : shortened,
      })
    }
  }
  return report
}
