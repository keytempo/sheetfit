const MAX_PASSES = 12

/**
 * Slides every rectangle up, then left, until nothing moves. Rectangles only ever move into free
 * space, so a valid layout stays valid, and free space collects at the bottom and right.
 * `placed` holds [type, x, y, w, h, o] records and is changed in place.
 */
export function compact(placed: number[]) {
  const count = placed.length / 6
  const order = Array.from({ length: count }, (_, i) => i)
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const movedUp = slide(placed, order, 2, 1, 4, 3)
    const movedLeft = slide(placed, order, 1, 2, 3, 4)
    if (!movedUp && !movedLeft) return
  }
}

/**
 * Moves rectangles towards 0 along one axis. `along` is the offset of that axis's position in a
 * record, `across` the other axis's, and `alongSize` and `acrossSize` their sizes.
 */
function slide(
  placed: number[],
  order: number[],
  along: number,
  across: number,
  alongSize: number,
  acrossSize: number,
) {
  order.sort(
    (a, b) =>
      placed[a * 6 + along] - placed[b * 6 + along] ||
      placed[a * 6 + across] - placed[b * 6 + across],
  )
  let moved = false
  for (const i of order) {
    const base = i * 6
    const position = placed[base + along]
    const lo = placed[base + across]
    const hi = lo + placed[base + acrossSize]
    let limit = 0
    for (const j of order) {
      if (j === i) continue
      const other = j * 6
      const end = placed[other + along] + placed[other + alongSize]
      if (end > position || end <= limit) continue
      if (placed[other + across] < hi && lo < placed[other + across] + placed[other + acrossSize]) {
        limit = end
      }
    }
    if (limit < position) {
      placed[base + along] = limit
      moved = true
    }
  }
  return moved
}
