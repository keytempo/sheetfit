import { describe, expect, it } from 'vitest'
import { LIMITS } from '../print-options'
import { assembleLoad, parseMeta, readStoredImage } from './meta'

const item = (id: string, extra: object = {}) => ({
  id,
  name: `${id}.jpg`,
  copies: 2,
  percent: 100,
  ...extra,
})
const meta = (items: unknown[], extra: object = {}) => ({ schema: 1, items, savedAt: 5, ...extra })
const record = (id: string) => ({
  id,
  name: `${id}.jpg`,
  type: 'image/jpeg',
  width: 800,
  height: 600,
  bytes: 3,
  file: new Blob(['abc']),
  thumbnail: new Blob(['t']),
})

describe('parseMeta', () => {
  it('reads what was saved, in order', () => {
    const parsed = parseMeta(meta([item('b'), item('a', { copies: 5, percent: 150 })]))
    expect(parsed).toEqual({
      kind: 'ok',
      meta: { schema: 1, savedAt: 5, items: [item('b'), item('a', { copies: 5, percent: 150 })] },
    })
  })

  it('puts values back inside their limits, and whole copies', () => {
    const parsed = parseMeta(
      meta([item('a', { copies: 2.6, percent: 9999 }), item('b', { copies: -4, percent: 1 })]),
    )
    if (parsed.kind !== 'ok') throw new Error('expected ok')
    expect(parsed.meta.items[0]).toMatchObject({ copies: 3, percent: LIMITS.percent.max })
    expect(parsed.meta.items[1]).toMatchObject({
      copies: LIMITS.copies.min,
      percent: LIMITS.percent.min,
    })
  })

  it('drops an item that cannot be read and keeps the repeated id once, in its first place', () => {
    const parsed = parseMeta(
      meta([
        item('a'),
        null,
        item(''),
        item('b', { copies: 'x' }),
        item('a', { copies: 9 }),
        7,
        item('c'),
      ]),
    )
    if (parsed.kind !== 'ok') throw new Error('expected ok')
    expect(parsed.meta.items.map((i) => [i.id, i.copies])).toEqual([
      ['a', 2],
      ['c', 2],
    ])
  })

  it.each([
    ['not an object', 'nope'],
    ['an array', []],
    ['null', null],
    ['no schema', { items: [] }],
    ['a schema that is not a whole number', meta([], { schema: 1.5 })],
    ['a schema below 1', meta([], { schema: 0 })],
    ['no items', { schema: 1 }],
    ['items that are not a list', meta('x' as never)],
  ])('treats %s as corrupt', (_name, raw) => {
    expect(parseMeta(raw)).toEqual({ kind: 'corrupt' })
  })

  it('leaves work from a newer version alone and says so', () => {
    expect(parseMeta(meta([item('a')], { schema: 2 }))).toEqual({ kind: 'newer' })
    expect(parseMeta(meta([], { schema: 99, anything: true }))).toEqual({ kind: 'newer' })
  })

  it('migrates older metadata one version at a time, and refuses a gap in the chain', () => {
    const steps = {
      1: (raw: Record<string, unknown>) => ({ ...raw, items: raw.items, addedInTwo: true }),
      2: (raw: Record<string, unknown>) => ({
        ...raw,
        items: (raw.items as unknown[]).slice(0, 1),
      }),
    }
    const parsed = parseMeta(meta([item('a'), item('b')]), { current: 3, steps })
    expect(parsed.kind === 'ok' && parsed.meta.items.map((i) => i.id)).toEqual(['a'])
    expect(parsed.kind === 'ok' && parsed.meta.schema).toBe(3)
    expect(parseMeta(meta([item('a')]), { current: 3, steps: { 2: steps[2] } })).toEqual({
      kind: 'corrupt',
    })
  })

  it('treats a missing or odd save time as 0', () => {
    const parsed = parseMeta({ schema: 1, items: [] })
    expect(parsed.kind === 'ok' && parsed.meta.savedAt).toBe(0)
  })
})

describe('readStoredImage', () => {
  it('accepts a photo record', () => {
    expect(readStoredImage(record('a'))?.id).toBe('a')
  })

  it.each([
    ['no file', { ...record('a'), file: undefined }],
    ['a file that is not a Blob', { ...record('a'), file: 'bytes' }],
    ['no thumbnail', { ...record('a'), thumbnail: null }],
    ['a zero width', { ...record('a'), width: 0 }],
    ['a size that is not a number', { ...record('a'), height: 'tall' }],
    ['no name', { ...record('a'), name: 3 }],
    ['not an object', 'x'],
  ])('rejects a record with %s', (_name, raw) => {
    expect(readStoredImage(raw)).toBeNull()
  })
})

describe('assembleLoad', () => {
  const records = (...ids: string[]) => new Map<string, unknown>(ids.map((id) => [id, record(id)]))

  it('is empty when there is nothing at all', () => {
    expect(assembleLoad(undefined, new Map(), [])).toEqual({ kind: 'empty' })
  })

  it('calls photos without a list corrupt, so they can be cleared away', () => {
    expect(assembleLoad(undefined, new Map(), ['a', 'b'])).toEqual({
      kind: 'corrupt',
      ids: ['a', 'b'],
    })
  })

  it('calls an unreadable list corrupt, and a newer one newer', () => {
    expect(assembleLoad('garbage', new Map(), ['a'])).toEqual({ kind: 'corrupt', ids: ['a'] })
    expect(assembleLoad(meta([], { schema: 2 }), new Map(), ['a'])).toEqual({ kind: 'newer' })
  })

  it('pairs each listed photo with its record, and flags a record that is not a photo', () => {
    const loaded = assembleLoad(
      meta([item('a'), item('b'), item('c')]),
      new Map([...records('a'), ['b', { junk: 1 }]]),
      ['a', 'b', 'x'],
    )
    if (loaded.kind !== 'work') throw new Error('expected work')
    expect(loaded.records.get('a')).toMatchObject({ id: 'a' })
    expect(loaded.records.get('b')).toBe('unreadable')
    expect(loaded.records.has('c')).toBe(false)
    expect(loaded.storedIds).toEqual(['a', 'b', 'x'])
  })
})
