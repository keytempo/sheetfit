import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from '@/lib/presets/testing/fixtures'
import type { NewImage } from './types'

type Store = typeof import('./index').useAppStore
let useAppStore: Store

const item = (id: string): NewImage => ({
  id,
  name: `${id}.jpg`,
  file: new File(['x'], `${id}.jpg`, { type: 'image/jpeg' }),
  thumbnail: new Blob(['t']),
  width: 800,
  height: 600,
  copies: 1,
  percent: 100,
})

const selected = () => useAppStore.getState().selectedImageId

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('localStorage', new MemoryStorage())
  useAppStore = (await import('./index')).useAppStore
  const { beginImport, commitImport } = useAppStore.getState()
  const epoch = beginImport(3)
  commitImport([item('a'), item('b'), item('c')], 3, epoch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('selection', () => {
  it('selects an image and deselects with null', () => {
    const { selectImage } = useAppStore.getState()
    selectImage('b')
    expect(selected()).toBe('b')
    selectImage(null)
    expect(selected()).toBeNull()
  })

  it('refuses to select an image that does not exist', () => {
    const { selectImage } = useAppStore.getState()
    selectImage('a')
    selectImage('gone')
    expect(selected()).toBe('a')
  })

  it('cannot be left pointing at a removed image by a click that arrives after the removal', () => {
    const { selectImage, removeImages } = useAppStore.getState()
    selectImage('b')
    removeImages(['b'])
    expect(selected()).toBeNull()
    selectImage('b')
    expect(selected()).toBeNull()
  })

  it('keeps the selection when a different image is removed', () => {
    const { selectImage, removeImages } = useAppStore.getState()
    selectImage('a')
    removeImages(['c'])
    expect(selected()).toBe('a')
  })

  it('selects the restored image after an Undo', () => {
    const { selectImage, removeImages, restoreImages } = useAppStore.getState()
    selectImage('a')
    const removed = removeImages(['b'])
    restoreImages(removed)
    expect(selected()).toBe('b')
  })

  it('is cleared by Clear all', () => {
    const { selectImage, clearImages } = useAppStore.getState()
    selectImage('a')
    clearImages()
    expect(selected()).toBeNull()
  })
})

describe('importing a batch', () => {
  it('adds the whole batch in one update, after what is there, and releases its placeholders', () => {
    const { beginImport, commitImport } = useAppStore.getState()
    let updates = 0
    const stop = useAppStore.subscribe((state, previous) => {
      if (state.images !== previous.images) updates += 1
    })
    const epoch = beginImport(2)
    expect(useAppStore.getState().loadingCount).toBe(2)
    expect(commitImport([item('d'), item('e')], 2, epoch)).toBe(true)
    stop()
    expect(updates).toBe(1)
    const state = useAppStore.getState()
    expect(state.images.map((image) => image.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(state.loadingCount).toBe(0)
  })

  it('can put a batch before what is already listed, as restored work goes before photos added meanwhile', () => {
    const { beginImport, commitImport } = useAppStore.getState()
    const epoch = beginImport(2, 'restore')
    expect(useAppStore.getState().importKind).toBe('restore')
    commitImport([item('d'), item('e')], 2, epoch, 'start')
    expect(useAppStore.getState().images.map((image) => image.id)).toEqual([
      'd',
      'e',
      'a',
      'b',
      'c',
    ])
  })

  it('drops a batch that was still loading when Clear all happened, and reports it', () => {
    const { beginImport, commitImport, clearImages } = useAppStore.getState()
    const epoch = beginImport(2)
    clearImages()
    expect(useAppStore.getState().loadingCount).toBe(0)
    expect(commitImport([item('d'), item('e')], 2, epoch)).toBe(false)
    expect(useAppStore.getState().images).toEqual([])
    expect(useAppStore.getState().loadingCount).toBe(0)
  })

  it('counts the files of two batches loading at once and releases each in its turn', () => {
    const { beginImport, commitImport } = useAppStore.getState()
    const first = beginImport(3)
    const second = beginImport(2)
    expect(useAppStore.getState().loadingCount).toBe(5)
    commitImport([item('d')], 3, first)
    expect(useAppStore.getState().loadingCount).toBe(2)
    commitImport([item('e'), item('f')], 2, second)
    expect(useAppStore.getState().loadingCount).toBe(0)
    expect(useAppStore.getState().images.map((image) => image.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ])
  })

  it('creates the object URLs itself, so a dropped batch leaves none behind', () => {
    const { beginImport, commitImport } = useAppStore.getState()
    const epoch = beginImport(1)
    commitImport([item('d')], 1, epoch)
    const added = useAppStore.getState().images.at(-1)
    expect(added?.url.startsWith('blob:')).toBe(true)
    expect(added?.thumbUrl.startsWith('blob:')).toBe(true)
  })

  it('reports decoding progress and resets it when the batch is added', () => {
    const { beginImport, reportDecoded, commitImport } = useAppStore.getState()
    const epoch = beginImport(2)
    reportDecoded()
    expect(useAppStore.getState().decodedCount).toBe(1)
    commitImport([item('d'), item('e')], 2, epoch)
    expect(useAppStore.getState().decodedCount).toBe(0)
  })
})
