/*
 * An exhaustive reference solver for tiny integer instances. It shares nothing with the packer: it
 * scans the cells of a grid in reading order and, at the first empty cell, either starts one of
 * the unplaced rectangles there (in each orientation) or leaves the cell empty. Every packing with
 * integer coordinates is visited, so the answers are exact.
 */

export interface Box {
  w: number
  h: number
}

/** True when all the boxes fit on one W x H sheet without overlapping. */
export function fitsOnSheet(width: number, height: number, boxes: readonly Box[], rotate: boolean) {
  const area = boxes.reduce((sum, b) => sum + b.w * b.h, 0)
  if (area > width * height) return false
  const grid = new Uint8Array(width * height)
  const placed = boxes.map(() => false)

  const go = (from: number, left: number, waste: number): boolean => {
    if (left === 0) return true
    let cell = from
    while (cell < grid.length && grid[cell] !== 0) cell++
    if (cell === grid.length) return false
    const x = cell % width
    const y = Math.floor(cell / width)

    const tried = new Set<string>()
    for (let i = 0; i < boxes.length; i++) {
      if (placed[i]) continue
      const key = `${boxes[i].w}x${boxes[i].h}`
      if (tried.has(key)) continue
      tried.add(key)
      const turns = rotate && boxes[i].w !== boxes[i].h ? 2 : 1
      for (let o = 0; o < turns; o++) {
        const w = o === 0 ? boxes[i].w : boxes[i].h
        const h = o === 0 ? boxes[i].h : boxes[i].w
        if (x + w > width || y + h > height) continue
        let free = true
        for (let dy = 0; dy < h && free; dy++) {
          for (let dx = 0; dx < w; dx++) {
            if (grid[(y + dy) * width + x + dx] !== 0) {
              free = false
              break
            }
          }
        }
        if (!free) continue
        for (let dy = 0; dy < h; dy++) grid.fill(1, (y + dy) * width + x, (y + dy) * width + x + w)
        placed[i] = true
        const ok = go(cell + w, left - 1, waste)
        placed[i] = false
        for (let dy = 0; dy < h; dy++) grid.fill(0, (y + dy) * width + x, (y + dy) * width + x + w)
        if (ok) return true
      }
    }
    if (waste > 0) {
      grid[cell] = 2
      const ok = go(cell + 1, left, waste - 1)
      grid[cell] = 0
      if (ok) return true
    }
    return false
  }
  return go(0, boxes.length, width * height - area)
}

/**
 * The fewest sheets for the boxes, or Infinity when one box fits no sheet. Subsets that fit on one
 * sheet are found by `fitsOnSheet`, then a dynamic program over subsets joins them.
 */
export function minSheets(width: number, height: number, boxes: readonly Box[], rotate: boolean) {
  const n = boxes.length
  if (n === 0) return 0
  const fits = new Map<number, boolean>()
  const feasible = (mask: number) => {
    let known = fits.get(mask)
    if (known === undefined) {
      const subset = boxes.filter((_, i) => mask & (1 << i))
      known = fitsOnSheet(width, height, subset, rotate)
      fits.set(mask, known)
    }
    return known
  }
  const best = new Array<number>(1 << n).fill(Infinity)
  best[0] = 0
  for (let mask = 1; mask < 1 << n; mask++) {
    const low = mask & -mask
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
      if (!(sub & low) || best[mask ^ sub] === Infinity) continue
      if (best[mask ^ sub] + 1 < best[mask] && feasible(sub)) best[mask] = best[mask ^ sub] + 1
    }
  }
  return best[(1 << n) - 1]
}
