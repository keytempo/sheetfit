import type { LayoutInput, LayoutResult } from '../lib/layout-types.ts'
import { Packer } from './packer.ts'
import { toLayoutResult } from './result.ts'
import type { PackOptions } from './types.ts'

/**
 * The fast, synchronous packer. It runs a fixed set of constructive heuristics, never reads the
 * clock, and always returns the same layout for the same input. `refineLayout` takes it further
 * in the background.
 */
export function packLayout(input: LayoutInput, options: PackOptions = {}): LayoutResult {
  return toLayoutResult(input, new Packer(input, options).layout)
}
