import type { ExportImage, ExportInput } from '@/lib/export-types'
import type { LayoutResult, PieceSpec, PlacedPiece } from '@/lib/layout-types'
import { Random } from '../../packing/random'
import { concat, type Bytes } from '../bytes'
import { deflate } from '../deflate'

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const u32 = (value: number): Bytes =>
  new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255])

const text = (value: string): Bytes => new Uint8Array([...value].map((char) => char.charCodeAt(0)))

function chunk(type: string, data: Uint8Array): Bytes {
  const body = concat([text(type), data])
  return concat([u32(data.length), body, u32(crc32(body))])
}

/** Applies PNG filter `type` to a row, given the unfiltered row above. */
function filterWith(
  type: number,
  line: Uint8Array,
  previous: Uint8Array | null,
  step: number,
): Bytes {
  const out = new Uint8Array(line.length)
  for (let i = 0; i < line.length; i++) {
    const a = i >= step ? line[i - step] : 0
    const b = previous ? previous[i] : 0
    const c = previous && i >= step ? previous[i - step] : 0
    let predicted = 0
    if (type === 1) predicted = a
    else if (type === 2) predicted = b
    else if (type === 3) predicted = (a + b) >> 1
    else if (type === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    out[i] = (line[i] - predicted) & 255
  }
  return out
}

export interface PngSpec {
  width: number
  height: number
  colorType: 0 | 2 | 3 | 4 | 6
  bitDepth: 1 | 2 | 4 | 8 | 16
  /** Packed scanlines exactly as a decoder should return them. */
  rows: Uint8Array[]
  palette?: Uint8Array
  transparency?: Uint8Array
  /** A raw ICC profile, written as an iCCP chunk. */
  profile?: Bytes
  /** A TIFF block, written as an eXIf chunk. */
  exif?: Bytes
  /** Seed for the random scanline filters. */
  seed?: number
}

export const channelsFor = (colorType: PngSpec['colorType']) =>
  ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType]

/** Random packed scanlines for the given shape. Palette images use a full palette, so any value is valid. */
export function randomRows(
  width: number,
  height: number,
  colorType: PngSpec['colorType'],
  bitDepth: PngSpec['bitDepth'],
  seed: number,
): Uint8Array[] {
  const random = new Random(seed)
  const rowBytes = Math.ceil((width * channelsFor(colorType) * bitDepth) / 8)
  return Array.from({ length: height }, () => {
    const row = new Uint8Array(rowBytes)
    for (let i = 0; i < rowBytes; i++) row[i] = random.int(256)
    return row
  })
}

/** Encodes a non-interlaced PNG with a random filter on every scanline. */
export async function encodePng(spec: PngSpec): Promise<Bytes> {
  const random = new Random(spec.seed ?? 1)
  const step = Math.max(1, (channelsFor(spec.colorType) * spec.bitDepth) >> 3)
  const filtered: Bytes[] = []
  let previous: Uint8Array | null = null
  for (const row of spec.rows) {
    const type = random.int(5)
    filtered.push(concat([new Uint8Array([type]), filterWith(type, row, previous, step)]))
    previous = row
  }
  const compressed = concat(await deflate([concat(filtered)]))
  const header = concat([
    u32(spec.width),
    u32(spec.height),
    new Uint8Array([spec.bitDepth, spec.colorType, 0, 0, 0]),
  ])
  const chunks = [chunk('IHDR', header)]
  if (spec.profile) {
    chunks.push(
      chunk(
        'iCCP',
        concat([text('p'), new Uint8Array([0, 0]), concat(await deflate([spec.profile]))]),
      ),
    )
  }
  if (spec.exif) chunks.push(chunk('eXIf', spec.exif))
  if (spec.palette) chunks.push(chunk('PLTE', spec.palette))
  if (spec.transparency) chunks.push(chunk('tRNS', spec.transparency))
  // Two IDAT chunks, so reading across a chunk boundary is exercised.
  const half = Math.floor(compressed.length / 2)
  chunks.push(chunk('IDAT', compressed.subarray(0, half)), chunk('IDAT', compressed.subarray(half)))
  chunks.push(chunk('IEND', new Uint8Array(0)))
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks])
}

export interface JpegSpec {
  width: number
  height: number
  components?: 1 | 3 | 4
  /** The SOF marker: 0xc0 baseline, 0xc2 progressive, 0xc3 lossless, 0xc9 arithmetic. */
  frame?: number
  precision?: number
  orientation?: number
  /** Adobe's colour transform flag; omitted means no Adobe marker. */
  adobeTransform?: number
  profile?: Uint8Array
  /** Splits the profile over this many APP2 segments. */
  profileParts?: number
  bigEndianExif?: boolean
}

const segment = (marker: number, data: Uint8Array): Bytes =>
  concat([new Uint8Array([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255]), data])

/**
 * A file that has a JPEG's headers and a few bytes of scan data. A PDF only needs the headers to
 * embed a JPEG untouched, so this stands in for a photo wherever pixels are not looked at.
 */
