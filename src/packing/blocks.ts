import { zeros } from './array.ts'

/*
 * Block patterns for one sheet. A pattern is built from blocks (grids of one type in one
 * orientation) joined by straight cuts (guillotine) and, for a single type, by the five-block
 * pinwheel, the simplest layout a guillotine cut cannot make. Cuts are only tried at raster points
 * (sums of piece sides), because any layout can be pushed up and left until every piece starts at
 * one. Each type has a value (by default its real area, so a gap never skews the choice); the
 * pattern maximises the total value.
 */

export interface BlockType {
  /** Inflated sides, as in the instance. */
  w: number
  h: number
  /** Real area of one piece. */
  area: number
  /** What one piece is worth to the search; its area, or a price from the cutting-stock master. */
  value: number
  /** The most pieces of one block's grid; a pattern with several blocks can hold more. */
  limit: number
}

export interface BlockPattern {
  /** [type, x, y, w, h, o] records; the type is an index into the `types` passed in. */
  placed: number[]
  /** Real area covered. */
  area: number
  /** Total value of the pieces. */
  value: number
  counts: number[]
}

export interface BlockOptions {
  /** Also try the five-block pinwheel; only used when there is a single type. */
  fiveBlock: boolean
  /** The most inner-loop steps the search may spend. Past that it gives up and returns null. */
  maxWork: number
  rotate: boolean
}

const MAX_RASTER_POINTS = 1000

/** Every sum of the sides up to `cap`, or only the multiples of each side when `mixed` is false. */
function raster(sides: readonly number[], cap: number, mixed: boolean): number[] | null {
  const points = [0]
  const seen = new Set(points)
  for (const side of sides) {
    for (let i = 0; i < points.length; i++) {
      for (let next = points[i] + side; next <= cap; next += side) {
        if (!seen.has(next)) {
          seen.add(next)
          points.push(next)
          if (points.length > MAX_RASTER_POINTS) return null
        }
        if (mixed) break
      }
      if (!mixed && i === 0) break
    }
  }
  return points.sort((a, b) => a - b)
}

/** The index of the largest value in `sorted` that is at most `x`. */
function floorIndex(sorted: readonly number[], x: number) {
  let lo = 0
  let hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (sorted[mid] <= x) lo = mid
    else hi = mid - 1
  }
  return lo
}

const distinctSorted = (sides: readonly number[]) => [...new Set(sides)].sort((a, b) => a - b)

/** The best pattern the search finds, or null when nothing fits or the work limit is exceeded. */
export function bestBlockPattern(
  binW: number,
  binH: number,
  types: readonly BlockType[],
  options: BlockOptions,
): BlockPattern | null {
  if (types.length === 0) return null
  const xSides: number[] = []
  const ySides: number[] = []
  for (const t of types) {
    xSides.push(t.w)
    ySides.push(t.h)
    if (options.rotate && t.w !== t.h) {
      xSides.push(t.h)
      ySides.push(t.w)
    }
  }
  for (const mixed of [true, false]) {
    const rx = raster(distinctSorted(xSides), binW, mixed)
    const ry = raster(distinctSorted(ySides), binH, mixed)
    if (rx && ry && (rx.length * ry.length * (rx.length + ry.length)) / 2 <= options.maxWork) {
      return new BlockSearch(binW, binH, types, options, rx, ry).run()
    }
  }
  return null
}

class BlockSearch {
  private readonly binW: number
  private readonly binH: number
  private readonly types: readonly BlockType[]
  private readonly options: BlockOptions
  private readonly rx: readonly number[]
  private readonly ry: readonly number[]
  private readonly nx: number
  private readonly ny: number
  /** Best covered area for each sub-rectangle whose sides are raster points. */
  private readonly value: number[]
  /** 0: a grid of one type, 1: a vertical cut, 2: a horizontal cut. */
  private readonly kind: number[]
  /** The grid's type and orientation as `type * 2 + o`, or the cut's raster index. */
  private readonly arg: number[]
  private readonly remX: number[]
  private readonly remY: number[]

  constructor(
    binW: number,
    binH: number,
    types: readonly BlockType[],
    options: BlockOptions,
    rx: readonly number[],
    ry: readonly number[],
  ) {
    this.binW = binW
    this.binH = binH
    this.types = types
    this.options = options
    this.rx = rx
    this.ry = ry
    this.nx = rx.length
    this.ny = ry.length
    this.value = zeros(this.nx * this.ny)
    this.kind = zeros(this.nx * this.ny)
    this.arg = zeros(this.nx * this.ny)
    this.remX = remainders(rx)
    this.remY = remainders(ry)
  }

  run(): BlockPattern | null {
    this.fill()
    const { rx, ry, ny, binW, binH } = this
    const topX = floorIndex(rx, binW)
    const topY = floorIndex(ry, binH)
    let best = this.value[topX * ny + topY]
    const pinwheel =
      this.options.fiveBlock && this.types.length === 1 ? this.searchPinwheel(best) : null
    if (pinwheel) best = pinwheel[0]
    if (best <= 0) return null

    const placed: number[] = []
    const counts = this.types.map(() => 0)
    if (pinwheel) {
      const [, i1, i2, j1, j2] = pinwheel
      const wRem = (i: number) => floorIndex(rx, binW - rx[i])
      const hRem = (j: number) => floorIndex(ry, binH - ry[j])
      this.emit(i2, j1, 0, 0, placed, counts)
      this.emit(wRem(i2), j2, rx[i2], 0, placed, counts)
      this.emit(wRem(i1), hRem(j2), rx[i1], ry[j2], placed, counts)
      this.emit(i1, hRem(j1), 0, ry[j1], placed, counts)
      this.emit(
        this.remX[i2 * this.nx + i1],
        this.remY[j2 * ny + j1],
        rx[i1],
        ry[j1],
        placed,
        counts,
      )
    } else {
      this.emit(topX, topY, 0, 0, placed, counts)
    }
    const area = counts.reduce((sum, c, t) => sum + c * this.types[t].area, 0)
    const value = counts.reduce((sum, c, t) => sum + c * this.types[t].value, 0)
    return { placed, area, value, counts }
  }

