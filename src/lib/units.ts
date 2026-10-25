export type Unit = 'mm' | 'cm' | 'in'

export const UNITS: readonly Unit[] = ['mm', 'cm', 'in']

const MM_PER_UNIT: Record<Unit, number> = { mm: 1, cm: 10, in: 25.4 }

/** Decimals kept when a length is shown in a read-only label. */
const LABEL_DECIMALS: Record<Unit, number> = { mm: 1, cm: 2, in: 2 }

/** Decimals kept when a length is shown in an editable field. */
export const FIELD_DECIMALS: Record<Unit, number> = { mm: 2, cm: 3, in: 3 }

export const mmToUnit = (mm: number, unit: Unit) => mm / MM_PER_UNIT[unit]

export const unitToMm = (value: number, unit: Unit) => value * MM_PER_UNIT[unit]

/** Formats a number with at most `maxDecimals` decimals and no trailing zeros. */
export function formatNumber(value: number, maxDecimals: number) {
  return Number(value.toFixed(maxDecimals)).toLocaleString('en-US', {
    maximumFractionDigits: maxDecimals,
    useGrouping: false,
  })
}

/** A single length in the chosen unit, without the unit suffix: 42.5 */
export function formatLength(mm: number, unit: Unit) {
  return formatNumber(mmToUnit(mm, unit), LABEL_DECIMALS[unit])
}

/** A width and height pair: 42.5 × 56 mm */
export function formatSize(widthMm: number, heightMm: number, unit: Unit) {
  return `${formatLength(widthMm, unit)} × ${formatLength(heightMm, unit)} ${unit}`
}

const AREA_DECIMALS: Record<Unit, number> = { mm: 0, cm: 1, in: 2 }

/** An area given in mm² shown in the chosen unit squared: 412.5 cm² */
export function formatArea(mm2: number, unit: Unit) {
  const factor = MM_PER_UNIT[unit] ** 2
  const decimals = AREA_DECIMALS[unit]
  const value = Number((mm2 / factor).toFixed(decimals))
  return `${value.toLocaleString('en-US', { maximumFractionDigits: decimals })} ${unit}²`
}
