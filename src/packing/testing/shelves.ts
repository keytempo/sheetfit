/*
 * An exhaustive search over order-preserving shelf layouts, written independently of the packer's
 * dynamic program. Pieces keep their list order; each one is added to the open shelf, starts a new
 * shelf on the same sheet, or starts a new sheet, in either orientation. The result is the
 * lexicographically smallest (sheets used, height used on the last sheet).
 */
export interface Side {
  w: number
  h: number
}

export function bestShelves(binW: number, binH: number, pieces: readonly Side[], rotate: boolean) {
  let best: [number, number] = [Infinity, Infinity]

  const go = (i: number, sheets: number, closed: number, shelfW: number, shelfH: number) => {
    if (i === pieces.length) {
      const result: [number, number] = [sheets, closed + shelfH]
      if (result[0] < best[0] || (result[0] === best[0] && result[1] < best[1])) best = result
      return
    }
    const turns = rotate && pieces[i].w !== pieces[i].h ? 2 : 1
    for (let o = 0; o < turns; o++) {
      const w = o === 0 ? pieces[i].w : pieces[i].h
      const h = o === 0 ? pieces[i].h : pieces[i].w
      if (w > binW || h > binH) continue
      if (shelfW > 0 && shelfW + w <= binW && closed + Math.max(shelfH, h) <= binH) {
        go(i + 1, sheets, closed, shelfW + w, Math.max(shelfH, h))
      }
      if (shelfW > 0 && closed + shelfH + h <= binH) go(i + 1, sheets, closed + shelfH, w, h)
      go(i + 1, sheets + 1, 0, w, h)
    }
  }
  go(0, 0, 0, 0, 0)
  return { sheets: best[0], lastHeight: best[1] }
}