export function fakeJpeg(spec: JpegSpec): Bytes {
  const components = spec.components ?? 3
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]
  if (spec.orientation !== undefined) {
    const big = spec.bigEndianExif ?? false
    const short = (value: number) => (big ? [value >> 8, value & 255] : [value & 255, value >> 8])
    const long = (value: number) =>
      big
        ? [value >>> 24, (value >> 16) & 255, (value >> 8) & 255, value & 255]
        : [value & 255, (value >> 8) & 255, (value >> 16) & 255, value >>> 24]
    const tiff = [
      ...(big ? [0x4d, 0x4d] : [0x49, 0x49]),
      ...short(42),
      ...long(8),
      ...short(1),
      ...short(0x0112),
      ...short(3),
      ...long(1),
      ...short(spec.orientation),
      0,
      0,
      ...long(0),
    ]
    parts.push(segment(0xe1, new Uint8Array([...text('Exif'), 0, 0, ...tiff])))
  }
  if (spec.profile) {
    const count = spec.profileParts ?? 1
    const size = Math.ceil(spec.profile.length / count)
    for (let i = 0; i < count; i++) {
      parts.push(
        segment(
          0xe2,
          concat([
            text('ICC_PROFILE'),
            new Uint8Array([0, i + 1, count]),
            spec.profile.subarray(i * size, (i + 1) * size),
          ]),
        ),
      )
    }
  }
  if (spec.adobeTransform !== undefined) {
    parts.push(
      segment(
        0xee,
        concat([text('Adobe'), new Uint8Array([0, 100, 0, 0, 0, 0, spec.adobeTransform])]),
      ),
    )
  }
  const frame = [
    spec.precision ?? 8,
    spec.height >> 8,
    spec.height & 255,
    spec.width >> 8,
    spec.width & 255,
    components,
  ]
  for (let c = 0; c < components; c++) frame.push(c + 1, 0x11, 0)
  parts.push(segment(spec.frame ?? 0xc0, new Uint8Array(frame)))
  parts.push(
    segment(
      0xda,
      new Uint8Array([components, ...Array.from({ length: components * 2 }, () => 0), 0, 63, 0]),
    ),
  )
  parts.push(new Uint8Array([0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]))
  return concat(parts)
}

/** An ICC profile that is only a header: enough to tell its colour space and version. */
export function fakeProfile(space: 'GRAY' | 'RGB ' | 'CMYK', version = 2): Bytes {
  const profile = new Uint8Array(160)
  profile[8] = version
  profile.set(text(space), 16)
  profile.set(text('acsp'), 36)
  profile.set(text('SHEETFIT-TEST'), 100)
  return profile
}

/** Compares two byte arrays in one pass; `toEqual` is far too slow for megabytes. */
export function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const makeFile = (bytes: Uint8Array<ArrayBuffer>, name: string) => new File([bytes], name)

export function exportImage(id: string, file: File, width: number, height: number): ExportImage {
  return { id, name: file.name, file, width, height }
}

/** One placed piece for a hand-made layout, in millimetres from the sheet's top-left corner. */
export interface HandPiece {
  imageId: string
  x: number
  y: number
  /** The footprint on the sheet, after any rotation. */
  width: number
  height: number
  rotated?: boolean
}

/** A layout assembled by hand: each inner array is one sheet. */
export function handLayout(
  sheets: HandPiece[][],
  sheetWidth = 210,
  sheetHeight = 297,
  margin = 10,
): LayoutResult {
  let count = 0
  const placedSheets = sheets.map((pieces, index) => {
    const placed: PlacedPiece[] = pieces.map((p) => {
      count += 1
      const spec: PieceSpec = {
        id: `${p.imageId}:${count}`,
        imageId: p.imageId,
        copy: count,
        copies: count,
        width: p.rotated ? p.height : p.width,
        height: p.rotated ? p.width : p.height,
      }
      return {
        piece: spec,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        rotated: p.rotated ?? false,
      }
    })
    const usable = (sheetWidth - 2 * margin) * (sheetHeight - 2 * margin)
    const used = placed.reduce((sum, p) => sum + p.width * p.height, 0)
    return {
      index,
      pieces: placed,
      stats: {
        pieceCount: placed.length,
        usableArea: usable,
        usedArea: used,
        wastedArea: usable - used,
        fillPercent: (used / usable) * 100,
      },
    }
  })
  return {
    orientation: sheetWidth > sheetHeight ? 'landscape' : 'portrait',
    sheetWidth,
    sheetHeight,
    margin,
    sheets: placedSheets,
    status: 'best-found',
    lowerBound: 1,
    unplaceable: [],
    totals: {
      sheetCount: placedSheets.length,
      pieceCount: count,
      usableArea: 0,
      usedArea: 0,
      wastedArea: 0,
      fillPercent: 0,
      fillPercentExceptLast: 0,
    },
  }
}

export const exportInput = (
  layout: LayoutResult,
  images: ExportImage[],
  cutGuides = false,
): ExportInput => ({ layout, images, cutGuides })
