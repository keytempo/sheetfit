import { DEFAULT_PRINT_OPTIONS } from '../../print-options'
import type { PresetSettings } from '../schema'
import { settingsFromOptions } from '../settings'
import type { StorageLike } from '../storage'

/** A stand-in for `localStorage` that can be made to fail the way a browser's can. */
export class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>()
  failReads = false
  failWrites: 'full' | 'blocked' | null = null
  writes = 0

  getItem(key: string) {
    if (this.failReads) throw new DOMException('Access denied', 'SecurityError')
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string) {
    if (this.failWrites === 'full') throw new DOMException('Full', 'QuotaExceededError')
    if (this.failWrites === 'blocked') throw new DOMException('Access denied', 'SecurityError')
    this.data.set(key, value)
    this.writes += 1
  }
}

export const settings = (changes: Partial<PresetSettings> = {}): PresetSettings => ({
  ...settingsFromOptions(DEFAULT_PRINT_OPTIONS),
  ...changes,
})

/** Ids that are the same on every run: id1, id2, ... */
export function counter() {
  let n = 0
  return () => `id${++n}`
}
