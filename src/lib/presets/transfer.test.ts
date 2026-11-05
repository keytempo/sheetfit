import { describe, expect, it } from 'vitest'
import { PRESET_LIMITS, type Preset } from './schema'
import { exportFileName, readImport, serialisePresets } from './transfer'
import { settings } from './testing/fixtures'

const preset = (id: string, name: string, changes = {}): Preset => ({
  id,
  name,
  settings: settings(changes),
})
const file = (body: object) => JSON.stringify({ format: 'sheetfit-presets', version: 1, ...body })

describe('serialisePresets', () => {
  it('writes the marker, the versions and the presets without their ids', () => {
    const text = serialisePresets(
      [preset('a', 'A', { sheetSize: 'a3' })],
      '0.1.0',
      new Date('2026-11-02T10:00:00Z'),
    )
    expect(JSON.parse(text)).toEqual({
      format: 'sheetfit-presets',
      version: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-11-02T10:00:00.000Z',
      presets: [{ name: 'A', settings: settings({ sheetSize: 'a3' }) }],
    })
  })
})

describe('exportFileName', () => {
  it('is fixed for a list and follows the name for one preset', () => {
    expect(exportFileName([preset('a', 'A'), preset('b', 'B')])).toBe('sheetfit-presets.json')
    expect(exportFileName([preset('a', '4×6 on A3!')])).toBe('sheetfit-preset-4-6-on-a3.json')
    expect(exportFileName([preset('a', '📷 ✂️')])).toBe('sheetfit-preset.json')
    expect(exportFileName([preset('a', 'x'.repeat(40))])).toBe(
      `sheetfit-preset-${'x'.repeat(30)}.json`,
    )
  })
})

describe('readImport', () => {
  const existing = [preset('e', 'Photos')]

  it('round-trips an export: same names and settings, and nothing adjusted', () => {
    const presets = [preset('a', 'One', { margin: 7 }), preset('b', 'Two', { cutGuides: true })]
    const read = readImport(serialisePresets(presets, '0.1.0', new Date()), [])
    expect(read.ok && read.preview.entries.map((e) => [e.name, e.settings])).toEqual(
      presets.map((p) => [p.name, p.settings]),
    )
    expect(read.ok && read.preview.adjusted).toBe(0)
    expect(read.ok && read.preview.skipped).toEqual([])
  })

  it('previews names that would clash with existing ones as renamed, never as replacing', () => {
    const read = readImport(file({ presets: [{ name: 'photos', settings: settings() }] }), existing)
    expect(read.ok && read.preview.entries[0]).toMatchObject({
      name: 'photos 2',
      renamedFrom: 'photos',
    })
    expect(read.ok && read.preview.renamed).toBe(1)
  })

  it('previews what it skips and why', () => {
    const read = readImport(
      file({
        presets: [
          { name: 'Ok', settings: settings() },
          3,
          { settings: settings() },
          { name: 'No' },
        ],
      }),
      [],
    )
    expect(read.ok && read.preview.entries).toHaveLength(1)
    expect(read.ok && read.preview.skipped).toEqual([
      { index: 1, reason: 'not-a-preset' },
      { index: 2, reason: 'no-name' },
      { index: 3, reason: 'no-settings', name: 'No' },
    ])
  })

  it('takes only what fits under the limit, counting the rest', () => {
    const presets = Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, settings: settings() }))
    const full = Array.from({ length: PRESET_LIMITS.count - 2 }, (_, i) => preset(`e${i}`, `E${i}`))
    const read = readImport(file({ presets }), full)
    expect(read.ok && read.preview.entries).toHaveLength(2)
    expect(read.ok && read.preview.counts['over-limit']).toBe(3)
  })

  it('refuses a file that is not what it should be, as a whole', () => {
    const cases: [string, string][] = [
      ['{nope', 'not-json'],
      ['[]', 'not-presets'],
      ['null', 'not-presets'],
      [JSON.stringify({ version: 1, presets: [] }), 'not-presets'],
      [JSON.stringify({ format: 'other', version: 1, presets: [] }), 'not-presets'],
      [JSON.stringify({ format: 'sheetfit-presets', presets: [] }), 'not-presets'],
      [JSON.stringify({ format: 'sheetfit-presets', version: '1', presets: [] }), 'not-presets'],
      [JSON.stringify({ format: 'sheetfit-presets', version: 1, presets: {} }), 'not-presets'],
      [file({ presets: [] }), 'no-presets'],
      [JSON.stringify({ format: 'sheetfit-presets', version: 2, presets: [] }), 'newer-version'],
      [' '.repeat(PRESET_LIMITS.importBytes + 1), 'too-big'],
    ]
    for (const [text, problem] of cases) {
      expect(readImport(text, []), text.slice(0, 60)).toEqual({ ok: false, problem })
    }
  })

  it('survives hostile content: prototype keys, deep nesting and huge names', () => {
    const hostile =
      '{"format":"sheetfit-presets","version":1,"__proto__":{"polluted":true},"presets":[' +
      '{"name":"__proto__","settings":{"margin":5,"__proto__":{"polluted":true},"constructor":{"x":1}}},' +
      `{"name":"${'n'.repeat(100_000)}","settings":{"gap":1}}]}`
    const read = readImport(hostile, [])
    expect(read.ok && read.preview.entries.map((e) => e.name.length)).toEqual([9, 40])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    const deep = '['.repeat(100_000) + ']'.repeat(100_000)
    const nested = readImport(deep, [])
    expect(nested.ok).toBe(false)
  })

  it('never evaluates anything: script-like strings stay plain text', () => {
    const read = readImport(
      file({ presets: [{ name: '<img src=x onerror=alert(1)>', settings: settings() }] }),
      [],
    )
    expect(read.ok && read.preview.entries[0].name).toBe('<img src=x onerror=alert(1)>')
  })
})
