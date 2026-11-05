import { describe, expect, it } from 'vitest'
import { PRESET_LIMITS, STORAGE_KEY } from './schema'
import { loadPresets, savePresets } from './storage'
import { counter, MemoryStorage, settings } from './testing/fixtures'

const stored = (document: unknown) => {
  const storage = new MemoryStorage()
  storage.setItem(STORAGE_KEY, typeof document === 'string' ? document : JSON.stringify(document))
  return storage
}
const entry = (name: string, extra: object = {}) => ({
  id: name,
  name,
  settings: settings(),
  ...extra,
})

describe('loadPresets', () => {
  it('starts empty and available when nothing was saved', () => {
    expect(loadPresets(new MemoryStorage(), counter())).toEqual({
      presets: [],
      activeId: null,
      availability: 'ok',
      notice: null,
    })
  })

  it('round-trips what savePresets wrote', () => {
    const storage = new MemoryStorage()
    const presets = [
      { id: 'a', name: 'A', settings: settings({ sheetSize: 'a3' }) },
      { id: 'b', name: 'B', settings: settings({ cutGuides: true }) },
    ]
    expect(savePresets(storage, presets, 'b')).toBe('ok')
    expect(loadPresets(storage, counter())).toEqual({
      presets,
      activeId: 'b',
      availability: 'ok',
      notice: null,
    })
  })

  it('reports storage that cannot be read or does not exist as unavailable', () => {
    const blocked = new MemoryStorage()
    blocked.failReads = true
    expect(loadPresets(blocked).availability).toBe('unavailable')
    expect(loadPresets(null).availability).toBe('unavailable')
  })

  it('does not trust text that is not a valid document, and says so', () => {
    for (const text of [
      '{not json',
      '',
      'null',
      '[]',
      '"text"',
      '{}',
      '{"version":1}',
      '{"version":"1","presets":[]}',
      '{"version":0,"presets":[]}',
      '{"version":1.5,"presets":[]}',
      '{"version":1,"presets":{}}',
    ]) {
      const result = loadPresets(stored(text), counter())
      expect(result.presets, text).toEqual([])
      expect(result.notice, text).toEqual({ kind: 'unreadable' })
      expect(result.availability, text).toBe('ok')
    }
  })

  it('keeps the good presets, skips the bad ones and counts what it skipped', () => {
    const result = loadPresets(
      stored({
        version: 1,
        presets: [
          entry('Good'),
          7,
          { name: 'No settings' },
          { settings: settings() },
          entry('Clamped', { settings: { ...settings(), margin: 9999 } }),
        ],
        activeId: 'Good',
      }),
      counter(),
    )
    expect(result.presets.map((p) => p.name)).toEqual(['Good', 'Clamped'])
    expect(result.presets[1].settings.margin).toBe(50)
    expect(result.activeId).toBe('Good')
    expect(result.notice).toMatchObject({
      kind: 'skipped',
      adjusted: 1,
      counts: { 'not-a-preset': 1, 'no-name': 1, 'no-settings': 1, 'over-limit': 0 },
    })
  })

  it('makes names unique and replaces bad or repeated ids', () => {
    const result = loadPresets(
      stored({
        version: 1,
        presets: [
          entry('Same', { id: 'x' }),
          entry('same', { id: 'x' }),
          entry('Other', { id: 'has spaces!' }),
          entry('Third', { id: 7 }),
        ],
      }),
      counter(),
    )
    expect(result.presets.map((p) => p.name)).toEqual(['Same', 'same 2', 'Other', 'Third'])
    expect(result.presets.map((p) => p.id)).toEqual(['x', 'id1', 'id2', 'id3'])
  })

  it('forgets an active id that no preset has', () => {
    expect(
      loadPresets(stored({ version: 1, presets: [entry('A')], activeId: 'zzz' })).activeId,
    ).toBeNull()
  })

  it('keeps the first presets of a list of a thousand and says how many it left out', () => {
    const presets = Array.from({ length: 1000 }, (_, i) => entry(`Preset ${i}`))
    const result = loadPresets(stored({ version: 1, presets }), counter())
    expect(result.presets).toHaveLength(PRESET_LIMITS.count)
    expect(result.notice).toMatchObject({ counts: { 'over-limit': 1000 - PRESET_LIMITS.count } })
  })

  it('does not even look at entries past the scan limit', () => {
    const presets = new Array<number>(50_000).fill(1)
    const result = loadPresets(stored({ version: 1, presets }), counter())
    expect(result.notice).toMatchObject({
      counts: {
        'not-a-preset': PRESET_LIMITS.scanned,
        'over-limit': 50_000 - PRESET_LIMITS.scanned,
      },
    })
  })

  it('reads a newer version as far as it understands it, and makes it read-only', () => {
    const result = loadPresets(
      stored({ version: 2, presets: [entry('A', { future: true })], extra: 1 }),
      counter(),
    )
    expect(result.availability).toBe('read-only')
    expect(result.notice).toEqual({ kind: 'newer-version' })
    expect(result.presets).toEqual([{ id: 'A', name: 'A', settings: settings() }])
  })

  it('does not write while it reads', () => {
    const storage = stored({ version: 1, presets: [7] })
    const before = storage.writes
    loadPresets(storage, counter())
    expect(storage.writes).toBe(before)
  })
})

describe('savePresets', () => {
  it('says when the storage is full, and when it is simply not there', () => {
    const storage = new MemoryStorage()
    storage.failWrites = 'full'
    expect(savePresets(storage, [], null)).toBe('full')
    storage.failWrites = 'blocked'
    expect(savePresets(storage, [], null)).toBe('unavailable')
    expect(savePresets(null, [], null)).toBe('unavailable')
  })

  it('writes under its own key and never touches the print options', () => {
    const storage = new MemoryStorage()
    storage.setItem('sheetfit:v1', '{"state":{}}')
    savePresets(storage, [], null)
    expect(storage.getItem('sheetfit:v1')).toBe('{"state":{}}')
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull()
    expect(STORAGE_KEY).not.toBe('sheetfit:v1')
  })
})