  private fill() {
    const { nx, ny, rx, ry, value, kind, arg, remX, remY, types, options } = this
    for (let ix = 0; ix < nx; ix++) {
      const x = rx[ix]
      const halfX = floorIndex(rx, x / 2)
      for (let iy = 0; iy < ny; iy++) {
        const y = ry[iy]

        let best = 0
        let bestKind = 0
        let bestArg = -1
        for (let t = 0; t < types.length; t++) {
          const type = types[t]
          const turns = options.rotate && type.w !== type.h ? 2 : 1
          for (let o = 0; o < turns; o++) {
            const w = o === 0 ? type.w : type.h
            const h = o === 0 ? type.h : type.w
            const count = Math.min(Math.floor(x / w) * Math.floor(y / h), type.limit)
            if (count * type.value > best) {
              best = count * type.value
              bestArg = t * 2 + o
            }
          }
        }
        for (let jx = 1; jx <= halfX; jx++) {
          const v = value[jx * ny + iy] + value[remX[ix * nx + jx] * ny + iy]
          if (v > best) {
            best = v
            bestKind = 1
            bestArg = jx
          }
        }
        const halfY = floorIndex(ry, y / 2)
        for (let jy = 1; jy <= halfY; jy++) {
          const v = value[ix * ny + jy] + value[ix * ny + remY[iy * ny + jy]]
          if (v > best) {
            best = v
            bestKind = 2
            bestArg = jy
          }
        }
        value[ix * ny + iy] = best
        kind[ix * ny + iy] = bestKind
        arg[ix * ny + iy] = bestArg
      }
    }
  }

  /**
   * The best pinwheel as [value, i1, i2, j1, j2] when it beats `floor`. Five blocks meet around a
   * centre block; x1 < x2 and y1 < y2 are the four cut positions.
   */
  private searchPinwheel(floor: number): number[] | null {
    const { nx, ny, rx, ry, value, remX, remY, binW, binH } = this
    const columns = rx.filter((x) => x > 0 && x < binW).length
    const rows = ry.filter((y) => y > 0 && y < binH).length
    if ((columns * columns * rows * rows) / 4 > this.options.maxWork) return null

    const wRem = Array.from(rx, (x) => floorIndex(rx, binW - x))
    const hRem = Array.from(ry, (y) => floorIndex(ry, binH - y))
    let best = floor
    let found: number[] | null = null
    for (let i1 = 1; i1 <= columns; i1++) {
      for (let i2 = i1 + 1; i2 <= columns; i2++) {
        const middleX = remX[i2 * nx + i1]
        for (let j1 = 1; j1 <= rows; j1++) {
          const sides = value[i2 * ny + j1] + value[i1 * ny + hRem[j1]]
          for (let j2 = j1 + 1; j2 <= rows; j2++) {
            const total =
              sides +
              value[wRem[i2] * ny + j2] +
              value[wRem[i1] * ny + hRem[j2]] +
              value[middleX * ny + remY[j2 * ny + j1]]
            if (total > best) {
              best = total
              found = [total, i1, i2, j1, j2]
            }
          }
        }
      }
    }
    return found
  }

  /** Writes the pattern for the sub-rectangle (ix, iy), offset by (ox, oy). */
  private emit(ix: number, iy: number, ox: number, oy: number, placed: number[], counts: number[]) {
    const { nx, ny, rx, ry, kind, arg, remX, remY, types } = this
    const here = ix * ny + iy
    if (this.value[here] <= 0) return
    if (kind[here] === 1) {
      const jx = arg[here]
      this.emit(jx, iy, ox, oy, placed, counts)
      this.emit(remX[ix * nx + jx], iy, ox + rx[jx], oy, placed, counts)
    } else if (kind[here] === 2) {
      const jy = arg[here]
      this.emit(ix, jy, ox, oy, placed, counts)
      this.emit(ix, remY[iy * ny + jy], ox, oy + ry[jy], placed, counts)
    } else {
      const t = arg[here] >> 1
      const o = arg[here] & 1
      const w = o === 0 ? types[t].w : types[t].h
      const h = o === 0 ? types[t].h : types[t].w
      const columns = Math.floor(rx[ix] / w)
      const count = Math.min(columns * Math.floor(ry[iy] / h), types[t].limit)
      for (let n = 0; n < count; n++) {
        placed.push(t, ox + (n % columns) * w, oy + Math.floor(n / columns) * h, w, h, o)
      }
      counts[t] += count
    }
  }
}

/** remainder[i * n + j] is the raster index at or below r[i] - r[j], for j <= i. */
function remainders(r: readonly number[]) {
  const n = r.length
  const lookup = zeros(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) lookup[i * n + j] = floorIndex(r, r[i] - r[j])
  }
  return lookup
}
