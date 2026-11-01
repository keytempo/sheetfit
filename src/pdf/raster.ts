import { throwIfAborted, type Bytes } from './bytes'
import { byteLength, deflate } from './deflate'

/** How a source stores one pixel. Every row is packed and unfiltered, exactly as decoded. */
export type SampleKind = 'gray' | 'indexed' | 'rgb' | 'gray-alpha' | 'rgba'

export interface PixelSource {
  width: number
  height: number
  kind: SampleKind
  /** Bits per sample: 1, 2, 4 for gray and palette images, 8 or 16 otherwise. */
  bits: 1 | 2 | 4 | 8 | 16
  /** RGB triples, for the indexed kind. */
  palette?: Uint8Array
  /** Whole scanlines, top to bottom, a few rows per chunk. It can be called more than once. */
  rows(): AsyncIterable<Bytes> | Iterable<Bytes>
  /**
   * The file's own compressed pixel data, when a PDF can read it as it is (a PNG without alpha and
   * without interlacing). It is kept when it turns out smaller than what is written here.
   */
  original?: { parts: readonly Bytes[]; length: number }
}

export type ColourSpaceKind = 'gray' | 'rgb' | 'indexed'

/** One compressed stream: its dictionary entries and bytes. */
export interface EncodedPlane {
  entries: string
  parts: readonly Bytes[]
  length: number
}

export interface RasterEncoding {
  width: number
  height: number
  colour: { space: ColourSpaceKind; bits: number; plane: EncodedPlane }
  /** The transparency as a separate gray image (an SMask), or null when every pixel is opaque. */
  alpha: { bits: number; plane: EncodedPlane } | null
}

interface EncodeOptions {
  /** False keeps colour stored as colour even when red, green and blue are always equal. */
  reduceGray?: boolean
  signal?: AbortSignal
  /** Called with the share of this image that is done, 0 to 1. */
  onProgress?: (fraction: number) => void
}

const CHANNELS: Record<SampleKind, number> = {
  gray: 1,
  indexed: 1,
  rgb: 3,
  'gray-alpha': 2,
  rgba: 4,
}

/** What the pixels turn out to need: the colour kinds only reduce, never grow. */
interface Plan {
  space: ColourSpaceKind
  alpha: boolean
}

/** Scans the pixels for the two lossless reductions: all opaque, and red equal to green and blue. */
async function analyse(source: PixelSource, signal?: AbortSignal) {
  const hasAlpha = source.kind === 'rgba' || source.kind === 'gray-alpha'
  const hasColour = source.kind === 'rgba' || source.kind === 'rgb'
  let opaque = true
  let gray = true
  const wide = source.bits === 16
  const stride = CHANNELS[source.kind] * (wide ? 2 : 1)
  const sample = wide ? 2 : 1

  for await (const chunk of source.rows()) {
    throwIfAborted(signal)
    for (let i = 0; i < chunk.length; i += stride) {
      if (hasAlpha) {
        const a = i + stride - sample
        if (chunk[a] !== 255 || (wide && chunk[a + 1] !== 255)) opaque = false
      }
      if (hasColour) {
        if (
          chunk[i] !== chunk[i + sample] ||
          chunk[i] !== chunk[i + 2 * sample] ||
          (wide &&
            (chunk[i + 1] !== chunk[i + sample + 1] || chunk[i + 1] !== chunk[i + 2 * sample + 1]))
        ) {
          gray = false
        }
      }
    }
    if ((!hasAlpha || !opaque) && (!hasColour || !gray)) break
  }
  return { opaque: hasAlpha ? opaque : true, gray: hasColour ? gray : true }
}

function planFor(
  source: PixelSource,
  analysis: { opaque: boolean; gray: boolean },
  reduceGray: boolean,
): Plan {
  switch (source.kind) {
    case 'gray':
    case 'indexed':
      return { space: source.kind, alpha: false }
    case 'gray-alpha':
      return { space: 'gray', alpha: !analysis.opaque }
    case 'rgb':
      return { space: analysis.gray && reduceGray ? 'gray' : 'rgb', alpha: false }
    case 'rgba':
      return { space: analysis.gray && reduceGray ? 'gray' : 'rgb', alpha: !analysis.opaque }
  }
}

