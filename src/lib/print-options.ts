import type { Unit } from './units'

export type SheetSizeId = 'a3' | 'a4' | 'a5' | 'a6' | 'letter' | 'legal' | 'tabloid' | 'custom'
export type Orientation = 'portrait' | 'landscape' | 'auto'
export type BaseSizeMode = 'width' | 'height' | 'longest' | 'native'
export type Ordering = 'optimize' | 'strict'

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
