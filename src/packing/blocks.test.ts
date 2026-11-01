import { describe, expect, it } from 'vitest'
import { bestBlockPattern } from './blocks.ts'
import { Random } from './random.ts'
import { fitsOnSheet } from './testing/bruteforce.ts'

const unit = (w: number, h: number) => ({ w, h, area: w * h, value: w * h, limit: Infinity })

/** The largest count of w x h boxes that fit a sheet, by exhaustive search. */
function optimum(width: number, height: number, w: number, h: number, rotate: boolean) {
  let k = 0
  while (
    fitsOnSheet(
      width,
      height,
      Array.from({ length: k + 1 }, () => ({ w, h })),
      rotate,
    )
  )
    k++
  return k
}

function overlaps(placed: readonly number[]) {
  for (let i = 0; i < placed.length; i += 6) {
    for (let j = i + 6; j < placed.length; j += 6) {
      if (
        placed[i + 1] < placed[j + 1] + placed[j + 3] &&
        placed[j + 1] < placed[i + 1] + placed[i + 3] &&
        placed[i + 2] < placed[j + 2] + placed[j + 4] &&
        placed[j + 2] < placed[i + 2] + placed[i + 4]
      ) {
        return true
      }
    }
  }
  return false
}

describe('block patterns', () => {
  it('finds the 2 x 2 tiling with rotated pieces', () => {
    const pattern = bestBlockPattern(210, 297, [unit(148.5, 105)], {
      fiveBlock: true,
      maxWork: 1e7,
      rotate: true,
    })
    expect(pattern?.counts).toEqual([4])
  })

  it('needs the five-block pinwheel where a guillotine cut cannot reach the area bound', () => {
    const options = { maxWork: 1e9, rotate: true }
    const guillotine = bestBlockPattern(13, 13, [unit(3, 2)], { ...options, fiveBlock: false })
    const pinwheel = bestBlockPattern(13, 13, [unit(3, 2)], { ...options, fiveBlock: true })
    expect(guillotine?.counts[0]).toBe(27)
    expect(pinwheel?.counts[0]).toBe(28)
  })

  it('only returns valid layouts, and optimal ones in most small cases', () => {
    const rng = new Random(99)
    let compared = 0
    let optimal = 0
    for (let trial = 0; trial < 150; trial++) {
      const width = 4 + rng.int(5)
      const height = 4 + rng.int(5)
      const w = 2 + rng.int(3)
      const h = 2 + rng.int(3)
      const rotate = rng.chance(0.7)
      const pattern = bestBlockPattern(width, height, [unit(w, h)], {
        fiveBlock: true,
        maxWork: 1e9,
        rotate,
      })
      const best = optimum(width, height, w, h, rotate)
      if (!pattern) {
        expect(best).toBe(0)
        continue
      }
      const count = pattern.counts[0]
      expect(pattern.placed.length / 6).toBe(count)
      expect(overlaps(pattern.placed)).toBe(false)
      for (let i = 0; i < pattern.placed.length; i += 6) {
        expect(pattern.placed[i + 1] + pattern.placed[i + 3]).toBeLessThanOrEqual(width)
        expect(pattern.placed[i + 2] + pattern.placed[i + 4]).toBeLessThanOrEqual(height)
      }
      expect(count).toBeLessThanOrEqual(best)
      compared++
      if (count === best) optimal++
    }
    expect(compared).toBeGreaterThan(100)
    expect(optimal / compared).toBeGreaterThan(0.9)
  }, 60_000)

  it('values pieces by price, not by area, for the cutting-stock pricing step', () => {
    const cheap = { ...unit(4, 4), value: 1 }
    const dear = { ...unit(5, 5), value: 100 }
    const pattern = bestBlockPattern(10, 10, [cheap, dear], {
      fiveBlock: false,
      maxWork: 1e7,
      rotate: false,
    })
    expect(pattern?.counts[1]).toBe(4)
  })

  it('gives up cleanly when the search would be too costly', () => {
    expect(
      bestBlockPattern(1_000_000, 1_000_000, [unit(7, 11)], {
        fiveBlock: true,
        maxWork: 100,
        rotate: true,
      }),
    ).toBeNull()
  })
})
