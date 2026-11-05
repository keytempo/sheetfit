import { sanitizeOptions, type PrintOptions } from '../print-options'
import { isRecord, PRESET_SETTING_KEYS, type Preset, type PresetSettings } from './schema'

/** The part of the print options a preset keeps. */
export function settingsFromOptions(options: PrintOptions): PresetSettings {
  return {
    sheetSize: options.sheetSize,
    customWidth: options.customWidth,
    customHeight: options.customHeight,
    orientation: options.orientation,
    baseMode: options.baseMode,
    baseLength: options.baseLength,
    baseDpi: options.baseDpi,
    margin: options.margin,
    gap: options.gap,
    allowRotation: options.allowRotation,
    ordering: options.ordering,
    cutGuides: options.cutGuides,
  }
}

export interface ReadSettings {
  settings: PresetSettings
  /** True when a value that was there had to be replaced or brought inside its limits. */
  adjusted: boolean
}

/**
 * Turns whatever was stored or imported as a preset's settings into valid ones, with the same rules
 * as the options themselves (`sanitizeOptions`). Settings that are missing, because an older
 * version did not have them, take their defaults. An object with none of the settings in it is not
 * a preset's settings at all, so it gives `null`.
 */
export function readSettings(raw: unknown): ReadSettings | null {
  if (!isRecord(raw)) return null
  const present = PRESET_SETTING_KEYS.filter((key) => Object.hasOwn(raw, key))
  if (present.length === 0) return null
  const settings = settingsFromOptions(sanitizeOptions(raw))
  return { settings, adjusted: present.some((key) => !Object.is(settings[key], raw[key])) }
}

/**
 * The settings as they act. A custom width and height do nothing while a standard sheet is chosen,
 * and a length or a DPI does nothing in the base-size mode that does not use it, so a difference in
 * one of those is not a difference in what gets printed.
 */
function effective(settings: PresetSettings): PresetSettings {
  const custom = settings.sheetSize === 'custom'
  const native = settings.baseMode === 'native'
  return {
    ...settings,
    customWidth: custom ? settings.customWidth : 0,
    customHeight: custom ? settings.customHeight : 0,
    baseLength: native ? 0 : settings.baseLength,
    baseDpi: native ? settings.baseDpi : 0,
  }
}

export function sameSettings(a: PresetSettings, b: PresetSettings): boolean {
  const left = effective(a)
  const right = effective(b)
  return PRESET_SETTING_KEYS.every((key) => left[key] === right[key])
}

export interface ActivePreset {
  preset: Preset
  /** True when the current settings are not the preset's any more. */
  modified: boolean
}

/**
 * Which preset the current settings belong to. The one that was last applied or saved counts while
 * it matches; settings that match another preset exactly belong to that one; settings that match
 * none belong to the last applied preset, modified, or to no preset at all.
 */
export function resolveActive(
  presets: readonly Preset[],
  activeId: string | null,
  current: PresetSettings,
): ActivePreset | null {
  const chosen = presets.find((preset) => preset.id === activeId)
  if (chosen && sameSettings(chosen.settings, current)) return { preset: chosen, modified: false }
  const match = presets.find((preset) => sameSettings(preset.settings, current))
  if (match) return { preset: match, modified: false }
  return chosen ? { preset: chosen, modified: true } : null
}
