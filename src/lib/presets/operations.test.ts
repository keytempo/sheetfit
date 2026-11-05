import { describe, expect, it } from 'vitest'
import {
  addImported,
  addPreset,
  duplicatePreset,
  removePreset,
  renamePreset,
  replaceSettings,
  restorePreset,
  type Outcome,
} from './operations'
import type { ReadEntry } from './read'
import { PRESET_LIMITS, type Preset } from './schema'
import { counter, settings } from './testing/fixtures'

function must<T>(outcome: Outcome<T>) {
  if (!outcome.ok) throw new Error(`expected success, got ${outcome.reason}`)
  return outcome
}

const preset = (id: string, name: string): Preset => ({ id, name, settings: settings() })
const many = (count: number) =>
  Array.from({ length: count }, (_, i) => preset(`p${i}`, `Preset ${i}`))

describe('addPreset', () => {
  it('adds at the end with a cleaned name', () => {
    const { presets, value } = must(
      addPreset([preset('a', 'A')], '  Photos  A4 ', settings(), counter()),
    )
    expect(presets.map((p) => p.name)).toEqual(['A', 'Photos A4'])
    expect(value).toEqual({ id: 'id1', name: 'Photos A4', settings: settings() })
  })

  it('refuses an empty name, a long one and a taken one (ignoring case) and changes nothing', () => {
    const before = [preset('a', 'Photos')]
    expect(addPreset(before, ' ', settings(), counter())).toEqual({
      ok: false,
      reason: 'name-empty',
    })
    expect(addPreset(before, 'x'.repeat(41), settings(), counter())).toEqual({
      ok: false,
      reason: 'name-too-long',
    })
    expect(addPreset(before, 'PHOTOS', settings(), counter())).toEqual({
      ok: false,
      reason: 'name-taken',
    })
    expect(before).toHaveLength(1)
  })

  it('stops at the limit', () => {
    expect(addPreset(many(PRESET_LIMITS.count), 'One more', settings(), counter())).toEqual({
      ok: false,
      reason: 'limit',
    })
    expect(
      must(addPreset(many(PRESET_LIMITS.count - 1), 'Last', settings(), counter())).presets,
    ).toHaveLength(PRESET_LIMITS.count)
  })

  it('does not change the list it was given', () => {
    const before = [preset('a', 'A')]
    addPreset(before, 'B', settings(), counter())
    expect(before).toEqual([preset('a', 'A')])
  })
})

describe('replaceSettings', () => {
  it('replaces only the settings of that preset and hands back the old version', () => {
    const list = [preset('a', 'A'), preset('b', 'B')]
    const { presets, value } = must(replaceSettings(list, 'b', settings({ margin: 9 })))
    expect(presets[1]).toEqual({ id: 'b', name: 'B', settings: settings({ margin: 9 }) })
    expect(presets[0]).toBe(list[0])
    expect(value).toBe(list[1])
  })

  it('says when the preset is gone', () => {
    expect(replaceSettings([], 'x', settings())).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('renamePreset', () => {
  it('renames, hands back the old name, and allows a change of case on the same preset', () => {
    const list = [preset('a', 'Photos'), preset('b', 'Other')]
    expect(must(renamePreset(list, 'a', 'PHOTOS')).presets[0].name).toBe('PHOTOS')
    expect(must(renamePreset(list, 'b', 'New')).value).toBe('Other')
  })

  it('refuses a name another preset has, an empty one and an unknown preset', () => {
    const list = [preset('a', 'Photos'), preset('b', 'Other')]
    expect(renamePreset(list, 'b', 'photos')).toEqual({ ok: false, reason: 'name-taken' })
    expect(renamePreset(list, 'b', '')).toEqual({ ok: false, reason: 'name-empty' })
    expect(renamePreset(list, 'zzz', 'X')).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('duplicatePreset', () => {
  it('puts the copy right after the original with the same settings and a free name', () => {
    const list = [preset('a', 'A'), preset('b', 'B'), preset('c', 'A copy')]
    const { presets, value } = must(duplicatePreset(list, 'a', counter()))
    expect(presets.map((p) => p.name)).toEqual(['A', 'A copy 2', 'B', 'A copy'])
    expect(value.settings).toBe(list[0].settings)
    expect(value.id).toBe('id1')
  })

  it('fails at the limit and for an unknown preset', () => {
    expect(duplicatePreset(many(PRESET_LIMITS.count), 'p0', counter())).toEqual({
      ok: false,
      reason: 'limit',
    })
    expect(duplicatePreset([], 'p0', counter())).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('removePreset and restorePreset', () => {
  it('removes and puts back in the same place', () => {
    const list = [preset('a', 'A'), preset('b', 'B'), preset('c', 'C')]
    const removed = must(removePreset(list, 'b'))
    expect(removed.presets.map((p) => p.id)).toEqual(['a', 'c'])
    const back = must(
      restorePreset(removed.presets, removed.value.preset, removed.value.index, counter()),
    )
    expect(back.presets).toEqual(list)
  })

  it('renames the restored preset when its name was taken meanwhile, and re-ids it when its id was', () => {
    const list = [preset('a', 'A')]
    const taken = must(restorePreset(list, preset('x', 'a'), 5, counter()))
    expect(taken.presets.map((p) => p.name)).toEqual(['A', 'a 2'])
    const sameId = must(restorePreset(list, preset('a', 'Other'), 0, counter()))
    expect(sameId.presets[0].id).toBe('id1')
  })

  it('cannot restore into a full list', () => {
    expect(restorePreset(many(PRESET_LIMITS.count), preset('x', 'X'), 0, counter())).toEqual({
      ok: false,
      reason: 'limit',
    })
  })
})

describe('addImported', () => {
  const entry = (name: string): ReadEntry => ({
    index: 0,
    id: 'ignored',
    name,
    settings: settings({ margin: 7 }),
    adjusted: false,
  })

  it('appends with new ids and never touches what exists', () => {
    const list = [preset('a', 'Photos')]
    const { presets, value } = must(
      addImported(list, [entry('Photos'), entry('Photos')], counter()),
    )
    expect(presets.map((p) => p.name)).toEqual(['Photos', 'Photos 2', 'Photos 3'])
    expect(presets.map((p) => p.id)).toEqual(['a', 'id1', 'id2'])
    expect(presets[0]).toBe(list[0])
    expect(value.left).toBe(0)
  })

  it('adds what fits under the limit and counts the rest', () => {
    const { presets, value } = must(
      addImported(many(PRESET_LIMITS.count - 2), [entry('x'), entry('y'), entry('z')], counter()),
    )
    expect(presets).toHaveLength(PRESET_LIMITS.count)
    expect(value).toMatchObject({ left: 1 })
  })
})
