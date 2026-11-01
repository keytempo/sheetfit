import { describe, expect, it } from 'vitest'
import type { ExportImage } from '@/lib/export-types'
import { Random } from '../packing/random'
import type { DecodeImage } from './browser-decode'
import { buildPdf } from './build'
import { concat } from './bytes'
import { byteLength, deflate } from './deflate'
import { encodeRaster, type PixelSource } from './raster'
import {
  decodedStream,
  nameOf,
  readPdf,
  resolve,
  type Dict,
  type ReadPdf,
  type Value,
} from './testing/reader'
import {
  channelsFor,
  encodePng,
  exportImage,
  exportInput,
  fakeJpeg,
  handLayout,
  makeFile,
  randomRows,
  sameBytes,
  type PngSpec,
} from './testing/fixtures'

const DEPTHS: Record<PngSpec['colorType'], PngSpec['bitDepth'][]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

const PALETTE = Uint8Array.from({ length: 768 }, (_, i) => (i * 7) % 256)

/** A decoder source over RGBA pixels, handing out a few rows per chunk. */
function rgbaSource(
  width: number,
  height: number,
  data: Uint8Array<ArrayBuffer>,
  rowsPerChunk = 3,
): PixelSource {
  return {
    width,
    height,
    kind: 'rgba',
    bits: 8,
    rows: function* () {
      for (let top = 0; top < height; top += rowsPerChunk) {
        const rows = Math.min(rowsPerChunk, height - top)
        yield data.slice(top * width * 4, (top + rows) * width * 4)
      }
    },
  }
}

function decoderOf(sources: Record<string, PixelSource>, calls: string[] = []): DecodeImage {
  return (file) => {
    const name = (file as File).name
    calls.push(name)
    const source = sources[name]
    return source
      ? Promise.resolve({ source, close: () => undefined })
      : Promise.reject(new Error('this browser cannot decode the file'))
  }
}

const refuse: DecodeImage = () => Promise.reject(new Error('the decoder was not expected to run'))

async function exportOne(image: ExportImage, decode: DecodeImage) {
  const layout = handLayout([[{ imageId: image.id, x: 10, y: 10, width: 30, height: 20 }]])
  const blob = await buildPdf(exportInput(layout, [image]), { decode })
  const pdf = await readPdf(new Uint8Array(await blob.arrayBuffer()))
  return { pdf, imageId: pdf.pages[0].images.get('Im0')! }
}

interface StoredRaster {
  dict: Dict
  space: Value
  bits: number
  colour: Uint8Array
  alpha: Uint8Array | null
  alphaBits: number | null
}

async function stored(pdf: ReadPdf, id: number): Promise<StoredRaster> {
  const dict = pdf.objects.get(id)!.value as Dict
  const mask = dict.SMask ? (resolve(pdf, dict.SMask) as Dict) : null
  const maskId = dict.SMask ? (dict.SMask as { ref: number }).ref : 0
  return {
    dict,
    space: dict.ColorSpace,
    bits: dict.BitsPerComponent as number,
    colour: await decodedStream(pdf, id),
    alpha: mask ? await decodedStream(pdf, maskId) : null,
    alphaBits: mask ? (mask.BitsPerComponent as number) : null,
  }
}

const spaceName = (space: Value) => (Array.isArray(space) ? nameOf(space[0]) : nameOf(space))

/** The colour samples and the alpha samples of random pixels, as separate byte arrays. */
function planesOf(rows: Uint8Array[], type: 4 | 6, depth: 8 | 16) {
  const sample = depth / 8
  const colourSamples = type === 4 ? 1 : 3
  const stride = (colourSamples + 1) * sample
  const colour: number[] = []
  const alpha: number[] = []
  for (const row of rows) {
    for (let i = 0; i < row.length; i += stride) {
      for (let k = 0; k < colourSamples * sample; k++) colour.push(row[i + k])
      for (let k = 0; k < sample; k++) alpha.push(row[i + colourSamples * sample + k])
    }
  }
  return { colour: Uint8Array.from(colour), alpha: Uint8Array.from(alpha) }
}

