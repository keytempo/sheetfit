import { describe, expect, it } from 'vitest'
import { Random } from '../packing/random'
import { parseJpeg } from './jpeg'
import { fakeJpeg, fakeProfile } from './testing/fixtures'

describe('parseJpeg', () => {
  it('reads the size and components of baseline and progressive files', () => {
    for (const frame of [0xc0, 0xc1, 0xc2]) {
      for (const components of [1, 3, 4] as const) {
        const info = parseJpeg(fakeJpeg({ width: 4000, height: 3000, components, frame }))
        expect(info).toMatchObject({ width: 4000, height: 3000, components, orientation: 1 })
        expect(info?.adobeTransform).toBeNull()
        expect(info?.icc).toBeNull()
      }
    }
  })

  it('refuses what a PDF cannot embed untouched', () => {
    expect(parseJpeg(fakeJpeg({ width: 8, height: 8, frame: 0xc3 }))).toBeNull() // lossless
    expect(parseJpeg(fakeJpeg({ width: 8, height: 8, frame: 0xc9 }))).toBeNull() // arithmetic coded
    expect(parseJpeg(fakeJpeg({ width: 8, height: 8, precision: 12 }))).toBeNull()
    expect(parseJpeg(new TextEncoder().encode('not a jpeg at all'))).toBeNull()
    expect(parseJpeg(new Uint8Array(0))).toBeNull()
  })

  it('reads every EXIF orientation, in both byte orders', () => {
    for (const bigEndianExif of [false, true]) {
      for (let orientation = 1; orientation <= 8; orientation++) {
        const info = parseJpeg(fakeJpeg({ width: 30, height: 20, orientation, bigEndianExif }))
        expect(info?.orientation).toBe(orientation)
      }
    }
  })

  it('treats an impossible orientation as upright', () => {
    for (const orientation of [0, 9, 200]) {
      expect(parseJpeg(fakeJpeg({ width: 3, height: 2, orientation }))?.orientation).toBe(1)
    }
  })

  it('joins an ICC profile split over several segments, and refuses an incomplete one', () => {
    const profile = fakeProfile('RGB ')
    for (const profileParts of [1, 2, 3]) {
      const info = parseJpeg(fakeJpeg({ width: 3, height: 2, profile, profileParts }))
      expect(info?.icc).toEqual(profile)
    }
    // A segment that is missing: three promised, only the first two present.
    const whole = fakeJpeg({ width: 3, height: 2, profile, profileParts: 3 })
    const marker = [0xff, 0xe2]
    const starts: number[] = []
    for (let i = 0; i < whole.length - 1; i++) {
      if (whole[i] === marker[0] && whole[i + 1] === marker[1]) starts.push(i)
    }
    const missing = new Uint8Array([
      ...whole.subarray(0, starts[2]),
      ...whole.subarray(starts[2] + 2 + 2 + 14 + 54),
    ])
    expect(parseJpeg(missing)?.icc ?? null).toBeNull()
  })

  it('reads Adobe’s colour transform', () => {
    expect(
      parseJpeg(fakeJpeg({ width: 3, height: 2, components: 4, adobeTransform: 2 }))
        ?.adobeTransform,
    ).toBe(2)
    expect(
      parseJpeg(fakeJpeg({ width: 3, height: 2, components: 4, adobeTransform: 0 }))
        ?.adobeTransform,
    ).toBe(0)
  })

  it('never throws on damaged files, however they are cut or changed', () => {
    const random = new Random(7)
    const base = fakeJpeg({
      width: 640,
      height: 480,
      orientation: 6,
      adobeTransform: 2,
      components: 4,
      profile: fakeProfile('CMYK'),
      profileParts: 2,
    })
    for (let trial = 0; trial < 3000; trial++) {
      const copy = base.slice(0, trial % 5 === 0 ? random.int(base.length) : base.length)
      for (let k = 0; k < 1 + random.int(6); k++) copy[random.int(copy.length)] = random.int(256)
      expect(() => parseJpeg(copy)).not.toThrow()
    }
  })
})
