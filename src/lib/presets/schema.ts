import type { PrintOptions } from '../print-options'

/**
 * The print options a preset keeps: everything that changes what is printed and how large a photo
 * comes out. Units and the two preview switches are left out on purpose; docs/presets.md says why.
 */
export const PRESET_SETTING_KEYS = [
  'sheetSize',
  'customWidth',
  'customHeight',
  'orientation',
  'baseMode',
  'baseLength',
  'baseDpi',
  'margin',
  'gap',
  'allowRotation',
  'ordering',
  'cutGuides',
] as const satisfies readonly (keyof PrintOptions)[]

export type PresetSettings = Pick<PrintOptions, (typeof PRESET_SETTING_KEYS)[number]>

export interface Preset {
  id: string
  name: string
  settings: PresetSettings
}

export const PRESET_LIMITS = {
  /** Presets kept. A longer list stops being something a menu can scan. */
  count: 50,
  /** Characters in a name, counted as code points. */
  nameLength: 40,
  /** The largest file the importer reads. 50 presets take about 20 kB. */
  importBytes: 512 * 1024,
  /** Entries looked at in a stored list or an imported file; the rest are counted, not read. */
  scanned: 1000,
} as const

/** Presets live under their own key, never inside the persisted print options (`sheetfit:v1`). */
export const STORAGE_KEY = 'sheetfit:presets'
export const STORAGE_VERSION = 1

/** The marker and schema version of an exported file. */
export const EXPORT_FORMAT = 'sheetfit-presets'
export const EXPORT_VERSION = 1

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export const isValidId = (value: unknown): value is string =>
  typeof value === 'string' && ID_PATTERN.test(value)

/** A random id. `getRandomValues` works on every page, unlike `randomUUID`, which needs HTTPS. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
