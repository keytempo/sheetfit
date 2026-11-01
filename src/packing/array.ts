/** An array of `n` zeros. Plain arrays measured as fast as typed ones here (see docs/packing.md). */
export const zeros = (n: number) => new Array<number>(n).fill(0)
