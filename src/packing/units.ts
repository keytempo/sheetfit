/**
 * Everything inside the packer is an integer number of micrometres. Integers make every
 * comparison exact, so floating-point drift can never create an overlap or a spurious
 * "does not fit". Sizes are rounded to the nearest micrometre, which is far below what any
 * printer resolves.
 */
export const UM_PER_MM = 1000

/** The longest sheet side accepted (10 m). It keeps every area sum far below 2^53. */
export const MAX_SIDE_UM = 10_000_000

/** A length in millimetres as whole micrometres, or null when it is not a finite number >= 0. */
export function lengthToUm(mm: number): number | null {
  if (!Number.isFinite(mm) || mm < 0) return null
  return Math.min(MAX_SIDE_UM, Math.round(mm * UM_PER_MM))
}

/**
 * A piece side in micrometres, or null when it is not a finite number > 0. A side that rounds to
 * zero becomes one micrometre, so a tiny but real piece is never discarded. A side beyond the
 * longest sheet side is capped one micrometre above it, which keeps it "too large".
 */
export function sizeToUm(mm: number): number | null {
  if (!Number.isFinite(mm) || mm <= 0) return null
  return Math.min(MAX_SIDE_UM + 1, Math.max(1, Math.round(mm * UM_PER_MM)))
}

export const umToMm = (um: number) => um / UM_PER_MM
