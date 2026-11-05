import { checkName, copyName, nameKey, uniqueName } from './name'
import type { ReadEntry } from './read'
import { PRESET_LIMITS, type Preset, type PresetSettings } from './schema'

export type Failure =
  'name-empty' | 'name-too-long' | 'name-taken' | 'limit' | 'not-found' | 'read-only'

export type Outcome<T> = { ok: true; presets: Preset[]; value: T } | { ok: false; reason: Failure }

const fail = (reason: Failure): { ok: false; reason: Failure } => ({ ok: false, reason })
const done = <T>(presets: Preset[], value: T): Outcome<T> => ({ ok: true, presets, value })

const namesOf = (presets: readonly Preset[], exceptId?: string) =>
  new Set(presets.filter((preset) => preset.id !== exceptId).map((preset) => nameKey(preset.name)))

/** A typed name, accepted only when it is valid and no other preset already has it. */
function acceptName(presets: readonly Preset[], raw: string, exceptId?: string) {
  const checked = checkName(raw)
  if (!checked.ok) return fail(checked.problem === 'empty' ? 'name-empty' : 'name-too-long')
  if (namesOf(presets, exceptId).has(nameKey(checked.name))) return fail('name-taken')
  return checked
}

export function addPreset(
  presets: readonly Preset[],
  rawName: string,
  settings: PresetSettings,
  makeId: () => string,
): Outcome<Preset> {
  if (presets.length >= PRESET_LIMITS.count) return fail('limit')
  const accepted = acceptName(presets, rawName)
  if (!accepted.ok) return accepted
  const preset: Preset = { id: makeId(), name: accepted.name, settings }
  return done([...presets, preset], preset)
}

/** Gives a preset new settings. The value is the preset as it was, for undoing. */
export function replaceSettings(
  presets: readonly Preset[],
  id: string,
  settings: PresetSettings,
): Outcome<Preset> {
  const before = presets.find((preset) => preset.id === id)
  if (!before) return fail('not-found')
  return done(
    presets.map((preset) => (preset.id === id ? { ...preset, settings } : preset)),
    before,
  )
}

/** The value is the name the preset had. */
export function renamePreset(
  presets: readonly Preset[],
  id: string,
  rawName: string,
): Outcome<string> {
  const before = presets.find((preset) => preset.id === id)
  if (!before) return fail('not-found')
  const accepted = acceptName(presets, rawName, id)
  if (!accepted.ok) return accepted
  return done(
    presets.map((preset) => (preset.id === id ? { ...preset, name: accepted.name } : preset)),
    before.name,
  )
}

/** The copy goes right after the original. */
export function duplicatePreset(
  presets: readonly Preset[],
  id: string,
  makeId: () => string,
): Outcome<Preset> {
  const index = presets.findIndex((preset) => preset.id === id)
  if (index < 0) return fail('not-found')
  if (presets.length >= PRESET_LIMITS.count) return fail('limit')
  const copy: Preset = {
    id: makeId(),
    name: copyName(presets[index].name, namesOf(presets)),
    settings: presets[index].settings,
  }
  return done([...presets.slice(0, index + 1), copy, ...presets.slice(index + 1)], copy)
}

/** The value is the preset and where it was, for undoing. */
export function removePreset(
  presets: readonly Preset[],
  id: string,
): Outcome<{ preset: Preset; index: number }> {
  const index = presets.findIndex((preset) => preset.id === id)
  if (index < 0) return fail('not-found')
  return done(
    presets.filter((preset) => preset.id !== id),
    { preset: presets[index], index },
  )
}

/** Puts a removed preset back where it was. A name or an id taken in the meantime is changed. */
export function restorePreset(
  presets: readonly Preset[],
  preset: Preset,
  index: number,
  makeId: () => string,
): Outcome<Preset> {
  if (presets.length >= PRESET_LIMITS.count) return fail('limit')
  const restored: Preset = {
    id: presets.some((other) => other.id === preset.id) ? makeId() : preset.id,
    name: uniqueName(preset.name, namesOf(presets)),
    settings: preset.settings,
  }
  const at = Math.min(Math.max(index, 0), presets.length)
  return done([...presets.slice(0, at), restored, ...presets.slice(at)], restored)
}

/**
 * Appends imported entries after the existing presets. Existing presets are never changed or
 * replaced: an imported name that is taken becomes `name 2`. What does not fit under the limit is
 * left out, and the value says how many were.
 */
export function addImported(
  presets: readonly Preset[],
  entries: readonly ReadEntry[],
  makeId: () => string,
): Outcome<{ added: Preset[]; left: number }> {
  const room = Math.max(0, PRESET_LIMITS.count - presets.length)
  const used = namesOf(presets)
  const added = entries.slice(0, room).map((entry): Preset => {
    const name = uniqueName(entry.name, used)
    used.add(nameKey(name))
    return { id: makeId(), name, settings: entry.settings }
  })
  return done([...presets, ...added], { added, left: entries.length - added.length })
}
