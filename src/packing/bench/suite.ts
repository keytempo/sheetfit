import type { LayoutInput } from '../../lib/layout-types.ts'
import { Random } from '../random.ts'
import { inputOf, type ImageSpec } from '../testing/fixtures.ts'
import { martelloVigo, perfectCut, PHOTO_SETS } from '../testing/generators.ts'

export interface Case {
  family: string
  input: LayoutInput
}

/** Scales the copy counts of a photo set so the total is close to `pieces`. */
function scaled(images: readonly ImageSpec[], pieces: number): ImageSpec[] {
  const total = images.reduce((sum, i) => sum + i.copies, 0)
  return images.map((i) => ({ ...i, copies: Math.max(1, Math.round((i.copies * pieces) / total)) }))
}

/** An A4 sheet with a 5 mm margin, as the app starts out. */
const a4 = { margin: 5, gap: 0 }

/** The benchmark instances for a piece count, deterministic from the count alone. */
export function suite(pieces: number): Case[] {
  const cases: Case[] = []
  for (const [name, images] of Object.entries(PHOTO_SETS)) {
    cases.push({ family: `photos: ${name}`, input: inputOf(scaled(images, pieces), a4) })
  }
  cases.push({
    family: 'photos: mixed event set, 2 mm gap, auto',
    input: inputOf(scaled(PHOTO_SETS['mixed event set'], pieces), {
      ...a4,
      gap: 2,
      orientation: 'auto',
    }),
  })

  for (const cls of [1, 3, 5, 6, 7, 8, 9, 10]) {
    const { images, bin } = martelloVigo(cls, pieces, new Random(cls * 1009 + pieces))
    const scale = bin <= 10 ? 20 : bin <= 40 ? 5 : bin <= 100 ? 2 : 1
    cases.push({
      family: `Martello-Vigo class ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][cls - 1]}`,
      input: inputOf(
        images.map((i) => ({ ...i, width: i.width * scale, height: i.height * scale })),
        { sheetSize: { width: bin * scale, height: bin * scale }, margin: 0, gap: 0 },
      ),
    })
  }

  // Perfect packings: every sheet is cut recursively into 20 rectangles, so the optimum is known.
  const rng = new Random(pieces)
  const sheets = Math.max(1, Math.round(pieces / 20))
  const perfect = Array.from({ length: sheets }, () => perfectCut(rng, 200, 280, 20, 2)).flat()
  cases.push({
    family: 'perfect packing (recursive cuts)',
    input: inputOf(perfect, { sheetSize: { width: 200, height: 280 }, margin: 0, gap: 0 }),
  })
  return cases
}
