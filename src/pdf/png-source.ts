import type { Bytes } from './bytes'
import { pngRows, rowBytesOf, type PngInfo } from './png'
import type { PixelSource } from './raster'

const KINDS = { 0: 'gray', 2: 'rgb', 3: 'indexed', 4: 'gray-alpha', 6: 'rgba' } as const

/** Applies `convert` to every chunk of scanlines. */
async function* mapChunks(
  rows: AsyncIterable<Bytes> | Iterable<Bytes>,
  convert: (chunk: Bytes) => Bytes,
): AsyncGenerator<Bytes> {
  for await (const chunk of rows) yield convert(chunk)
}

/** The sample at index `i` of a packed row of 1, 2, 4 or 8 bit samples. */
function packedSample(row: Uint8Array, i: number, bits: number) {
  if (bits === 8) return row[i]
  const perByte = 8 / bits
  const shift = 8 - bits * ((i % perByte) + 1)
  return (row[Math.floor(i / perByte)] >> shift) & ((1 << bits) - 1)
}

/** A palette image with a tRNS chunk becomes RGBA: every index turns into a colour and an alpha. */
function paletteWithAlpha(info: PngInfo, signal?: AbortSignal): PixelSource {
  const palette = info.palette!
  const alphaOf = info.transparency!
  const rowBytes = rowBytesOf(info.width, 1, info.bitDepth)
  return {
    width: info.width,
    height: info.height,
    kind: 'rgba',
    bits: 8,
    rows: () =>
      mapChunks(pngRows(info, signal), (chunk) => {
        const rows = chunk.length / rowBytes
        const out = new Uint8Array(rows * info.width * 4)
        let o = 0
        for (let r = 0; r < rows; r++) {
          const row = chunk.subarray(r * rowBytes, (r + 1) * rowBytes)
          for (let x = 0; x < info.width; x++) {
            const index = packedSample(row, x, info.bitDepth)
            out[o++] = palette[index * 3]
            out[o++] = palette[index * 3 + 1]
            out[o++] = palette[index * 3 + 2]
            out[o++] = index < alphaOf.length ? alphaOf[index] : 255
          }
        }
        return out
      }),
  }
}

/** A gray or RGB image with a tRNS colour key gets an alpha channel: the key colour is clear. */
function keyedColour(info: PngInfo, signal?: AbortSignal): PixelSource {
  const gray = info.colorType === 0
  const samples = gray ? 1 : 3
  const sample = info.bitDepth / 8
  const key = info.transparency!
  const pixelBytes = samples * sample
  const keyBytes = new Uint8Array(pixelBytes)
  for (let k = 0; k < samples; k++) {
    // Each key value is stored in two bytes; 8-bit images use the low one.
    if (sample === 1) keyBytes[k] = key[k * 2 + 1]
    else {
      keyBytes[k * 2] = key[k * 2]
      keyBytes[k * 2 + 1] = key[k * 2 + 1]
    }
  }
  return {
    width: info.width,
    height: info.height,
    kind: gray ? 'gray-alpha' : 'rgba',
    bits: info.bitDepth,
    rows: () =>
      mapChunks(pngRows(info, signal), (chunk) => {
        const pixels = chunk.length / pixelBytes
        const out = new Uint8Array(pixels * (pixelBytes + sample))
        let o = 0
        for (let p = 0; p < pixels; p++) {
          const at = p * pixelBytes
          let transparent = true
          for (let k = 0; k < pixelBytes; k++) {
            out[o++] = chunk[at + k]
            if (chunk[at + k] !== keyBytes[k]) transparent = false
          }
          for (let k = 0; k < sample; k++) out[o++] = transparent ? 0 : 255
        }
        return out
      }),
  }
}

/**
 * Reads a PNG's pixels exactly as stored. Returns null for what is better left to the browser:
 * interlaced files, files that ask for a rotation, and gray files below 8 bits with a colour key.
 */
export function pngSource(info: PngInfo, signal?: AbortSignal): PixelSource | null {
  if (info.interlaced || info.hasOrientation) return null
  const kind = KINDS[info.colorType]

  if (info.transparency) {
    if (info.colorType === 3) return paletteWithAlpha(info, signal)
    if ((info.colorType === 0 || info.colorType === 2) && info.bitDepth >= 8)
      return keyedColour(info, signal)
    if (info.colorType === 0 || info.colorType === 2) return null
  }

  const plain = info.colorType === 0 || info.colorType === 2 || info.colorType === 3
  const length = info.idat.reduce((sum, part) => sum + part.length, 0)
  return {
    width: info.width,
    height: info.height,
    kind,
    bits: info.bitDepth,
    palette: info.palette ?? undefined,
    rows: () => pngRows(info, signal),
    original: plain ? { parts: info.idat, length } : undefined,
  }
}
