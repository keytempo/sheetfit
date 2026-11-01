import { describe, expect, it } from 'vitest'
import type { ExportImage, ExportProgress } from '@/lib/export-types'
import { Random } from '../packing/random'
import type { DecodeImage } from './browser-decode'
import { buildPdf } from './build'
import { swapsAxes, type ExifOrientation } from './matrix'
import { POINTS_PER_MM } from './pages'
import { decodedStream, nameOf, readPdf, resolve, type Dict, type ReadPdf } from './testing/reader'
import {
  exportImage,
  exportInput,
  fakeJpeg,
  fakeProfile,
  handLayout,
  makeFile,
  type JpegSpec,
  sameBytes,
  type HandPiece,
} from './testing/fixtures'

/** A decoder that must not be needed: the JPEG files here are embedded untouched. */
const noDecoder: DecodeImage = () =>
  Promise.reject(new Error('the decoder was not expected to run'))

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

async function build(
  pieces: HandPiece[][],
  images: ExportImage[],
  options: { cutGuides?: boolean; sheet?: [number, number]; decode?: DecodeImage } = {},
) {
  const [width, height] = options.sheet ?? [210, 297]
  const layout = handLayout(pieces, width, height)
  const blob = await buildPdf(exportInput(layout, images, options.cutGuides), {
    decode: options.decode ?? noDecoder,
  })
  const bytes = await bytesOf(blob)
  return { layout, bytes, pdf: await readPdf(bytes) }
}

/** A JPEG as stored (`width` x `height`); the preview's size is the one after its orientation. */
const jpegImage = (id: string, width: number, height: number, extra: Partial<JpegSpec> = {}) => {
  const bytes = fakeJpeg({ width, height, ...extra })
  // Different content per id, so that distinct images are never taken for one file.
  const unique = new Uint8Array([
    ...bytes.subarray(0, bytes.length - 2),
    ...new TextEncoder().encode(id),
    0xff,
    0xd9,
  ])
  const turned = swapsAxes((extra.orientation ?? 1) as ExifOrientation)
  return exportImage(
    id,
    makeFile(unique, `${id}.jpg`),
    turned ? height : width,
    turned ? width : height,
  )
}

const side = (count: number, width = 20, height = 20, imageId = 'a'): HandPiece[] =>
  Array.from({ length: count }, (_, i) => ({
    imageId,
    x: 10 + (i % 8) * (width + 2),
    y: 10 + Math.floor(i / 8) * (height + 2),
    width,
    height,
  }))