describe('PNG files, read and stored without loss', () => {
  for (const [typeText, depths] of Object.entries(DEPTHS)) {
    const type = Number(typeText) as PngSpec['colorType']
    for (const depth of depths) {
      it(`colour type ${type}, ${depth} bits: every sample comes back exactly`, async () => {
        for (const [width, height] of [
          [13, 7],
          [1, 4],
          [40, 3],
        ]) {
          const rows = randomRows(width, height, type, depth, width * 31 + type)
          const png = await encodePng({
            width,
            height,
            colorType: type,
            bitDepth: depth,
            rows,
            palette: type === 3 ? PALETTE : undefined,
            seed: height,
          })
          const image = exportImage('a', makeFile(png, 'a.png'), width, height)
          const { pdf, imageId } = await exportOne(image, refuse)
          const raster = await stored(pdf, imageId)
          expect(raster.bits).toBe(depth)

          if (type === 4 || type === 6) {
            const expected = planesOf(rows, type, depth as 8 | 16)
            expect(spaceName(raster.space)).toBe(type === 4 ? 'DeviceGray' : 'DeviceRGB')
            expect(sameBytes(raster.colour, expected.colour)).toBe(true)
            expect(raster.alphaBits).toBe(depth)
            expect(sameBytes(raster.alpha!, expected.alpha)).toBe(true)
          } else {
            expect(raster.alpha).toBeNull()
            expect(sameBytes(raster.colour, concat(rows))).toBe(true)
            expect(spaceName(raster.space)).toBe(['DeviceGray', 'x', 'DeviceRGB', 'Indexed'][type])
          }
        }
      })
    }
  }

  it('keeps a palette exactly: base colour space, size and every entry', async () => {
    const rows = randomRows(9, 5, 3, 4, 3)
    const png = await encodePng({
      width: 9,
      height: 5,
      colorType: 3,
      bitDepth: 4,
      rows,
      palette: PALETTE,
    })
    const { pdf, imageId } = await exportOne(exportImage('a', makeFile(png, 'a.png'), 9, 5), refuse)
    const space = (await stored(pdf, imageId)).space as Value[]
    expect(nameOf(space[0])).toBe('Indexed')
    expect(nameOf(space[1])).toBe('DeviceRGB')
    expect(space[2]).toBe(255)
    const hex = (space[3] as { hex: string }).hex
    expect(hex).toBe([...PALETTE].map((v) => v.toString(16).padStart(2, '0')).join(''))
  })

  it('turns a palette with transparency into colour plus a mask, without changing a pixel', async () => {
    const rows = randomRows(11, 6, 3, 8, 9)
    const trns = Uint8Array.from({ length: 100 }, (_, i) => (i * 37) % 256)
    const png = await encodePng({
      width: 11,
      height: 6,
      colorType: 3,
      bitDepth: 8,
      rows,
      palette: PALETTE,
      transparency: trns,
    })
    const { pdf, imageId } = await exportOne(
      exportImage('a', makeFile(png, 'a.png'), 11, 6),
      refuse,
    )
    const raster = await stored(pdf, imageId)
    const expectedColour: number[] = []
    const expectedAlpha: number[] = []
    for (const row of rows) {
      for (const index of row) {
        expectedColour.push(PALETTE[index * 3], PALETTE[index * 3 + 1], PALETTE[index * 3 + 2])
        expectedAlpha.push(index < trns.length ? trns[index] : 255)
      }
    }
    expect(sameBytes(raster.colour, Uint8Array.from(expectedColour))).toBe(true)
    expect(sameBytes(raster.alpha!, Uint8Array.from(expectedAlpha))).toBe(true)
  })

  it('makes the key colour of a gray or RGB PNG clear, and nothing else', async () => {
    for (const [type, depth, key] of [
      [0, 8, [0, 0x55]],
      [0, 16, [0x12, 0x34]],
      [2, 8, [0, 10, 0, 20, 0, 30]],
      [2, 16, [0, 1, 0, 2, 0, 3]],
    ] as const) {
      const keyValues: readonly number[] = key
      const width = 8
      const height = 4
      const rows = randomRows(width, height, type, depth, 5)
      // Make every third pixel the key colour, so there is something to find.
      const sample = depth / 8
      const pixel = channelsFor(type) * sample
      const keyBytes =
        type === 0 ? [keyValues[depth === 8 ? 1 : 0], keyValues[1]].slice(0, sample) : []
      if (type === 2)
        for (let c = 0; c < 3; c++)
          for (let k = 0; k < sample; k++) keyBytes.push(keyValues[c * 2 + (depth === 8 ? 1 : k)])
      for (const row of rows) for (let p = 0; p < width; p += 3) row.set(keyBytes, p * pixel)
      const png = await encodePng({
        width,
        height,
        colorType: type,
        bitDepth: depth,
        rows,
        transparency: Uint8Array.from(key),
      })
      const { pdf, imageId } = await exportOne(
        exportImage('a', makeFile(png, 'a.png'), width, height),
        refuse,
      )
      const raster = await stored(pdf, imageId)
      expect(raster.bits).toBe(depth)
      expect(sameBytes(raster.colour, concat(rows))).toBe(true)
      const alpha = raster.alpha!
      for (let r = 0; r < height; r++) {
        for (let p = 0; p < width; p++) {
          const at = (r * width + p) * sample
          const isKey = keyBytes.every((v, k) => rows[r][p * pixel + k] === v)
          for (let k = 0; k < sample; k++) expect(alpha[at + k]).toBe(isKey ? 0 : 255)
        }
      }
    }
  })
})