/** Splits the colour samples and the alpha samples of a chunk into two byte arrays. */
function split(
  source: PixelSource,
  plan: Plan,
  chunk: Bytes,
): { colour: Bytes; alpha: Bytes | null } {
  const { kind } = source
  const sample = source.bits === 16 ? 2 : 1
  if (kind === 'gray' || kind === 'indexed') return { colour: chunk, alpha: null }
  if (kind === 'rgb' && plan.space === 'rgb') return { colour: chunk, alpha: null }

  const stride = CHANNELS[kind]
  const pixels = chunk.length / (stride * sample)
  const colourSamples = plan.space === 'rgb' ? 3 : 1
  const colour = new Uint8Array(pixels * colourSamples * sample)
  const alpha = plan.alpha ? new Uint8Array(pixels * sample) : null
  const alphaAt = stride - 1

  if (sample === 1) {
    for (let p = 0, i = 0, c = 0; p < pixels; p++, i += stride) {
      colour[c++] = chunk[i]
      if (colourSamples === 3) {
        colour[c++] = chunk[i + 1]
        colour[c++] = chunk[i + 2]
      }
      if (alpha) alpha[p] = chunk[i + alphaAt]
    }
  } else {
    for (let p = 0, i = 0, c = 0; p < pixels; p++, i += stride * 2) {
      for (let k = 0; k < colourSamples * 2; k++) colour[c++] = chunk[i + k]
      if (alpha) {
        alpha[p * 2] = chunk[i + alphaAt * 2]
        alpha[p * 2 + 1] = chunk[i + alphaAt * 2 + 1]
      }
    }
  }
  return { colour, alpha }
}

const ABSOLUTE = Uint8Array.from({ length: 256 }, (_, v) => (v < 128 ? v : 256 - v))

/** The filter chosen for a row is the one whose output has the smallest sum of absolute values. */
function filterRow(line: Bytes, previous: Bytes | null, step: number, out: Bytes, at: number) {
  const length = line.length
  let none = 0
  let sub = 0
  let up = 0
  let average = 0
  let paeth = 0
  for (let i = 0; i < length; i++) {
    const x = line[i]
    const a = i >= step ? line[i - step] : 0
    const b = previous ? previous[i] : 0
    const c = previous && i >= step ? previous[i - step] : 0
    none += ABSOLUTE[x]
    sub += ABSOLUTE[(x - a) & 255]
    up += ABSOLUTE[(x - b) & 255]
    average += ABSOLUTE[(x - ((a + b) >> 1)) & 255]
    paeth += ABSOLUTE[(x - paethPredictor(a, b, c)) & 255]
  }
  const best = Math.min(none, sub, up, average, paeth)
  const type = best === none ? 0 : best === sub ? 1 : best === up ? 2 : best === average ? 3 : 4
  out[at] = type
  for (let i = 0; i < length; i++) {
    const a = i >= step ? line[i - step] : 0
    const b = previous ? previous[i] : 0
    const c = previous && i >= step ? previous[i - step] : 0
    const predicted =
      type === 0
        ? 0
        : type === 1
          ? a
          : type === 2
            ? b
            : type === 3
              ? (a + b) >> 1
              : paethPredictor(a, b, c)
    out[at + 1 + i] = (line[i] - predicted) & 255
  }
}

function paethPredictor(a: number, b: number, c: number) {
  const estimate = a + b - c
  const da = Math.abs(estimate - a)
  const db = Math.abs(estimate - b)
  const dc = Math.abs(estimate - c)
  return da <= db && da <= dc ? a : db <= dc ? b : c
}

interface PlaneShape {
  width: number
  height: number
  colors: number
  bits: number
}

async function* withPredictor(
  rows: AsyncIterable<Bytes> | Iterable<Bytes>,
  shape: PlaneShape,
): AsyncGenerator<Bytes> {
  const rowBytes = Math.ceil((shape.width * shape.colors * shape.bits) / 8)
  const step = Math.max(1, (shape.colors * shape.bits) >> 3)
  let previous: Bytes | null = null
  for await (const chunk of rows) {
    const count = chunk.length / rowBytes
    const out = new Uint8Array(count * (rowBytes + 1))
    for (let r = 0; r < count; r++) {
      const line = chunk.subarray(r * rowBytes, (r + 1) * rowBytes)
      filterRow(line, previous, step, out, r * (rowBytes + 1))
      previous = line
    }
    // The next chunk's first row needs the last row of this one, which stays valid because
    // chunks are never reused.
    yield out
  }
}

/** Counts the rows that pass through and reports them. */
async function* counting(
  rows: AsyncIterable<Bytes> | Iterable<Bytes>,
  rowBytes: number,
  signal: AbortSignal | undefined,
  report: (rows: number) => void,
): AsyncGenerator<Bytes> {
  for await (const chunk of rows) {
    throwIfAborted(signal)
    yield chunk
    report(chunk.length / rowBytes)
  }
}

