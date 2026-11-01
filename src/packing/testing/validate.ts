import type { LayoutInput, LayoutResult } from '../../lib/layout-types.ts'

/*
 * An independent referee. It re-derives every rule from the input and the result alone and shares
 * no code with the packer. Lengths are compared as whole micrometres, the packer's resolution.
 */

const um = (mm: number) => Math.round(mm * 1000)
const side = (mm: number) => Math.max(1, um(mm))

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Returns every rule the layout breaks; an empty list means it is valid. */
export function validateLayout(input: LayoutInput, result: LayoutResult): string[] {
  const errors: string[] = []
  const fail = (message: string) => errors.length < 40 && errors.push(message)

  const short = Math.min(um(input.sheetSize.width), um(input.sheetSize.height))
  const long = Math.max(um(input.sheetSize.width), um(input.sheetSize.height))
  const landscape = result.orientation === 'landscape'
  if (input.orientation === 'portrait' && landscape) fail('portrait requested, landscape returned')
  if (input.orientation === 'landscape' && !landscape)
    fail('landscape requested, portrait returned')
  const sheetW = landscape ? long : short
  const sheetH = landscape ? short : long
  const margin = um(input.margin)
  const gap = um(input.gap)
  if (um(result.sheetWidth) !== sheetW || um(result.sheetHeight) !== sheetH) {
    fail(`sheet size ${result.sheetWidth} x ${result.sheetHeight} does not match the input`)
  }
  if (um(result.margin) !== margin) fail('margin does not match the input')
  const usableW = sheetW - 2 * margin
  const usableH = sheetH - 2 * margin
  const usableUm2 = Math.max(0, usableW) * Math.max(0, usableH)

  // Every piece exactly once, as the very same object, either placed or listed as unplaceable.
  const seen = new Map<string, number>()
  const indexOf = new Map(input.pieces.map((p, i) => [p, i]))
  const place = (piece: LayoutInput['pieces'][number], where: string) => {
    if (!indexOf.has(piece)) fail(`${where}: piece ${piece.id} is not one of the input objects`)
    seen.set(piece.id, (seen.get(piece.id) ?? 0) + 1)
  }

  const boxesPerSheet: Box[][] = []
  result.sheets.forEach((sheet, position) => {
    if (sheet.index !== position) fail(`sheet ${position} has index ${sheet.index}`)
    if (sheet.pieces.length === 0) fail(`sheet ${position} is empty`)
    const boxes: Box[] = []
    let used = 0
    let previous = -1
    for (const placed of sheet.pieces) {
      place(placed.piece, `sheet ${position}`)
      const order = indexOf.get(placed.piece) ?? -1
      if (order <= previous) fail(`sheet ${position}: pieces are not in list order`)
      previous = order

      const natW = side(placed.piece.width)
      const natH = side(placed.piece.height)
      const w = um(placed.width)
      const h = um(placed.height)
      if (placed.rotated) {
        if (!input.allowRotation) fail(`${placed.piece.id} is rotated but rotation is off`)
        if (w !== natH || h !== natW)
          fail(`${placed.piece.id} rotated: ${w}x${h} is not ${natH}x${natW}`)
      } else if (w !== natW || h !== natH) {
        fail(`${placed.piece.id} changed size: ${w}x${h} is not ${natW}x${natH}`)
      }
      const x = um(placed.x)
      const y = um(placed.y)
      if (x < margin || y < margin || x + w > sheetW - margin || y + h > sheetH - margin) {
        fail(`${placed.piece.id} on sheet ${position} is outside the margins`)
      }
      boxes.push({ x, y, w, h })
      used += w * h
    }
    boxesPerSheet.push(boxes)

    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const p = boxes[a]
        const q = boxes[b]
        const apart =
          p.x + p.w + gap <= q.x ||
          q.x + q.w + gap <= p.x ||
          p.y + p.h + gap <= q.y ||
          q.y + q.h + gap <= p.y
        if (!apart)
          fail(`sheet ${position}: pieces ${a} and ${b} overlap or are closer than the gap`)
      }
    }

    const { stats } = sheet
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
    if (stats.pieceCount !== sheet.pieces.length) fail(`sheet ${position}: pieceCount is wrong`)
    if (!close(stats.usableArea, usableUm2 / 1e6)) fail(`sheet ${position}: usableArea is wrong`)
    if (!close(stats.usedArea, used / 1e6)) fail(`sheet ${position}: usedArea is wrong`)
    if (!close(stats.usedArea + stats.wastedArea, stats.usableArea)) {
      fail(`sheet ${position}: used + wasted is not the usable area`)
    }
    const fill = usableUm2 > 0 ? (used / usableUm2) * 100 : 0
    if (!close(stats.fillPercent, fill)) fail(`sheet ${position}: fillPercent is wrong`)
  })

  for (const entry of result.unplaceable ?? []) {
    place(entry.piece, 'unplaceable')
    const w =
      Number.isFinite(entry.piece.width) && entry.piece.width > 0 ? side(entry.piece.width) : 0
    const h =
      Number.isFinite(entry.piece.height) && entry.piece.height > 0 ? side(entry.piece.height) : 0
    const fits =
      usableW > 0 &&
      usableH > 0 &&
      ((w <= usableW && h <= usableH) || (input.allowRotation && h <= usableW && w <= usableH))
    if (entry.reason === 'invalid-size' && w > 0 && h > 0)
      fail(`${entry.piece.id} has a valid size`)
    if (entry.reason === 'no-usable-area' && usableW > 0 && usableH > 0) {
      fail(`${entry.piece.id}: there is usable area`)
    }
    if (entry.reason === 'too-large' && (fits || w === 0 || h === 0)) {
      fail(`${entry.piece.id} is called too large but fits`)
    }
    if (entry.reason !== 'invalid-size' && entry.reason !== 'no-usable-area' && fits) {
      fail(`${entry.piece.id} fits the usable area but is unplaceable`)
    }
  }

  for (const piece of input.pieces) {
    const count = seen.get(piece.id) ?? 0
    if (count !== 1) fail(`piece ${piece.id} appears ${count} times`)
  }

  // Overall figures are sums.
  const totals = result.totals
  if (totals) {
    const used = result.sheets.reduce((s, sh) => s + sh.stats.usedArea, 0)
    const usable = result.sheets.reduce((s, sh) => s + sh.stats.usableArea, 0)
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
    if (totals.sheetCount !== result.sheets.length) fail('totals.sheetCount is wrong')
    if (!close(totals.usedArea, used)) fail('totals.usedArea is not the sum of the sheets')
    if (!close(totals.usableArea, usable)) fail('totals.usableArea is not the sum of the sheets')
    if (!close(totals.usedArea + totals.wastedArea, totals.usableArea)) fail('totals do not add up')
    if (usable > 0 && !close(totals.fillPercent, (used / usable) * 100)) fail('totals.fillPercent')
  }

  if (result.lowerBound !== undefined && result.sheets.length < result.lowerBound) {
    fail(`${result.sheets.length} sheets is below the claimed lower bound ${result.lowerBound}`)
  }
  if (result.status === 'optimal' && result.lowerBound !== undefined) {
    // "Optimal" with no matching bound is only possible through the exact solver, which is checked
    // against a brute-force solver in its own test.
    if (result.sheets.length < result.lowerBound) fail('optimal below its bound')
  }

  if (input.ordering === 'strict') errors.push(...strictOrderErrors(input, result, boxesPerSheet))
  return errors
}

/**
 * Strict order: along the list, the sheet never goes back, and on one sheet the reading position
 * (top to bottom, then left to right) strictly advances.
 */
function strictOrderErrors(
  input: LayoutInput,
  result: LayoutResult,
  boxesPerSheet: readonly Box[][],
) {
  const errors: string[] = []
  const where = new Map<string, { sheet: number; x: number; y: number }>()
  result.sheets.forEach((sheet, position) => {
    sheet.pieces.forEach((placed, i) => {
      where.set(placed.piece.id, {
        sheet: position,
        x: boxesPerSheet[position][i].x,
        y: boxesPerSheet[position][i].y,
      })
    })
  })
  let previous: { sheet: number; x: number; y: number } | undefined
  let previousId = ''
  for (const piece of input.pieces) {
    const here = where.get(piece.id)
    if (!here) continue
    if (previous) {
      const ok =
        here.sheet > previous.sheet ||
        (here.sheet === previous.sheet &&
          (here.y > previous.y || (here.y === previous.y && here.x > previous.x)))
      if (!ok && errors.length < 10) {
        errors.push(`strict order broken between ${previousId} and ${piece.id}`)
      }
    }
    previous = here
    previousId = piece.id
  }
  return errors
}