describe('lossless reductions', () => {
  const rgba = (width: number, height: number, make: (x: number, y: number) => number[]) => {
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) data.set(make(x, y), (y * width + x) * 4)
    return data
  }

  it('drops an alpha channel that is fully opaque', async () => {
    const width = 17
    const height = 9
    const data = rgba(width, height, (x, y) => [x * 13, y * 29, (x * y) % 251, 255])
    const rows = Array.from({ length: height }, (_, y) =>
      data.slice(y * width * 4, (y + 1) * width * 4),
    )
    const png = await encodePng({ width, height, colorType: 6, bitDepth: 8, rows })
    const { pdf, imageId } = await exportOne(
      exportImage('a', makeFile(png, 'a.png'), width, height),
      refuse,
    )
    const raster = await stored(pdf, imageId)
    expect(raster.alpha).toBeNull()
    expect(raster.dict.SMask).toBeUndefined()
    expect(spaceName(raster.space)).toBe('DeviceRGB')
    expect(raster.colour).toHaveLength(width * height * 3)
  })

  it('stores red = green = blue as gray, at the same bit depth, and real alpha as a mask', async () => {
    for (const depth of [8, 16] as const) {
      const width = 12
      const height = 5
      const sample = depth / 8
      const rows = Array.from({ length: height }, (_, y) => {
        const row = new Uint8Array(width * 4 * sample)
        for (let x = 0; x < width; x++) {
          const v = (x * 19 + y * 7) % 256
          for (let c = 0; c < 3; c++)
            for (let k = 0; k < sample; k++) row[(x * 4 + c) * sample + k] = k === 0 ? v : v ^ 0x5a
          for (let k = 0; k < sample; k++) row[(x * 4 + 3) * sample + k] = x === 0 ? 0 : 200 + k
        }
        return row
      })
      const png = await encodePng({ width, height, colorType: 6, bitDepth: depth, rows })
      const { pdf, imageId } = await exportOne(
        exportImage('a', makeFile(png, 'a.png'), width, height),
        refuse,
      )
      const raster = await stored(pdf, imageId)
      expect(spaceName(raster.space)).toBe('DeviceGray')
      expect(raster.bits).toBe(depth)
      expect(raster.colour).toHaveLength(width * height * sample)
      expect(raster.alpha).not.toBeNull()
    }
  })

  it('stores an RGB PNG that is really gray as DeviceGray', async () => {
    const width = 20
    const height = 6
    const rows = Array.from({ length: height }, (_, y) => {
      const row = new Uint8Array(width * 3)
      for (let x = 0; x < width; x++) row.fill((x * 11 + y * 3) % 256, x * 3, x * 3 + 3)
      return row
    })
    const png = await encodePng({ width, height, colorType: 2, bitDepth: 8, rows })
    const { pdf, imageId } = await exportOne(
      exportImage('a', makeFile(png, 'a.png'), width, height),
      refuse,
    )
    const raster = await stored(pdf, imageId)
    expect(spaceName(raster.space)).toBe('DeviceGray')
    expect(raster.colour).toHaveLength(width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) expect(raster.colour[y * width + x]).toBe(rows[y][x * 3])
  })

  it('keeps a profiled RGB PNG in colour, so its profile still applies', async () => {
    const width = 8
    const height = 4
    const rows = Array.from({ length: height }, () => new Uint8Array(width * 3).fill(100))
    const profile = new Uint8Array(160)
    profile[8] = 2
    profile.set(new TextEncoder().encode('RGB '), 16)
    profile.set(new TextEncoder().encode('acsp'), 36)
    const png = await encodePng({ width, height, colorType: 2, bitDepth: 8, rows, profile })
    const { pdf, imageId } = await exportOne(
      exportImage('a', makeFile(png, 'a.png'), width, height),
      refuse,
    )
    const raster = await stored(pdf, imageId)
    expect(spaceName(raster.space)).toBe('ICCBased')
    expect(raster.colour).toHaveLength(width * height * 3)
  })
})

