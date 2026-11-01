import { clamp } from './utils'
import { UNITS, type Unit } from './units'

const SHEET_SIZE_IDS = ['a3', 'a4', 'a5', 'a6', 'letter', 'legal', 'tabloid', 'custom'] as const
const ORIENTATIONS = ['portrait', 'landscape', 'auto'] as const
const BASE_SIZE_MODES = ['width', 'height', 'longest', 'native'] as const
const ORDERINGS = ['optimize', 'strict'] as const

export type SheetSizeId = (typeof SHEET_SIZE_IDS)[number]
export type Orientation = (typeof ORIENTATIONS)[number]
export type BaseSizeMode = (typeof BASE_SIZE_MODES)[number]
export type Ordering = (typeof ORDERINGS)[number]

/** Every value that is a length is stored in millimetres, whatever unit is displayed. */
export interface PrintOptions {
  unit: Unit
  sheetSize: SheetSizeId
  customWidth: number
  customHeight: number
  orientation: Orientation
  baseMode: BaseSizeMode
  baseLength: number
  baseDpi: number
  margin: number
  gap: number
  allowRotation: boolean
  ordering: Ordering
  cutGuides: boolean
  showMargins: boolean
  showSheetNumbers: boolean
}

/** The options that decide how large a photo prints and where it is placed. The rest only change how things look. */
export type LayoutOptions = Pick<
  PrintOptions,
  | 'sheetSize'
  | 'customWidth'
  | 'customHeight'
  | 'orientation'
  | 'baseMode'
  | 'baseLength'
  | 'baseDpi'
  | 'margin'
  | 'gap'
  | 'allowRotation'
  | 'ordering'
>

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  unit: 'mm',
  sheetSize: 'a4',
  customWidth: 210,
  customHeight: 297,
  orientation: 'portrait',
  baseMode: 'native',
  baseLength: 50,
  baseDpi: 300,
  margin: 5,
  gap: 0,
  allowRotation: true,
  ordering: 'optimize',
  cutGuides: false,
  showMargins: true,
  showSheetNumbers: true,
}

export const LIMITS = {
  copies: { min: 0, max: 999 },
  percent: { min: 10, max: 300 },
  sheetSide: { min: 30, max: 1500 },
  baseLength: { min: 1, max: 1000 },
  dpi: { min: 30, max: 1200 },
  margin: { min: 0, max: 50 },
  gap: { min: 0, max: 30 },
} as const

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.find((item) => item === value) ?? fallback

const bounded = (value: unknown, range: { min: number; max: number }, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, range.min, range.max)
    : fallback

const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/**
 * Turns whatever was saved in the browser into valid options. Settings come back from storage that
 * a person, an older version or another tab may have changed, so every value is checked: one that is
 * missing, of the wrong kind or out of range falls back to its default or its nearest limit, and
 * never reaches the sheet and size calculations.
 */
export function sanitizeOptions(saved: unknown): PrintOptions {
  const source =
    typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const d = DEFAULT_PRINT_OPTIONS
  return {
    unit: pick(source.unit, UNITS, d.unit),
    sheetSize: pick(source.sheetSize, SHEET_SIZE_IDS, d.sheetSize),
    customWidth: bounded(source.customWidth, LIMITS.sheetSide, d.customWidth),
    customHeight: bounded(source.customHeight, LIMITS.sheetSide, d.customHeight),
    orientation: pick(source.orientation, ORIENTATIONS, d.orientation),
    baseMode: pick(source.baseMode, BASE_SIZE_MODES, d.baseMode),
    baseLength: bounded(source.baseLength, LIMITS.baseLength, d.baseLength),
    baseDpi: bounded(source.baseDpi, LIMITS.dpi, d.baseDpi),
    margin: bounded(source.margin, LIMITS.margin, d.margin),
    gap: bounded(source.gap, LIMITS.gap, d.gap),
    allowRotation: flag(source.allowRotation, d.allowRotation),
    ordering: pick(source.ordering, ORDERINGS, d.ordering),
    cutGuides: flag(source.cutGuides, d.cutGuides),
    showMargins: flag(source.showMargins, d.showMargins),
    showSheetNumbers: flag(source.showSheetNumbers, d.showSheetNumbers),
  }
}
