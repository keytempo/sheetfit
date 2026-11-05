import { describe, expect, it } from 'vitest'
import { addPreset, removePreset, renamePreset } from '@/lib/presets/operations'
import { STORAGE_KEY } from '@/lib/presets/schema'
import { counter, MemoryStorage, settings } from '@/lib/presets/testing/fixtures'
import { createPresetBook } from './presets'

const savedDocument = (storage: MemoryStorage) =>
  JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as {
    presets: unknown[]
    activeId: string | null
  }

/** Two tabs are two books over one storage, each with ids of its own. */
const tabs = () => {
  const storage = new MemoryStorage()
  return {
    storage,
    a: createPresetBook(storage, counter()),
    b: createPresetBook(
      storage,
      (() => {
        const next = counter()
        return () => `b-${next()}`
      })(),
    ),
  }
}

const add = (book: ReturnType<typeof createPresetBook>, name: string) =>
  book.commit(
    (presets) => addPreset(presets, name, settings(), book.makeId),
    (preset) => preset.id,
  )

const names = (book: ReturnType<typeof createPresetBook>) =>
  book.store.getState().presets.map((preset) => preset.name)

describe('two tabs', () => {
  it('never lose each other’s changes, even before the other tab hears about them', () => {
    const { a, b, storage } = tabs()
    add(a, 'One')
    add(b, 'Two') // b has not been told about One, but its change reads storage first
    expect(names(b)).toEqual(['One', 'Two'])
    add(a, 'Three')
    expect(names(a)).toEqual(['One', 'Two', 'Three'])
    expect(savedDocument(storage).presets).toHaveLength(3)
  })

  it('pick up the other tab’s changes when told to reload, and keep their own active preset', () => {
    const { a, b } = tabs()
    add(a, 'One')
    b.reload()
    expect(names(b)).toEqual(['One'])
    expect(b.store.getState().activeId).toBeNull()
    expect(a.store.getState().activeId).not.toBeNull()
    add(b, 'Two')
    a.reload()
    expect(names(a)).toEqual(['One', 'Two'])
    expect(a.store.getState().activeId).toBe(a.store.getState().presets[0].id)
  })

  it('lose the active preset when the other tab deletes it, and cannot apply it', () => {
    const { a, b } = tabs()
    const one = add(a, 'One')
    if (!one.ok) throw new Error('no')
    b.reload()
    b.commit((presets) => removePreset(presets, one.value.id))
    expect(a.activate(one.value.id)).toEqual({ ok: false, reason: 'not-found' })
    expect(names(a)).toEqual([])
    expect(a.store.getState().activeId).toBeNull()
  })

  it('refuse a rename of a preset that the other tab deleted, and say so', () => {
    const { a, b } = tabs()
    const one = add(a, 'One')
    if (!one.ok) throw new Error('no')
    b.reload()
    b.commit((presets) => removePreset(presets, one.value.id))
    expect(a.commit((presets) => renamePreset(presets, one.value.id, 'Uno'))).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('refuse the same name twice even when the other tab just took it', () => {
    const { a, b } = tabs()
    add(a, 'Photos')
    expect(add(b, 'photos')).toEqual({ ok: false, reason: 'name-taken' })
  })
})

describe('a change that fails', () => {
  it('writes nothing and leaves the list alone', () => {
    const { a, storage } = tabs()
    add(a, 'One')
    const writes = storage.writes
    expect(add(a, 'one')).toEqual({ ok: false, reason: 'name-taken' })
    expect(add(a, '')).toEqual({ ok: false, reason: 'name-empty' })
    expect(storage.writes).toBe(writes)
    expect(names(a)).toEqual(['One'])
  })
})

describe('active preset', () => {
  it('is set by saving and by activating, written with the list, and cleared by deleting it', () => {
    const { a, storage } = tabs()
    const one = add(a, 'One')
    const two = add(a, 'Two')
    if (!one.ok || !two.ok) throw new Error('no')
    expect(a.store.getState().activeId).toBe(two.value.id)
    expect(a.activate(one.value.id).ok).toBe(true)
    expect(savedDocument(storage).activeId).toBe(one.value.id)
    a.commit((presets) => removePreset(presets, one.value.id))
    expect(a.store.getState().activeId).toBeNull()
  })

  it('survives a reload of the page', () => {
    const { storage, a } = tabs()
    const one = add(a, 'One')
    if (!one.ok) throw new Error('no')
    const reopened = createPresetBook(storage, counter())
    expect(reopened.store.getState().activeId).toBe(one.value.id)
  })
})

describe('storage that fails', () => {
  it('keeps presets in memory when it is full, says so, and saves everything once it can', () => {
    const { a, storage } = tabs()
    add(a, 'Saved')
    storage.failWrites = 'full'
    expect(add(a, 'Kept in memory').ok).toBe(true)
    expect(a.store.getState().availability).toBe('full')
    expect(names(a)).toEqual(['Saved', 'Kept in memory'])
    a.reload() // a tab that holds the only copy does not read storage
    expect(names(a)).toEqual(['Saved', 'Kept in memory'])
    expect(add(a, 'Also kept').ok).toBe(true)
    storage.failWrites = null
    expect(add(a, 'Back').ok).toBe(true)
    expect(a.store.getState().availability).toBe('ok')
    expect(
      createPresetBook(storage, counter())
        .store.getState()
        .presets.map((p) => p.name),
    ).toEqual(['Saved', 'Kept in memory', 'Also kept', 'Back'])
  })

  it('works without any storage, and applying still works', () => {
    const blocked = new MemoryStorage()
    blocked.failReads = true
    blocked.failWrites = 'blocked'
    const book = createPresetBook(blocked, counter())
    expect(book.store.getState().availability).toBe('unavailable')
    const one = add(book, 'One')
    expect(one.ok).toBe(true)
    expect(book.store.getState().availability).toBe('unavailable')
    expect(names(book)).toEqual(['One'])
    expect(one.ok && book.activate(one.value.id).ok).toBe(true)
    expect(createPresetBook(null).store.getState().availability).toBe('unavailable')
  })

  it('replaces unreadable saved text on the next change, and says so until then', () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, '{broken')
    const book = createPresetBook(storage, counter())
    expect(book.store.getState().notice).toEqual({ kind: 'unreadable' })
    add(book, 'Fresh')
    expect(book.store.getState().notice).toBeNull()
    expect(createPresetBook(storage, counter()).store.getState().presets).toHaveLength(1)
  })

  it('clears a skipped-entries notice when the list is saved again, which drops them', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, presets: [{ name: 'Ok', settings: settings() }, 5] }),
    )
    const book = createPresetBook(storage, counter())
    expect(book.store.getState().notice).toMatchObject({ kind: 'skipped' })
    add(book, 'Next')
    expect(book.store.getState().notice).toBeNull()
    expect(savedDocument(storage).presets).toHaveLength(2)
  })
})

describe('presets from a newer version', () => {
  const newer = () => {
    const storage = new MemoryStorage()
    const text = JSON.stringify({
      version: 2,
      presets: [{ id: 'x', name: 'Future', settings: settings({ sheetSize: 'a3' }), more: 1 }],
      extra: true,
    })
    storage.setItem(STORAGE_KEY, text)
    return { storage, text, book: createPresetBook(storage, counter()) }
  }

  it('can be used but never changed or overwritten', () => {
    const { storage, text, book } = newer()
    expect(book.store.getState().availability).toBe('read-only')
    expect(add(book, 'New')).toEqual({ ok: false, reason: 'read-only' })
    expect(book.commit((presets) => removePreset(presets, 'x'))).toEqual({
      ok: false,
      reason: 'read-only',
    })
    expect(book.activate('x').ok).toBe(true)
    expect(book.store.getState().activeId).toBe('x')
    expect(storage.getItem(STORAGE_KEY)).toBe(text)
  })
})