describe('keeping the smaller encoding', () => {
  const gradient = (width: number, height: number): PixelSource => {
    const data = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) data.set([x, (x + y) & 255, y & 255], (y * width + x) * 3)
    return { width, height, kind: 'rgb', bits: 8, rows: () => [data] }
  }

  it('uses PNG predictors where they pay off, and is never larger than plain Flate', async () => {
    const source = gradient(250, 250)
    const encoding = await encodeRaster(source)
    const plain = byteLength(await deflate(source.rows() as Iterable<Uint8Array<ArrayBuffer>>))
    expect(encoding.colour.plane.entries).toContain('/Predictor 15')
    expect(encoding.colour.plane.length).toBeLessThan(plain)
  })

  it('takes the file’s own compressed data when that is smaller, and not when it is larger', async () => {
    const original = { parts: [new Uint8Array([1, 2, 3])], length: 3 }
    const small = await encodeRaster({ ...gradient(40, 40), original })
    expect(small.colour.plane.parts).toBe(original.parts)
    expect(small.colour.plane.entries).toContain('/Colors 3/BitsPerComponent 8/Columns 40')

    const huge = { parts: [new Uint8Array(10)], length: 10_000_000 }
    const own = await encodeRaster({ ...gradient(40, 40), original: huge })
    expect(own.colour.plane.parts).not.toBe(huge.parts)
  })

  it('reports progress from nothing to everything', async () => {
    const seen: number[] = []
    await encodeRaster(gradient(30, 30), { onProgress: (f) => seen.push(f) })
    expect(seen[0]).toBeGreaterThanOrEqual(0)
    expect(seen.at(-1)).toBe(1)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      encodeRaster(gradient(30, 30), { signal: controller.signal }),
    ).rejects.toBeDefined()
  })
})

