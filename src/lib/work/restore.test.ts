import { describe, expect, it, vi } from 'vitest'
import { restoreWork, SKIP_REASONS } from './restore'
import { createMemoryStore } from './testing/memory-store'
import type { StoredImage, WorkMeta } from './types'

const stored = (id: string, extra: Partial<StoredImage> = {}): StoredImage => ({
  id,
  name: `${id}.jpg`,
  type: 'image/jpeg',
  width: 4000,
  height: 3000,
  bytes: 3,
  file: new Blob(['abc'], { type: 'image/jpeg' }),
  thumbnail: new Blob(['t']),
  ...extra,
})
const metaOf = (...ids: string[]): WorkMeta => ({
  schema: 1,
  savedAt: 1,
  items: ids.map((id, i) => ({ id, name: `${id}.jpg`, copies: i + 1, percent: 100 + i })),
})
const showable = { canShow: () => Promise.resolve(true) }

async function arrange(
  ids: string[],
  mutate: (m: ReturnType<typeof createMemoryStore>) => void = () => {},
) {
  const memory = createMemoryStore()
  await memory.store.save(
    ids.map((id) => stored(id)),
    [],
    metaOf(...ids),
  )
  mutate(memory)
  return memory
}

describe('restoreWork', () => {
  it('puts everything back in the saved order with its copies and size', async () => {
    const { store } = await arrange(['b', 'a', 'c'])
    const result = await restoreWork(store, showable)
    if (result.kind !== 'restored') throw new Error('expected restored')
    expect(result.images.map((i) => [i.id, i.copies, i.percent])).toEqual([
      ['b', 1, 100],
      ['a', 2, 101],
      ['c', 3, 102],
    ])
    expect(result.skipped).toEqual([])
    expect(result.saved).toHaveLength(3)
  })

  it('restores the original file as a File of the same name and type, with the saved size', async () => {
    const { store } = await arrange(['a'])
    const result = await restoreWork(store, showable)
    if (result.kind !== 'restored') throw new Error('expected restored')
    const [image] = result.images
    expect(image.file).toBeInstanceOf(File)
    expect(image.file.name).toBe('a.jpg')
    expect(image.file.type).toBe('image/jpeg')
    expect(await image.file.text()).toBe('abc')
    expect(image).toMatchObject({ width: 4000, height: 3000 })
  })

  it('keeps photos with the same file name apart', async () => {
    const memory = createMemoryStore()
    await memory.store.save(
      [stored('x1', { name: 'IMG.jpg' }), stored('x2', { name: 'IMG.jpg' })],
      [],
      {
        ...metaOf('x1', 'x2'),
        items: [
          { id: 'x1', name: 'IMG.jpg', copies: 1, percent: 100 },
          { id: 'x2', name: 'IMG.jpg', copies: 4, percent: 100 },
        ],
      },
    )
    const result = await restoreWork(memory.store, showable)
    expect(result.kind === 'restored' && result.images.map((i) => [i.id, i.copies])).toEqual([
      ['x1', 1],
      ['x2', 4],
    ])
  })

  it('skips a photo whose record is gone, says which and why, and restores the rest', async () => {
    const { store } = await arrange(['a', 'b', 'c'], (m) => m.records.delete('b'))
    const result = await restoreWork(store, showable)
    if (result.kind !== 'restored') throw new Error('expected restored')
    expect(result.images.map((i) => i.id)).toEqual(['a', 'c'])
    expect(result.skipped).toEqual([{ name: 'b.jpg', reason: 'missing' }])
  })

  it('skips a file that is shorter than it was saved', async () => {
    const { store } = await arrange(['a', 'b'], (m) =>
      m.records.set('a', stored('a', { file: new Blob(['ab']) })),
    )
    const result = await restoreWork(store, showable)
    expect(result.kind === 'restored' && result.skipped).toEqual([
      { name: 'a.jpg', reason: 'cut-off' },
    ])
  })

  it('skips an empty file and an empty thumbnail', async () => {
    const { store } = await arrange(['a', 'b'], (m) => {
      m.records.set('a', stored('a', { file: new Blob([]), bytes: 0 }))
      m.records.set('b', stored('b', { thumbnail: new Blob([]) }))
    })
    const result = await restoreWork(store, showable)
    expect(result.kind === 'restored' && result.skipped.map((s) => s.reason)).toEqual([
      'cut-off',
      'unreadable',
    ])
  })

  it('skips a thumbnail the browser cannot show', async () => {
    const { store } = await arrange(['a', 'b'])
    const canShow = vi.fn((blob: Blob) => Promise.resolve(blob.size !== 1 || false))
    const result = await restoreWork(store, { canShow })
    expect(result.kind === 'restored' && result.images).toHaveLength(0)
    expect(canShow).toHaveBeenCalledTimes(2)
  })

  it('skips a record that is not shaped like a photo', async () => {
    const { store } = await arrange(['a', 'b'], (m) => m.records.set('a', { id: 'a', junk: true }))
    const result = await restoreWork(store, showable)
    expect(result.kind === 'restored' && result.skipped).toEqual([
      { name: 'a.jpg', reason: 'unreadable' },
    ])
  })

  it('reports progress for every photo, usable or not', async () => {
    const { store } = await arrange(['a', 'b', 'c'], (m) => m.records.delete('b'))
    const onChecked = vi.fn()
    await restoreWork(store, { ...showable, onChecked })
    expect(onChecked).toHaveBeenCalledTimes(3)
  })

  it('has a plain sentence for every reason', () => {
    expect(Object.keys(SKIP_REASONS).sort()).toEqual(['cut-off', 'missing', 'unreadable'])
  })

  it('finds nothing in an empty store', async () => {
    expect(await restoreWork(createMemoryStore().store, showable)).toEqual({ kind: 'nothing' })
  })

  it('leaves work from a newer version alone', async () => {
    const memory = await arrange(['a'], (m) => (m.meta = { schema: 7, items: [] }))
    expect(await restoreWork(memory.store, showable)).toEqual({ kind: 'newer' })
  })

  it('treats an unreadable list as nothing, and names the photos to clear away', async () => {
    const memory = await arrange(['a', 'b'], (m) => (m.meta = 'garbage'))
    expect(await restoreWork(memory.store, showable)).toEqual({
      kind: 'corrupt',
      storedIds: ['a', 'b'],
    })
  })

  it('reports photos stored but never listed, so they can be cleared', async () => {
    const memory = await arrange(['a'], (m) => m.records.set('stray', stored('stray')))
    const result = await restoreWork(memory.store, showable)
    expect(result.kind === 'restored' && result.storedIds.sort()).toEqual(['a', 'stray'])
  })
})
