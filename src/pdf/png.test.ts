import { describe, expect, it } from 'vitest'
import { Random } from '../packing/random'
import { concat } from './bytes'
import { parsePng, pngRows, type PngInfo } from './png'
import { channelsFor, encodePng, randomRows, sameBytes, type PngSpec } from './testing/fixtures'

const DEPTHS: Record<PngSpec['colorType'], PngSpec['bitDepth'][]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

async function decode(info: PngInfo) {
  const chunks: Uint8Array[] = []
  for await (const chunk of pngRows(info)) chunks.push(chunk)
  return concat(chunks)
}

function spec(
  colorType: PngSpec['colorType'],
  bitDepth: PngSpec['bitDepth'],
  width: number,
  height: number,
  seed = 1,
): PngSpec {
  return {
    width,
    height,
    colorType,
    bitDepth,
    rows: randomRows(width, height, colorType, bitDepth, seed),
    palette: colorType === 3 ? Uint8Array.from({ length: 768 }, (_, i) => i % 251) : undefined,
    seed,
  }
}

describe('parsePng', () => {
  it('reads the header and the chunks it needs', async () => {
    const png = await encodePng({ ...spec(3, 4, 9, 5), transparency: new Uint8Array([0, 128]) })
    const info = parsePng(png)!
    expect(info).toMatchObject({
      width: 9,
      height: 5,
      bitDepth: 4,
      colorType: 3,
      interlaced: false,
    })
    expect(info.palette?.length).toBe(768)
    expect([...info.transparency!]).toEqual([0, 128])
    expect(info.idat.length).toBe(2)
    expect(info.hasOrientation).toBe(false)
  })

  it('notices an orientation and a colour profile', async () => {
    const tiff = new Uint8Array([
      0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0,
    ])
    const png = await encodePng({ ...spec(2, 8, 4, 4), exif: tiff, profile: new Uint8Array(140) })
    const info = parsePng(png)!
    expect(info.hasOrientation).toBe(true)
    expect(info.compressedProfile).not.toBeNull()
  })

  it('returns null for anything that is not a whole PNG, and never throws', async () => {
    expect(parsePng(new TextEncoder().encode('GIF89a not a png'))).toBeNull()
    const png = await encodePng(spec(2, 8, 20, 20))
    expect(parsePng(png.slice(0, 40))).toBeNull()
    const random = new Random(11)
    for (let trial = 0; trial < 1500; trial++) {
      const copy = png.slice(0, trial % 4 === 0 ? random.int(png.length) : png.length)
      for (let k = 0; k < 1 + random.int(5); k++) copy[random.int(copy.length)] = random.int(256)
      expect(() => parsePng(copy)).not.toThrow()
    }
  })
})

describe('pngRows', () => {
  for (const [type, depths] of Object.entries(DEPTHS)) {
    for (const depth of depths) {
      it(`gives back the exact scanlines of colour type ${type} at ${depth} bits`, async () => {
        // Widths that are not a multiple of 8, and one that is a single pixel.
        for (const [width, height] of [
          [13, 7],
          [1, 5],
          [64, 3],
        ]) {
          const original = spec(Number(type) as PngSpec['colorType'], depth, width, height, width)
          const info = parsePng(await encodePng(original))!
          expect(await decode(info)).toEqual(concat(original.rows))
        }
      })
    }
  }

  it('keeps the previous row across chunk boundaries of a large image', async () => {
    // 1000 x 1300 RGB at 8 bits is about 3.9 MB, which is more than one 2 MB chunk.
    const original = spec(2, 8, 1000, 1300, 5)
    const info = parsePng(await encodePng(original))!
    const chunks: Uint8Array[] = []
    for await (const chunk of pngRows(info)) chunks.push(chunk)
    expect(chunks.length).toBeGreaterThan(1)
    expect(sameBytes(concat(chunks), concat(original.rows))).toBe(true)
  })

  it('fails clearly on a file that is cut short, and stops when asked', async () => {
    const png = await encodePng(spec(2, 8, 50, 50))
    const info = parsePng(png)!
    const cut: PngInfo = { ...info, idat: [info.idat[0]] }
    await expect(decode(cut)).rejects.toThrow()

    const controller = new AbortController()
    controller.abort()
    const consume = async () => {
      for await (const chunk of pngRows(info, controller.signal)) void chunk
    }
    await expect(consume()).rejects.toThrow()
  })

  it('reports the channel count of every colour type', () => {
    expect(([0, 2, 3, 4, 6] as const).map(channelsFor)).toEqual([1, 3, 1, 2, 4])
  })
})