describe('images the browser has to decode', () => {
  it('stores random RGBA pictures exactly, whatever mix of alpha and gray they are', async () => {
    const random = new Random(99)
    for (let trial = 0; trial < 80; trial++) {
      const width = 1 + random.int(37)
      const height = 1 + random.int(23)
      const mode = trial % 4
      const data = new Uint8Array(width * height * 4)
      for (let p = 0; p < width * height; p++) {
        const gray = mode === 1 || mode === 3
        const r = random.int(256)
        data.set(
          [
            r,
            gray ? r : random.int(256),
            gray ? r : random.int(256),
            mode >= 2 ? random.int(256) : 255,
          ],
          p * 4,
        )
      }
      const name = `t${trial}.webp`
      const image = exportImage('a', makeFile(new Uint8Array([1, 2, 3]), name), width, height)
      const source = rgbaSource(width, height, data, 1 + random.int(5))
      const { pdf, imageId } = await exportOne(image, decoderOf({ [name]: source }))
      const raster = await stored(pdf, imageId)

      const channels = spaceName(raster.space) === 'DeviceGray' ? 1 : 3
      expect(channels, `trial ${trial}`).toBe(mode === 1 || mode === 3 ? 1 : 3)
      expect(raster.alpha === null, `trial ${trial}`).toBe(mode < 2)
      const back = new Uint8Array(width * height * 4)
      for (let p = 0; p < width * height; p++) {
        for (let c = 0; c < 3; c++)
          back[p * 4 + c] = raster.colour[p * channels + (channels === 1 ? 0 : c)]
        back[p * 4 + 3] = raster.alpha ? raster.alpha[p] : 255
      }
      expect(sameBytes(back, data), `trial ${trial}`).toBe(true)
    }
  })

  it('reads a tall picture in strips without any seam', async () => {
    const width = 7
    const height = 1000
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) >>> 24
    const image = exportImage('a', makeFile(new Uint8Array([1]), 'tall.avif'), width, height)
    const { pdf, imageId } = await exportOne(
      image,
      decoderOf({ 'tall.avif': rgbaSource(width, height, data, 64) }),
    )
    const raster = await stored(pdf, imageId)
    expect(raster.colour).toHaveLength(width * height * 3)
    for (let p = 0; p < width * height; p += 97) {
      expect([...raster.colour.subarray(p * 3, p * 3 + 3)]).toEqual([
        ...data.subarray(p * 4, p * 4 + 3),
      ])
      expect(raster.alpha![p]).toBe(data[p * 4 + 3])
    }
  })
})

