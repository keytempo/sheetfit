import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRINT_OPTIONS } from '@/lib/print-options'
import { MemoryStorage } from '@/lib/presets/testing/fixtures'

describe('applyOptions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', new MemoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('changes several options in one store update and leaves every other option alone', async () => {
    const { useAppStore } = await import('./index')
    const store = useAppStore
    store.getState().setOption('unit', 'in')
    let updates = 0
    const stop = store.subscribe(() => {
      updates += 1
    })
    store.getState().applyOptions({ sheetSize: 'a3', margin: 12, cutGuides: true, gap: 2 })
    stop()

    expect(updates).toBe(1)
    expect(store.getState().options).toEqual({
      ...DEFAULT_PRINT_OPTIONS,
      unit: 'in',
      sheetSize: 'a3',
      margin: 12,
      cutGuides: true,
      gap: 2,
    })
  })

  it('does not touch the images', async () => {
    const { useAppStore } = await import('./index')
    const before = useAppStore.getState().images
    useAppStore.getState().applyOptions({ orientation: 'landscape' })
    expect(useAppStore.getState().images).toBe(before)
  })
})
