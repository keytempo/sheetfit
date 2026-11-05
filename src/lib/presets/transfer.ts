import { nameKey } from './name'
import { readEntries, type ReadEntry, type SkipCounts, type Skipped } from './read'
import { EXPORT_FORMAT, EXPORT_VERSION, isRecord, PRESET_LIMITS, type Preset } from './schema'

/**
 * The file an export makes: a marker, the schema version, the version of the app that wrote it
 * and the presets without their ids (an import always makes new ones). It is plain JSON; reading it
 * never evaluates anything.
 */
export function serialisePresets(
  presets: readonly Preset[],
  appVersion: string,
  exportedAt: Date,
): string {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      appVersion,
      exportedAt: exportedAt.toISOString(),
      presets: presets.map(({ name, settings }) => ({ name, settings })),
    },
    null,
    2,
  )
}

/** `sheetfit-presets.json` for a list, and the preset's name in it for a single preset. */
export function exportFileName(presets: readonly Preset[]): string {
  if (presets.length !== 1) return 'sheetfit-presets.json'
  const slug = presets[0].name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
  return slug ? `sheetfit-preset-${slug}.json` : 'sheetfit-preset.json'
}

export type ImportProblem = 'too-big' | 'not-json' | 'not-presets' | 'newer-version' | 'no-presets'

export interface ImportPreview {
  /** What will be added, with names already made unique. */
  entries: ReadEntry[]
  skipped: Skipped[]
  counts: SkipCounts
  /** Entries whose name was changed because it was taken. */
  renamed: number
  /** Entries with a value that was replaced or brought inside its limits, or a shortened name. */
  adjusted: number
}

export type ImportRead =
  { ok: true; preview: ImportPreview } | { ok: false; problem: ImportProblem }

/**
 * Checks an imported file and says what importing it would do, without doing anything. A file that
 * is too big, is not JSON, is not a Sheetfit presets file or comes from a newer version is
 * refused as a whole; inside a good file each preset stands or falls on its own.
 */
export function readImport(text: string, existing: readonly Preset[]): ImportRead {
  if (text.length > PRESET_LIMITS.importBytes) return { ok: false, problem: 'too-big' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, problem: 'not-json' }
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== EXPORT_FORMAT ||
    typeof parsed.version !== 'number' ||
    !Number.isInteger(parsed.version) ||
    parsed.version < 1 ||
    !Array.isArray(parsed.presets)
  ) {
    return { ok: false, problem: 'not-presets' }
  }
  if (parsed.version > EXPORT_VERSION) return { ok: false, problem: 'newer-version' }
  if (parsed.presets.length === 0) return { ok: false, problem: 'no-presets' }

  const taken = new Set(existing.map((preset) => nameKey(preset.name)))
  const room = Math.max(0, PRESET_LIMITS.count - existing.length)
  const report = readEntries(parsed.presets, room, taken)
  return {
    ok: true,
    preview: {
      entries: report.entries,
      skipped: report.skipped,
      counts: report.counts,
      renamed: report.entries.filter((entry) => entry.renamedFrom !== undefined).length,
      adjusted: report.entries.filter((entry) => entry.adjusted).length,
    },
  }
}