describe('when a file’s own bytes cannot be used', () => {
  const rows = randomRows(10, 8, 2, 8, 4)

  it('asks the decoder for an interlaced PNG', async () => {
    const png = await encodePng({ width: 10, height: 8, colorType: 2, bitDepth: 8, rows })
    png[28] = 1 // the interlace byte of the header
    const calls: string[] = []
    const data = new Uint8Array(10 * 8 * 4).fill(200)
    const decode = decoderOf({ 'i.png': rgbaSource(10, 8, data) }, calls)
    const { pdf, imageId } = await exportOne(
      exportImage('a', makeFile(png, 'i.png'), 10, 8),
      decode,
    )
    expect(calls).toEqual(['i.png'])
    expect((await stored(pdf, imageId)).colour.length).toBe(10 * 8) // gray: all 200
  })

  it('asks the decoder for a PNG that carries a rotation', async () => {
    const tiff = new Uint8Array([
      0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0,
    ])
    const png = await encodePng({
      width: 10,
      height: 8,
      colorType: 2,
      bitDepth: 8,
      rows,
      exif: tiff,
    })
    const calls: string[] = []
    const data = new Uint8Array(8 * 10 * 4).fill(7)
    await exportOne(
      exportImage('a', makeFile(png, 'r.png'), 8, 10),
      decoderOf({ 'r.png': rgbaSource(8, 10, data) }, calls),
    )
    expect(calls).toEqual(['r.png'])
  })

  it('asks the decoder when a file’s size is not the size the preview shows', async () => {
    const png = await encodePng({ width: 10, height: 8, colorType: 2, bitDepth: 8, rows })
    const calls: string[] = []
    const data = new Uint8Array(5 * 5 * 4).fill(7)
    await exportOne(
      exportImage('a', makeFile(png, 'm.png'), 5, 5),
      decoderOf({ 'm.png': rgbaSource(5, 5, data) }, calls),
    )
    expect(calls).toEqual(['m.png'])
  })

  it('asks the decoder for JPEG variants a PDF cannot read, and for WebP, GIF, BMP and AVIF', async () => {
    const calls: string[] = []
    const files = {
      'arith.jpg': fakeJpeg({ width: 6, height: 4, frame: 0xc9 }),
      'twelve.jpg': fakeJpeg({ width: 6, height: 4, precision: 12 }),
      'x.webp': new Uint8Array([82, 73, 70, 70, 0]),
      'x.gif': new Uint8Array([71, 73, 70, 56]),
      'x.bmp': new Uint8Array([66, 77]),
      'x.avif': new Uint8Array([0, 0, 0, 24]),
    }
    const data = new Uint8Array(6 * 4 * 4).map((_, i) => (i * 5) % 256)
    const sources = Object.fromEntries(
      Object.keys(files).map((name) => [name, rgbaSource(6, 4, data)]),
    )
    for (const [name, bytes] of Object.entries(files)) {
      await exportOne(exportImage('a', makeFile(bytes, name), 6, 4), decoderOf(sources, calls))
    }
    expect(calls).toEqual(Object.keys(files))
  })

  it('also asks the decoder when a JPEG’s orientation is not the one the preview applied', async () => {
    const calls: string[] = []
    const data = new Uint8Array(4 * 6 * 4).fill(90)
    // Stored 6 x 4 with orientation 6, so the preview should be 4 x 6. A preview of 6 x 4 disagrees.
    await exportOne(
      exportImage('a', makeFile(fakeJpeg({ width: 6, height: 4, orientation: 6 }), 'o.jpg'), 6, 4),
      decoderOf({ 'o.jpg': rgbaSource(6, 4, new Uint8Array(6 * 4 * 4).fill(90)) }, calls),
    )
    expect(calls).toEqual(['o.jpg'])
    expect(data.length).toBe(96)
  })

  it('says which file could not be read, and why', async () => {
    const image = exportImage('a', makeFile(new Uint8Array([1, 2, 3]), 'broken.webp'), 4, 4)
    await expect(exportOne(image, decoderOf({}))).rejects.toThrow(
      'Could not read broken.webp: this browser cannot decode the file.',
    )
    const stale = exportImage('a', makeFile(new Uint8Array([1, 2, 3]), 'grown.webp'), 4, 4)
    const wrongSize = rgbaSource(5, 5, new Uint8Array(100))
    await expect(exportOne(stale, decoderOf({ 'grown.webp': wrongSize }))).rejects.toThrow(
      /grown\.webp.*size changed/,
    )
  })

  it('says so when a file can no longer be read', async () => {
    const file = makeFile(new Uint8Array([1]), 'gone.jpg')
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new Error('NotReadableError')),
    })
    await expect(exportOne(exportImage('a', file, 4, 4), refuse)).rejects.toThrow(
      'Could not read gone.jpg. The file may have been moved or deleted.',
    )
  })

  it('lets go of the decoder’s memory whether or not the export works', async () => {
    let closed = 0
    const decode: DecodeImage = () =>
      Promise.resolve({
        source: rgbaSource(4, 4, new Uint8Array(64).fill(3)),
        close: () => (closed += 1),
      })
    await exportOne(exportImage('a', makeFile(new Uint8Array([1]), 'a.gif'), 4, 4), decode)
    const wrong: DecodeImage = () =>
      Promise.resolve({ source: rgbaSource(9, 9, new Uint8Array(324)), close: () => (closed += 1) })
    await expect(
      exportOne(exportImage('a', makeFile(new Uint8Array([1]), 'b.gif'), 4, 4), wrong),
    ).rejects.toThrow()
    expect(closed).toBe(2)
  })
})
