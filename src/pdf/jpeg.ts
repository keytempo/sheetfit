import { readU16 } from './bytes'
import { readTiffOrientation } from './exif'
import type { ExifOrientation } from './matrix'

/** What a PDF needs to know about a JPEG file in order to embed its bytes as they are. */
export interface JpegInfo {
  width: number
  height: number
  /** 1 is gray, 3 is RGB (or YCbCr), 4 is CMYK (or YCCK). */
  components: 1 | 3 | 4
  /** Adobe's colour transform flag, or null when the file has no Adobe marker. */
  adobeTransform: number | null
  orientation: ExifOrientation
  /** The embedded ICC colour profile, joined from its parts, or null. */
  icc: Uint8Array<ArrayBuffer> | null
}

const SOS = 0xda
const EOI = 0xd9
/** Frames PDF's DCTDecode filter reads: baseline, extended sequential and progressive Huffman. */
const SUPPORTED_FRAMES = new Set([0xc0, 0xc1, 0xc2])
/** Every other kind of frame (lossless, arithmetic coded, hierarchical) is one a PDF cannot take. */
const OTHER_FRAMES = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

const hasPrefix = (bytes: Uint8Array, offset: number, text: string) =>
  [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0))

/** Joins the parts of an ICC profile that is split over several APP2 segments. */
function joinProfile(
  parts: Map<number, Uint8Array>,
  count: number,
): Uint8Array<ArrayBuffer> | null {
  if (count < 1 || parts.size !== count) return null
  let length = 0
  for (let i = 1; i <= count; i++) {
    const part = parts.get(i)
    if (!part) return null
    length += part.length
  }
  const profile = new Uint8Array(length)
  let offset = 0
  for (let i = 1; i <= count; i++) {
    const part = parts.get(i)!
    profile.set(part, offset)
    offset += part.length
  }
  return profile
}

/**
 * Reads the headers of a JPEG file. Returns null for anything a PDF cannot embed untouched: not a
 * JPEG, a frame type the DCTDecode filter does not read, more than 8 bits per sample, or an
 * unusual number of components. The caller then stores the decoded pixels instead.
 */
export function parseJpeg(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let frame: { width: number; height: number; components: number } | null = null
  let adobeTransform: number | null = null
  let orientation: ExifOrientation = 1
  const profileParts = new Map<number, Uint8Array>()
  let profileCount = 0

  let position = 2
  while (position + 4 <= bytes.length) {
    if (bytes[position] !== 0xff) return null
    const marker = bytes[position + 1]
    if (marker === 0xff) {
      position += 1
      continue
    }
    // Markers without a length: restart markers, the temporary marker and the start of image.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      position += 2
      continue
    }
    if (marker === SOS || marker === EOI) break

    const length = readU16(bytes, position + 2)
    const start = position + 4
    const end = position + 2 + length
    if (length < 2 || end > bytes.length) return null

    if (SUPPORTED_FRAMES.has(marker)) {
      if (frame || length < 8 || bytes[start] !== 8) return null
      frame = {
        height: readU16(bytes, start + 1),
        width: readU16(bytes, start + 3),
        components: bytes[start + 5],
      }
    } else if (OTHER_FRAMES.has(marker)) {
      return null
    } else if (marker === 0xe1 && hasPrefix(bytes, start, 'Exif\0\0')) {
      orientation = readTiffOrientation(bytes, start + 6, end)
    } else if (marker === 0xe2 && hasPrefix(bytes, start, 'ICC_PROFILE\0') && end - start > 14) {
      profileParts.set(bytes[start + 12], bytes.subarray(start + 14, end))
      profileCount = bytes[start + 13]
    } else if (marker === 0xee && hasPrefix(bytes, start, 'Adobe') && length >= 14) {
      adobeTransform = bytes[start + 11]
    }
    position = end
  }

  if (!frame || frame.width < 1 || frame.height < 1) return null
  if (frame.components !== 1 && frame.components !== 3 && frame.components !== 4) return null
  return {
    width: frame.width,
    height: frame.height,
    components: frame.components,
    adobeTransform,
    orientation,
    icc: joinProfile(profileParts, profileCount),
  }
}