describe('PDF structure', () => {
  it('is a valid PDF 1.7 with one page per sheet and exact offsets and lengths', async () => {
    const { pdf } = await build([side(3), side(2), side(5)], [jpegImage('a', 400, 300)])
    // readPdf throws on any wrong offset, length, xref entry, /Count or dangling reference.
    expect(pdf.version).toBe('1.7')
    expect(pdf.pages).toHaveLength(3)
  })

  it('draws every page on a MediaBox of the sheet size in points', async () => {
    const sheets: [number, number][] = [
      [210, 297],
      [420, 297],
      [123.45, 678.9],
      [1500, 30],
    ]
    for (const sheet of sheets) {
      const { pdf } = await build([side(1)], [jpegImage('a', 40, 30)], { sheet })
      const [x0, y0, x1, y1] = pdf.pages[0].mediaBox
      expect(x0).toBe(0)
      expect(y0).toBe(0)
      expect(Math.abs(x1 - (sheet[0] * 72) / 25.4)).toBeLessThan(0.01)
      expect(Math.abs(y1 - (sheet[1] * 72) / 25.4)).toBeLessThan(0.01)
    }
  })

  it('puts nothing on a page but the photos: no text, no background, no numbers', async () => {
    const { pdf, bytes } = await build([side(4)], [jpegImage('a', 40, 30)])
    expect([...pdf.pages[0].operators].sort()).toEqual(['Do', 'Q', 'cm', 'q'])
    const text = new TextDecoder('latin1').decode(bytes)
    for (const forbidden of ['/Font', 'BT', '/Annots', '/Outlines', '/CreationDate', '/ModDate']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('refuses an empty layout and a piece whose image is missing', async () => {
    const image = jpegImage('a', 40, 30)
    await expect(
      buildPdf(exportInput(handLayout([]), [image]), { decode: noDecoder }),
    ).rejects.toThrow(/nothing to export/)
    await expect(
      buildPdf(exportInput(handLayout([side(1, 20, 20, 'ghost')]), [image]), { decode: noDecoder }),
    ).rejects.toThrow(/ghost/)
  })

  it('embeds only the images that are placed', async () => {
    const used = jpegImage('used', 40, 30)
    const unused = jpegImage('unused', 50, 50)
    const { pdf } = await build([side(2, 20, 20, 'used')], [unused, used])
    const images = [...pdf.objects.values()].filter(
      (o) => nameOf((o.value as Dict).Subtype) === 'Image',
    )
    expect(images).toHaveLength(1)
  })
})

describe('JPEG passthrough', () => {
  it('stores the file’s own bytes, untouched, as a DCT stream', async () => {
    const image = jpegImage('a', 4000, 3000)
    const original = new Uint8Array(await image.file.arrayBuffer())
    const { pdf } = await build([side(3)], [image])
    const id = pdf.pages[0].images.get('Im0')!
    const object = pdf.objects.get(id)!
    expect(nameOf((object.value as Dict).Filter)).toBe('DCTDecode')
    expect(sameBytes(object.stream!, original)).toBe(true)
    expect(object.value).toMatchObject({ Width: 4000, Height: 3000, BitsPerComponent: 8 })
    expect(nameOf((object.value as Dict).ColorSpace)).toBe('DeviceRGB')
  })

  it('gets the colour space from the components, and inverts Adobe’s CMYK', async () => {
    const cases = [
      { components: 1 as const, space: 'DeviceGray', decode: false },
      { components: 3 as const, space: 'DeviceRGB', decode: false },
      { components: 4 as const, space: 'DeviceCMYK', decode: false },
      { components: 4 as const, space: 'DeviceCMYK', decode: true, adobeTransform: 2 },
    ]
    for (const c of cases) {
      const { pdf } = await build([side(1)], [jpegImage('a', 60, 40, c)])
      const dict = pdf.objects.get(pdf.pages[0].images.get('Im0')!)!.value as Dict
      expect(nameOf(dict.ColorSpace)).toBe(c.space)
      expect(dict.Decode).toEqual(c.decode ? [1, 0, 1, 0, 1, 0, 1, 0] : undefined)
    }
  })

  it('keeps an ICC profile, shares it between images, and ignores one of the wrong kind', async () => {
    const profile = fakeProfile('RGB ')
    const first = jpegImage('a', 60, 40, { profile, profileParts: 2 })
    const second = jpegImage('b', 30, 50, { profile })
    const wrong = jpegImage('c', 30, 50, { components: 4, profile })
    const { pdf } = await build(
      [
        [
          ...side(1, 20, 20, 'a'),
          { ...side(1, 20, 20, 'b')[0], x: 40 },
          { ...side(1, 20, 20, 'c')[0], x: 70 },
        ],
      ],
      [first, second, wrong],
    )
    const dictOf = (name: string) => pdf.objects.get(pdf.pages[0].images.get(name)!)!.value as Dict
    const spaceA = dictOf('Im0').ColorSpace as unknown as ({ name: string } | { ref: number })[]
    const spaceB = dictOf('Im1').ColorSpace as unknown as ({ name: string } | { ref: number })[]
    expect((spaceA[0] as { name: string }).name).toBe('ICCBased')
    expect(spaceA[1]).toEqual(spaceB[1]) // one shared profile object
    const profileObject = pdf.objects.get((spaceA[1] as { ref: number }).ref)!
    expect(profileObject.value).toMatchObject({ N: 3 })
    expect(sameBytes(await decodedStream(pdf, profileObject.id), profile)).toBe(true)
    expect(nameOf(dictOf('Im2').ColorSpace)).toBe('DeviceCMYK')
  })

  it('embeds identical files once, however many images they were added as', async () => {
    const bytes = fakeJpeg({ width: 80, height: 60 })
    const one = exportImage('one', makeFile(bytes, 'copy-1.jpg'), 80, 60)
    const two = exportImage('two', makeFile(bytes, 'copy-2.jpg'), 80, 60)
    const { pdf } = await build(
      [[...side(2, 20, 20, 'one'), { ...side(1, 20, 20, 'two')[0], x: 100 }]],
      [one, two],
    )
    const streams = [...pdf.objects.values()].filter(
      (o) => o.stream && 'Width' in (o.value as Dict),
    )
    expect(streams).toHaveLength(1)
    expect(new Set(pdf.pages[0].images.values()).size).toBe(1)
  })
})

/** Where the corner of the stored picture should land on the page, worked out from the geometry alone. */
function expectedCorner(
  orientation: ExifOrientation,
  corner: 'BL' | 'BR' | 'TL' | 'TR',
  placed: { x: number; y: number; width: number; height: number; rotated: boolean },
  sheetHeight: number,
): [number, number] {
  // The stored picture's corner as a point of the stored picture, then of the upright one.
  const stored = { BL: [0, 1], BR: [1, 1], TL: [0, 0], TR: [1, 0] }[corner] // (right, down) fractions
  const [p, q] = stored
  const [up, uq] = {
    1: [p, q],
    2: [1 - p, q],
    3: [1 - p, 1 - q],
    4: [p, 1 - q],
    5: [q, p],
    6: [1 - q, p],
    7: [1 - q, 1 - p],
    8: [q, 1 - p],
  }[orientation]
  // The upright picture's point (right fraction, down fraction) in the footprint.
  const fromLeft = placed.rotated ? 1 - uq : up
  const fromTop = placed.rotated ? up : uq
  const x = placed.x + fromLeft * placed.width
  const y = placed.y + fromTop * placed.height
  return [x * POINTS_PER_MM, (sheetHeight - y) * POINTS_PER_MM]
}

describe('placements', () => {
  it('put every corner of every photo where the layout says, for all EXIF orientations, turned or not', async () => {
    const random = new Random(21)
    const images: ExportImage[] = []
    const pieces: HandPiece[][] = [[], []]
    for (let o = 1; o <= 8; o++) {
      const [width, height] = [20 + random.int(300), 20 + random.int(300)]
      images.push(jpegImage(`o${o}`, width, height, { orientation: o }))
      for (const rotated of [false, true]) {
        const w = 10 + random.next() * 40
        const h = 10 + random.next() * 40
        pieces[rotated ? 1 : 0].push({
          imageId: `o${o}`,
          x: 10 + random.next() * 100,
          y: 10 + random.next() * 200,
          width: w,
          height: h,
          rotated,
        })
      }
    }
    const { layout, pdf } = await build(pieces, images)
    let checked = 0
    for (const [pageIndex, page] of pdf.pages.entries()) {
      expect(page.placements).toHaveLength(layout.sheets[pageIndex].pieces.length)
      for (const [i, placement] of page.placements.entries()) {
        const placed = layout.sheets[pageIndex].pieces[i]
        const object = pdf.objects.get(page.images.get(placement.name)!)!.value as Dict
        const orientation = Number(placed.piece.imageId.slice(1)) as ExifOrientation
        // The XObject is the right image.
        const source = images.find((image) => image.id === placed.piece.imageId)!
        const turned = swapsAxes(orientation)
        expect(object.Width).toBe(turned ? source.height : source.width)
        for (const corner of ['BL', 'BR', 'TL', 'TR'] as const) {
          const [u, v] = { BL: [0, 0], BR: [1, 0], TL: [0, 1], TR: [1, 1] }[corner]
          const m = placement.matrix
          const actual = [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]
          const [ex, ey] = expectedCorner(orientation, corner, placed, layout.sheetHeight)
          expect(
            Math.abs(actual[0] - ex),
            `${orientation} ${placed.rotated} ${corner} x`,
          ).toBeLessThan(0.001)
          expect(
            Math.abs(actual[1] - ey),
            `${orientation} ${placed.rotated} ${corner} y`,
          ).toBeLessThan(0.001)
        }
        checked += 1
      }
    }
    expect(checked).toBe(16)
  })

  it('keeps full precision for sizes that are not round numbers', async () => {
    const piece: HandPiece = {
      imageId: 'a',
      x: 12.3456,
      y: 7.8901,
      width: 33.3333,
      height: 44.4444,
    }
    const { layout, pdf } = await build([[piece]], [jpegImage('a', 300, 400)])
    const m = pdf.pages[0].placements[0].matrix
    const placed = layout.sheets[0].pieces[0]
    expect(Math.abs(m[0] - placed.width * POINTS_PER_MM)).toBeLessThan(0.001)
    expect(Math.abs(m[3] - placed.height * POINTS_PER_MM)).toBeLessThan(0.001)
    expect(Math.abs(m[4] - placed.x * POINTS_PER_MM)).toBeLessThan(0.001)
    expect(Math.abs(m[5] - (297 - placed.y - placed.height) * POINTS_PER_MM)).toBeLessThan(0.001)
  })
})

describe('size and determinism', () => {
  it('stores a photo once however many copies there are: twenty copies cost about one', async () => {
    const image = jpegImage('a', 4000, 3000)
    const imageSize = image.file.size
    const one = (await build([side(1)], [image])).bytes.length
    const twenty = (await build([side(20)], [image])).bytes.length
    const perCopy = (twenty - one) / 19
    expect(perCopy).toBeLessThan(40)
    // A naive writer that repeats the image for every copy would need twenty times its bytes.
    expect(twenty).toBeLessThan(one + 19 * 40)
    expect(twenty).toBeLessThan(imageSize + 1500)
  })

  it('gives the same bytes for the same input, every time', async () => {
    const images = [
      jpegImage('a', 400, 300, { orientation: 6, profile: fakeProfile('RGB ') }),
      jpegImage('b', 300, 300, { components: 4, adobeTransform: 2 }),
    ]
    const pieces = [
      [...side(5), ...side(3, 25, 30, 'b').map((p) => ({ ...p, y: p.y + 60 }))],
      side(2),
    ]
    const first = (await build(pieces, images, { cutGuides: true })).bytes
    const second = (await build(pieces, images, { cutGuides: true })).bytes
    expect(sameBytes(first, second)).toBe(true)
  })

  it('writes a hundred photos on many sheets, each file once', async () => {
    const images = Array.from({ length: 100 }, (_, i) => jpegImage(`p${i}`, 600 + i, 400 + i))
    const sheets: HandPiece[][] = Array.from({ length: 20 }, (_, s) =>
      Array.from({ length: 5 }, (_, i) => ({
        imageId: `p${s * 5 + i}`,
        x: 10 + i * 36,
        y: 10,
        width: 34,
        height: 24,
      })),
    )
    const { pdf, bytes } = await build(sheets, images)
    expect(pdf.pages).toHaveLength(20)
    const streams = [...pdf.objects.values()].filter(
      (o) => o.stream && 'Width' in (o.value as Dict),
    )
    expect(streams).toHaveLength(100)
    expect(bytes.length).toBeGreaterThan(100 * 30)
  })
})

describe('cut guides', () => {
  it('draws one hairline rectangle per piece inside its footprint, over the photos', async () => {
    const { layout, pdf } = await build([side(4)], [jpegImage('a', 40, 30)], { cutGuides: true })
    const page = pdf.pages[0]
    expect(page.rectangles).toHaveLength(4)
    expect(page.content.trimEnd().endsWith('S Q')).toBe(true)
    expect(page.content.indexOf('Do')).toBeLessThan(page.content.indexOf(' re'))
    for (const [i, [x, y, w, h]] of page.rectangles.entries()) {
      const placed = layout.sheets[0].pieces[i]
      const left = placed.x * POINTS_PER_MM
      const bottom = (297 - placed.y - placed.height) * POINTS_PER_MM
      expect(x).toBeGreaterThanOrEqual(left - 1e-3)
      expect(y).toBeGreaterThanOrEqual(bottom - 1e-3)
      expect(x + w).toBeLessThanOrEqual(left + placed.width * POINTS_PER_MM + 1e-3)
      expect(y + h).toBeLessThanOrEqual(bottom + placed.height * POINTS_PER_MM + 1e-3)
    }
    expect(page.content).toContain('0.25 w')
  })

  it('draws nothing but the photos when guides are off', async () => {
    const { pdf } = await build([side(4)], [jpegImage('a', 40, 30)], { cutGuides: false })
    expect(pdf.pages[0].rectangles).toHaveLength(0)
    expect(pdf.pages[0].content).not.toContain(' w')
  })
})

describe('progress and cancellation', () => {
  const imagesAndSheets = () => {
    const images = Array.from({ length: 6 }, (_, i) => jpegImage(`p${i}`, 400 + i, 300))
    const sheets: HandPiece[][] = [0, 1, 2].map((s) => [
      { imageId: `p${s * 2}`, x: 10, y: 10, width: 30, height: 20 },
      { imageId: `p${s * 2 + 1}`, x: 50, y: 10, width: 30, height: 20 },
    ])
    return { images, layout: handLayout(sheets) }
  }

  it('reports steadily increasing progress, per photo and per sheet, ending at the whole', async () => {
    const { images, layout } = imagesAndSheets()
    const seen: ExportProgress[] = []
    await buildPdf(exportInput(layout, images), {
      decode: noDecoder,
      onProgress: (p) => seen.push(p),
    })
    for (let i = 1; i < seen.length; i++)
      expect(seen[i].fraction).toBeGreaterThanOrEqual(seen[i - 1].fraction)
    expect(seen[0].fraction).toBe(0)
    expect(seen.at(-1)).toEqual({ fraction: 1, label: 'Finishing the file' })
    const labels = new Set(seen.map((p) => p.label))
    expect(labels).toContain('Embedding photo 1 of 6')
    expect(labels).toContain('Embedding photo 6 of 6')
    expect(labels).toContain('Writing sheet 1 of 3')
    expect(labels).toContain('Writing sheet 3 of 3')
  })

  it('stops when aborted, produces nothing, and does not keep working', async () => {
    const { images, layout } = imagesAndSheets()
    const controller = new AbortController()
    let reported = 0
    const result = buildPdf(exportInput(layout, images), {
      decode: noDecoder,
      signal: controller.signal,
      onProgress: () => {
        reported += 1
        if (reported === 3) controller.abort()
      },
    })
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    const atAbort = reported
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(reported).toBe(atAbort)
  })

  it('does not start when it is already aborted', async () => {
    const { images, layout } = imagesAndSheets()
    const controller = new AbortController()
    controller.abort()
    let reported = 0
    await expect(
      buildPdf(exportInput(layout, images), {
        decode: noDecoder,
        signal: controller.signal,
        onProgress: () => (reported += 1),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(reported).toBe(0)
  })
})

describe('resolve', () => {
  it('finds the catalogue and the info dictionary the trailer names', async () => {
    const { pdf } = await build([side(1)], [jpegImage('a', 40, 30)])
    expect(nameOf((resolve(pdf, pdf.trailer.Root) as Dict).Type)).toBe('Catalog')
    expect(resolve(pdf, pdf.trailer.Info)).toEqual({ Producer: 'Sheetfit' })
    expect(pdf satisfies ReadPdf).toBeTruthy()
  })
})
