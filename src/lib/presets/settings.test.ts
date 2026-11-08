import { describe, expect, it } from 'vitest'
import { DEFAULT_PRINT_OPTIONS, LIMITS } from '../print-options'
import { PRESET_SETTING_KEYS } from './schema'
import { readSettings, resolveActive, sameSettings, settingsFromOptions } from './settings'
import { settings } from './testing/fixtures'

describe('which options a preset keeps', () => {
  it('keeps exactly the options that decide what is printed', () => {
    expect(Object.keys(settingsFromOptions(DEFAULT_PRINT_OPTIONS)).sort()).toEqual(
      [...PRESET_SETTING_KEYS].sort(),
    )
  })

  it('leaves out the units, the preview switches and the packing time limit', () => {
    const kept = Object.keys(settingsFromOptions(DEFAULT_PRINT_OPTIONS))
    for (const key of ['unit', 'showMargins', 'showSheetNumbers', 'timeLimit'])
      expect(kept).not.toContain(key)
  })

  it('has an entry for every print option, kept or left out', () => {
    // The time limit is how hard to search, not what is produced: the same preset gives the same
    // sheets, sizes and gaps at any limit, so it stays with the person's own options.
    const left = ['unit', 'showMargins', 'showSheetNumbers', 'timeLimit']
    expect([...PRESET_SETTING_KEYS, ...left].sort()).toEqual(
      Object.keys(DEFAULT_PRINT_OPTIONS).sort(),
    )
  })
})

describe('readSettings', () => {
  it('keeps valid settings exactly', () => {
    const valid = settings({ sheetSize: 'a3', margin: 12.5, cutGuides: true, ordering: 'strict' })
    expect(readSettings(valid)).toEqual({ settings: valid, adjusted: false })
  })

  it('drops fields that are not settings, even ones that are options', () => {
    const read = readSettings({ ...settings(), unit: 'in', showMargins: false, extra: 1 })
    expect(read?.settings).toEqual(settings())
    expect(Object.keys(read?.settings ?? {}).sort()).toEqual([...PRESET_SETTING_KEYS].sort())
  })

  it('fills in a setting an older version did not have, without calling it adjusted', () => {
    const older = Object.fromEntries(
      Object.entries(settings({ margin: 8 })).filter(([key]) => key !== 'cutGuides'),
    )
    expect(readSettings(older)).toEqual({ settings: settings({ margin: 8 }), adjusted: false })
  })

  it('brings values inside their limits and says it did', () => {
    const read = readSettings({ margin: 9999, gap: -3, baseDpi: 'x', sheetSize: 'a9' })
    expect(read?.adjusted).toBe(true)
    expect(read?.settings.margin).toBe(LIMITS.margin.max)
    expect(read?.settings.gap).toBe(0)
    expect(read?.settings.baseDpi).toBe(DEFAULT_PRINT_OPTIONS.baseDpi)
    expect(read?.settings.sheetSize).toBe(DEFAULT_PRINT_OPTIONS.sheetSize)
  })

  it('refuses what has no setting in it', () => {
    for (const raw of [undefined, null, 'a4', 7, [], {}, { unit: 'in' }, { nothing: 1 }]) {
      expect(readSettings(raw)).toBeNull()
    }
  })

  it('does not read a setting from the prototype', () => {
    expect(readSettings(Object.create({ margin: 9 }))).toBeNull()
  })
})

describe('sameSettings', () => {
  it('compares every setting that acts', () => {
    expect(sameSettings(settings(), settings())).toBe(true)
    for (const change of [
      { sheetSize: 'a3' },
      { orientation: 'landscape' },
      { baseMode: 'width' },
      { baseDpi: 150 },
      { margin: 6 },
      { gap: 1 },
      { allowRotation: false },
      { ordering: 'strict' },
      { cutGuides: true },
    ] as const) {
      expect(sameSettings(settings(), settings(change)), JSON.stringify(change)).toBe(false)
    }
  })

  it('ignores a custom size while a standard sheet is chosen, but not once Custom is', () => {
    expect(sameSettings(settings({ customWidth: 100 }), settings({ customWidth: 200 }))).toBe(true)
    const custom = { sheetSize: 'custom' } as const
    expect(
      sameSettings(
        settings({ ...custom, customWidth: 100 }),
        settings({ ...custom, customWidth: 200 }),
      ),
    ).toBe(false)
  })

  it('ignores the length in native mode and the DPI in the other modes', () => {
    expect(sameSettings(settings({ baseLength: 20 }), settings({ baseLength: 90 }))).toBe(true)
    const width = { baseMode: 'width' } as const
    expect(
      sameSettings(settings({ ...width, baseDpi: 100 }), settings({ ...width, baseDpi: 900 })),
    ).toBe(true)
    expect(
      sameSettings(settings({ ...width, baseLength: 20 }), settings({ ...width, baseLength: 90 })),
    ).toBe(false)
  })
})

describe('resolveActive', () => {
  const a = { id: 'a', name: 'A', settings: settings({ sheetSize: 'a3' }) }
  const b = { id: 'b', name: 'B', settings: settings({ sheetSize: 'a5' }) }

  it('has no active preset when none was chosen and none matches', () => {
    expect(resolveActive([a, b], null, settings())).toBeNull()
  })

  it('shows the chosen preset as modified once the settings move away from it', () => {
    expect(resolveActive([a, b], 'a', settings({ sheetSize: 'a3', margin: 9 }))).toEqual({
      preset: a,
      modified: true,
    })
  })

  it('shows the chosen preset as unmodified while it matches', () => {
    expect(resolveActive([a, b], 'a', a.settings)).toEqual({ preset: a, modified: false })
  })

  it('moves to the preset the settings now match, and finds one without being told', () => {
    expect(resolveActive([a, b], 'a', b.settings)).toEqual({ preset: b, modified: false })
    expect(resolveActive([a, b], null, a.settings)).toEqual({ preset: a, modified: false })
  })

  it('prefers the chosen preset when two match', () => {
    const twin = { ...b, settings: a.settings }
    expect(resolveActive([twin, a], 'a', a.settings)?.preset).toBe(a)
  })

  it('ignores an id that no preset has', () => {
    expect(resolveActive([a], 'gone', settings())).toBeNull()
  })
})
