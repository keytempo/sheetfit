import { readU32, throwIfAborted, type Bytes } from './bytes'
import { readTiffOrientation } from './exif'

export type PngColorType = 0 | 2 | 3 | 4 | 6

export interface PngInfo {
  width: number
  height: number
  bitDepth: 1 | 2 | 4 | 8 | 16
  colorType: PngColorType
  interlaced: boolean
  /** RGB triples, for colour type 3. */
  palette: Uint8Array | null
  /** The tRNS chunk: alpha per palette entry, or the colour that counts as transparent. */
  transparency: Uint8Array | null
  /** The iCCP chunk's zlib-compressed colour profile, as stored in the file. */
  compressedProfile: Bytes | null
  /** True when an eXIf chunk asks for the picture to be turned or mirrored. */
  hasOrientation: boolean
  /** The IDAT chunks' data in file order. Together they are one zlib stream of filtered scanlines. */
  idat: Bytes[]
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const CHANNELS: Record<PngColorType, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Reads the chunks of a PNG file. Returns null when it is not a well-formed PNG. */
export function parsePng(bytes: Bytes): PngInfo | null {
  if (bytes.length < 33 || SIGNATURE.some((value, i) => bytes[i] !== value)) return null

  let header: Pick<PngInfo, 'width' | 'height' | 'bitDepth' | 'colorType' | 'interlaced'> | null =
    null
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  let compressedProfile: Bytes | null = null
  let hasOrientation = false
  const idat: Bytes[] = []

  let position = 8
  while (position + 12 <= bytes.length) {
    const length = readU32(bytes, position)
    const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8))
    const start = position + 8
    const end = start + length
    if (end + 4 > bytes.length) return null
    const data = bytes.subarray(start, end)

    if (type === 'IHDR' && length === 13) {
      header = {
        width: readU32(data, 0),
        height: readU32(data, 4),
        bitDepth: data[8] as PngInfo['bitDepth'],
        colorType: data[9] as PngColorType,
        interlaced: data[12] === 1,
      }
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'tRNS') {
      transparency = data
    } else if (type === 'iCCP') {
      // Profile name, a zero byte, the compression method (always 0), then the zlib stream.
      const nameEnd = data.indexOf(0)
      if (nameEnd >= 0 && data[nameEnd + 1] === 0) compressedProfile = data.subarray(nameEnd + 2)
    } else if (type === 'eXIf') {
      hasOrientation = readTiffOrientation(data, 0, data.length) !== 1
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    position = end + 4
  }

  if (!header || idat.length === 0 || header.width < 1 || header.height < 1) return null
  if (!(header.colorType in CHANNELS) || ![1, 2, 4, 8, 16].includes(header.bitDepth)) return null
  if (header.colorType === 3 && (!palette || header.bitDepth === 16)) return null
  return { ...header, palette, transparency, compressedProfile, hasOrientation, idat }
}

/** Samples per pixel: 1 for gray and palette, 2 with alpha, 3 for colour, 4 for colour with alpha. */
export const channelsOf = (info: Pick<PngInfo, 'colorType'>) => CHANNELS[info.colorType]

export const rowBytesOf = (width: number, channels: number, bitDepth: number) =>
  Math.ceil((width * channels * bitDepth) / 8)

/** Undoes one scanline's filter in place. `previous` is the finished line above, or null. */
function unfilter(type: number, line: Bytes, previous: Bytes | null, step: number) {
  const length = line.length
  switch (type) {
    case 0:
      return
    case 1:
      for (let i = step; i < length; i++) line[i] = (line[i] + line[i - step]) & 0xff
      return
    case 2:
      if (previous) for (let i = 0; i < length; i++) line[i] = (line[i] + previous[i]) & 0xff
      return
    case 3:
      for (let i = 0; i < length; i++) {
        const left = i >= step ? line[i - step] : 0
        const up = previous ? previous[i] : 0
        line[i] = (line[i] + ((left + up) >> 1)) & 0xff
      }
      return
    case 4:
      for (let i = 0; i < length; i++) {
        const left = i >= step ? line[i - step] : 0
        const up = previous ? previous[i] : 0
        const upLeft = previous && i >= step ? previous[i - step] : 0
        const estimate = left + up - upLeft
        const distanceLeft = Math.abs(estimate - left)
        const distanceUp = Math.abs(estimate - up)
        const distanceUpLeft = Math.abs(estimate - upLeft)
        const predictor =
          distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
            ? left
            : distanceUp <= distanceUpLeft
              ? up
              : upLeft
        line[i] = (line[i] + predictor) & 0xff
      }
      return
    default:
      throw new Error('The PNG file uses an unknown scanline filter')
  }
}

/** About how many bytes of scanlines one yielded chunk holds. */
const CHUNK_BYTES = 1 << 21

/**
 * Inflates and unfilters a PNG that is not interlaced, yielding the scanlines as they are stored
 * (packed, in the file's bit depth), top to bottom, a few rows per chunk. Only the compressed file,
 * the line being decoded and one chunk are in memory, however large the image is.
 */
export async function* pngRows(info: PngInfo, signal?: AbortSignal): AsyncGenerator<Bytes> {
  const channels = channelsOf(info)
  const rowBytes = rowBytesOf(info.width, channels, info.bitDepth)
  const step = Math.max(1, (channels * info.bitDepth) >> 3)
  const rowsPerChunk = Math.max(1, Math.floor(CHUNK_BYTES / rowBytes))

  const stream = new DecompressionStream('deflate')
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  const writing = (async () => {
    for (const part of info.idat) await writer.write(new Uint8Array(part))
    await writer.close()
  })()
  // A damaged stream rejects both sides; the reader reports it, so this one stays quiet.
  writing.catch(() => undefined)

  const tagged = new Uint8Array(rowBytes + 1)
  let filled = 0
  let previous: Bytes | null = null
  let batch = new Uint8Array(Math.min(rowsPerChunk, info.height) * rowBytes)
  let batchRows = 0
  let rowsDone = 0

  try {
    for (;;) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      let offset = 0
      while (offset < value.length && rowsDone < info.height) {
        const take = Math.min(tagged.length - filled, value.length - offset)
        tagged.set(value.subarray(offset, offset + take), filled)
        filled += take
        offset += take
        if (filled < tagged.length) continue

        filled = 0
        const line = batch.subarray(batchRows * rowBytes, (batchRows + 1) * rowBytes)
        line.set(tagged.subarray(1))
        unfilter(tagged[0], line, previous, step)
        previous = line
        batchRows += 1
        rowsDone += 1
        if (batchRows === rowsPerChunk || rowsDone === info.height) {
          yield batch.subarray(0, batchRows * rowBytes)
          batch = new Uint8Array(Math.min(rowsPerChunk, info.height - rowsDone) * rowBytes)
          batchRows = 0
        }
      }
      if (rowsDone === info.height) break
    }
    if (rowsDone !== info.height) throw new Error('The PNG file is cut short')
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
