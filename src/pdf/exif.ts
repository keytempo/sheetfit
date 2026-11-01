import { readU16 } from './bytes'
import type { ExifOrientation } from './matrix'

/**
 * Reads the orientation (tag 0x0112) from the TIFF structure of an EXIF block. `start` is where
 * the TIFF header begins and every offset inside is relative to it. Returns 1 (upright) when there
 * is no valid tag.
 */
export function readTiffOrientation(
  bytes: Uint8Array,
  start: number,
  end: number,
): ExifOrientation {
  if (end - start < 8) return 1
  const little = bytes[start] === 0x49
  if (!little && bytes[start] !== 0x4d) return 1
  const u16 = (offset: number) => readU16(bytes, offset, little)
  const u32 = (offset: number) =>
    little
      ? (bytes[offset] |
          (bytes[offset + 1] << 8) |
          (bytes[offset + 2] << 16) |
          (bytes[offset + 3] << 24)) >>>
        0
      : ((bytes[offset] << 24) |
          (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3]) >>>
        0
  if (u16(start + 2) !== 42) return 1
  const directory = start + u32(start + 4)
  if (directory + 2 > end) return 1
  const entries = u16(directory)
  for (let i = 0; i < entries; i++) {
    const entry = directory + 2 + i * 12
    if (entry + 12 > end) return 1
    if (u16(entry) !== 0x0112) continue
    const value = u16(entry + 8)
    return value >= 1 && value <= 8 ? (value as ExifOrientation) : 1
  }
  return 1
}