/** Stores a plane both plainly and with PNG predictors, and keeps whichever is smaller. */
async function encodePlane(
  rowsOf: () => AsyncIterable<Bytes> | Iterable<Bytes>,
  shape: PlaneShape,
  signal: AbortSignal | undefined,
  report: (rows: number) => void,
  original?: PixelSource['original'],
): Promise<EncodedPlane> {
  const rowBytes = Math.ceil((shape.width * shape.colors * shape.bits) / 8)
  const parameters = `/Colors ${shape.colors}/BitsPerComponent ${shape.bits}/Columns ${shape.width}`
  const flate = '/Filter/FlateDecode'

  const plainParts = await deflate(counting(rowsOf(), rowBytes, signal, report), signal)
  let best: EncodedPlane = { entries: flate, parts: plainParts, length: byteLength(plainParts) }

  const filteredParts = await deflate(
    withPredictor(counting(rowsOf(), rowBytes, signal, report), shape),
    signal,
  )
  const filteredLength = byteLength(filteredParts)
  if (filteredLength < best.length) {
    best = {
      entries: `${flate}/DecodeParms<</Predictor 15${parameters}>>`,
      parts: filteredParts,
      length: filteredLength,
    }
  }

  // The file's own data is read with the same predictor parameters, and is not touched.
  if (original && original.length <= best.length) {
    best = {
      entries: `${flate}/DecodeParms<</Predictor 15${parameters}>>`,
      parts: original.parts,
      length: original.length,
    }
  }
  return best
}

/**
 * Stores decoded pixels without losing any of them. Alpha that is fully opaque is dropped, colour
 * whose red, green and blue are always equal becomes gray, real transparency becomes a separate
 * mask, and every plane keeps the smaller of a plain and a predictor-filtered Flate stream.
 */
export async function encodeRaster(
  source: PixelSource,
  { reduceGray = true, signal, onProgress }: EncodeOptions = {},
): Promise<RasterEncoding> {
  const needsScan = source.kind === 'rgb' || source.kind === 'rgba' || source.kind === 'gray-alpha'
  const analysis = needsScan ? await analyse(source, signal) : { opaque: true, gray: true }
  const plan = planFor(source, analysis, reduceGray)
  onProgress?.(0.1)

  const planes = plan.alpha ? 2 : 1
  const totalRows = source.height * 2 * planes
  let rowsDone = 0
  const report = (rows: number) => {
    rowsDone += rows
    onProgress?.(0.1 + (0.9 * rowsDone) / totalRows)
  }

  const colourBits = source.bits
  const colourShape: PlaneShape = {
    width: source.width,
    height: source.height,
    colors: plan.space === 'rgb' ? 3 : 1,
    bits: colourBits,
  }
  // The file's own data can be used only when it is stored in the very same way.
  const native = source.kind === plan.space ? source.original : undefined
  const colourRows = () =>
    (async function* () {
      for await (const chunk of source.rows()) yield split(source, plan, chunk).colour
    })()
  const colourPlane = await encodePlane(colourRows, colourShape, signal, report, native)
  let colour = { space: plan.space, bits: colourBits, plane: colourPlane }

  // An RGB file whose pixels are all gray may be stored smaller as it is than as gray.
  if (source.kind === 'rgb' && plan.space === 'gray' && source.original) {
    const asStored = {
      entries: `/Filter/FlateDecode/DecodeParms<</Predictor 15/Colors 3/BitsPerComponent ${source.bits}/Columns ${source.width}>>`,
      parts: source.original.parts,
      length: source.original.length,
    }
    if (asStored.length < colourPlane.length) {
      colour = { space: 'rgb', bits: source.bits, plane: asStored }
    }
  }

  let alpha: RasterEncoding['alpha'] = null
  if (plan.alpha) {
    const alphaShape: PlaneShape = {
      width: source.width,
      height: source.height,
      colors: 1,
      bits: source.bits,
    }
    const alphaRows = () =>
      (async function* () {
        for await (const chunk of source.rows()) yield split(source, plan, chunk).alpha!
      })()
    alpha = {
      bits: source.bits,
      plane: await encodePlane(alphaRows, alphaShape, signal, report),
    }
  }

  onProgress?.(1)
  return { width: source.width, height: source.height, colour, alpha }
}
