/** A small seeded generator (mulberry32). The packer never calls Math.random. */
export class Random {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** An integer in [0, bound). */
  int(bound: number): number {
    return Math.floor(this.next() * bound)
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability
  }

  /** Fisher–Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      const held = items[i]
      items[i] = items[j]
      items[j] = held
    }
    return items
  }
}
