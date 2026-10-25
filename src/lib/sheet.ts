import { LIMITS, type Orientation, type PrintOptions, type SheetSizeId } from './print-options'

export type ResolvedOrientation = 'portrait' | 'landscape'

export interface SheetSize {
  width: number
  height: number
}

interface SheetPreset extends SheetSize {
  id: Exclude<SheetSizeId, 'custom'>
  label: string
}

/** Portrait dimensions in millimetres. */
export const SHEET_PRESETS: readonly SheetPreset[] = [
  { id: 'a3', label: 'A3', width: 297, height: 420 },
  { id: 'a4', label: 'A4', width: 210, height: 297 },
  { id: 'a5', label: 'A5', width: 148, height: 210 },
  { id: 'a6', label: 'A6', width: 105, height: 148 },
  { id: 'letter', label: 'Letter', width: 215.9, height: 279.4 },
  { id: 'legal', label: 'Legal', width: 215.9, height: 355.6 },
  { id: 'tabloid', label: 'Tabloid', width: 279.4, height: 431.8 },
]

/** The smallest usable width and height the margin is ever allowed to leave. */
const MIN_USABLE_SIDE = 10

/** Automatic currently resolves to portrait; the packer will take over this decision later. */
export function resolveOrientation(orientation: Orientation): ResolvedOrientation {
  return orientation === 'landscape' ? 'landscape' : 'portrait'
}

/** The sheet as it comes out of the printer tray: the shorter side is always the width. */
export function getPortraitSize(options: PrintOptions): SheetSize {
  const preset = SHEET_PRESETS.find((p) => p.id === options.sheetSize)
  const a = preset?.width ?? options.customWidth
  const b = preset?.height ?? options.customHeight
  return { width: Math.min(a, b), height: Math.max(a, b) }
}

export function getMaxMargin(options: PrintOptions) {
  const { width } = getPortraitSize(options)
  return Math.max(0, Math.min(LIMITS.margin.max, (width - MIN_USABLE_SIDE) / 2))
}

export interface SheetGeometry {
  label: string
  orientation: ResolvedOrientation
  width: number
  height: number
  margin: number
  gap: number
  usableWidth: number
  usableHeight: number
}

/**
 * The single place where sheet size, orientation and margin are combined.
 * The stored margin is clamped here, so shrinking the sheet can never leave a negative usable area.
 */
export function getSheetGeometry(options: PrintOptions): SheetGeometry {
  const portrait = getPortraitSize(options)
  const orientation = resolveOrientation(options.orientation)
  const landscape = orientation === 'landscape'
  const width = landscape ? portrait.height : portrait.width
  const height = landscape ? portrait.width : portrait.height
  const margin = Math.min(options.margin, getMaxMargin(options))
  const preset = SHEET_PRESETS.find((p) => p.id === options.sheetSize)

  return {
    label: preset?.label ?? 'Custom',
    orientation,
    width,
    height,
    margin,
    gap: options.gap,
    usableWidth: width - 2 * margin,
    usableHeight: height - 2 * margin,
  }
}
