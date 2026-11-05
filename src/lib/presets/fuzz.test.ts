import { describe, expect, it } from 'vitest'
import { buildLayoutInput } from '../layout-input'
import { DEFAULT_PRINT_OPTIONS, sanitizeOptions } from '../print-options'
import { Random } from '../../packing/random'
import { packLayout } from '../../packing/pack'
import { nameKey } from './name'
import { cleanName, nameLength } from './name'
import { PRESET_LIMITS, PRESET_SETTING_KEYS, STORAGE_KEY, type Preset } from './schema'
import { readSettings } from './settings'
import { loadPresets } from './storage'
import { MemoryStorage, settings } from './testing/fixtures'
import { readImport } from './transfer'

const NAMES = [
  'Passport',
  '',
  '   ',
  '__proto__',
  'constructor',
  'x'.repeat(5000),
  '📷'.repeat(60),
  'a\u202Eb\u200Bc',
  '<script>alert(1)</script>',
  'same',
  'SAME',
]
const KEYS = [...PRESET_SETTING_KEYS, 'name', 'settings', 'id', 'presets', 'version', 'format']
const LEAVES: unknown[] = [
  0,
  -1,
  1e9,
  NaN,
  Infinity,
  3.7,
  50,
  'a4',
  'custom',
  'landscape',
  'native',
  'x',
  '',
  null,
  true,
  false,
  undefined,
]

/** Builds a value from random parts. Objects get their keys with defineProperty, so `__proto__` is an own key. */
function value(random: Random, depth: number): unknown {
  const roll = random.int(10)
  if (depth > 3 || roll < 4)
    return random.chance(0.3) ? NAMES[random.int(NAMES.length)] : LEAVES[random.int(LEAVES.length)]
  if (roll < 6) return Array.from({ length: random.int(4) }, () => value(random, depth + 1))
  const result: Record<string, unknown> = {}
  for (let i = random.int(5); i >= 0; i--) {
    const key = random.chance(0.1) ? '__proto__' : KEYS[random.int(KEYS.length)]
    Object.defineProperty(result, key, {
      value: value(random, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return result
}

/** A believable preset with some of its fields replaced by garbage. */
function mostlyRight(random: Random): unknown {
  const keys = [
    'sheetSize',
    'customWidth',
    'customHeight',
    'orientation',
    'baseMode',
    'baseLength',
    'baseDpi',
    'margin',
    'gap',
    'allowRotation',
    'ordering',
    'cutGuides',
  ] as const
  const base: Record<string, unknown> = { ...settings() }
  for (const key of keys) if (random.chance(0.4)) base[key] = value(random, 2)
  const entry: Record<string, unknown> = {
    id: random.chance(0.5) ? `id${random.int(5)}` : value(random, 2),
    name: random.chance(0.7) ? NAMES[random.int(NAMES.length)] : value(random, 2),
    settings: random.chance(0.9) ? base : value(random, 2),
  }
  return entry
}

function document(random: Random): unknown {
  if (random.chance(0.3)) return value(random, 0)
  const presets = Array.from({ length: random.int(8) }, () =>
    random.chance(0.8) ? mostlyRight(random) : value(random, 1),
  )
  return {
    format: 'sheetfit-presets',
    version: random.chance(0.9) ? 1 : value(random, 2),
    presets: random.chance(0.95) ? presets : value(random, 1),
    activeId: random.chance(0.5) ? 'id1' : value(random, 2),
  }
}

/** What must be true of every preset that gets through, whatever it was made from. */
function expectValid(presets: readonly Preset[], label: string) {
  expect(presets.length, label).toBeLessThanOrEqual(PRESET_LIMITS.count)
  const names = new Set<string>()
  const ids = new Set<string>()
  const images = [
    { id: 'a', width: 4000, height: 3000, copies: 3, percent: 100 },
    { id: 'b', width: 600, height: 6000, copies: 2, percent: 300 },
  ]
  for (const preset of presets) {
    expect(typeof preset.id === 'string' && preset.id.length > 0, label).toBe(true)
    expect(ids.has(preset.id), `${label}: id ${preset.id} repeated`).toBe(false)
    ids.add(preset.id)
    expect(preset.name, label).toBe(cleanName(preset.name))
    expect(nameLength(preset.name), label).toBeGreaterThanOrEqual(1)
    expect(nameLength(preset.name), label).toBeLessThanOrEqual(PRESET_LIMITS.nameLength)
    expect(names.has(nameKey(preset.name)), `${label}: name ${preset.name} repeated`).toBe(false)
    names.add(nameKey(preset.name))
    expect(Object.keys(preset.settings).sort(), label).toEqual([...PRESET_SETTING_KEYS].sort())
    // Settings are valid exactly when reading them again changes nothing.
    expect(readSettings(preset.settings), label).toEqual({
      settings: preset.settings,
      adjusted: false,
    })
    // And applied on top of any options they give options the sanitiser accepts as they are.
    const applied = { ...DEFAULT_PRINT_OPTIONS, ...preset.settings }
    expect(sanitizeOptions(applied), label).toEqual(applied)
    // The sheets can be packed: every piece has a real size and every copy is placed.
    const input = buildLayoutInput(images, applied)
    for (const piece of input.pieces) {
      expect(Number.isFinite(piece.width) && piece.width > 0, label).toBe(true)
      expect(Number.isFinite(piece.height) && piece.height > 0, label).toBe(true)
    }
    expect(packLayout(input).unplaceable, label).toEqual([])
  }
}

describe('whatever is stored or imported', () => {
  it('either becomes a valid preset or is rejected, in 600 random documents', () => {
    const random = new Random(2026)
    let accepted = 0
    let imported = 0
    for (let trial = 0; trial < 600; trial++) {
      const doc = document(random)
      const text = JSON.stringify(doc) ?? 'undefined'
      const label = `trial ${trial}: ${text.slice(0, 120)}`

      const storage = new MemoryStorage()
      storage.setItem(STORAGE_KEY, text)
      const loaded = loadPresets(storage)
      expectValid(loaded.presets, label)
      accepted += loaded.presets.length

      const existing = loaded.presets.slice(0, random.int(PRESET_LIMITS.count))
      const read = readImport(text, existing)
      if (read.ok) {
        const taken = new Set(existing.map((preset) => nameKey(preset.name)))
        expect(read.preview.entries.length + existing.length, label).toBeLessThanOrEqual(
          PRESET_LIMITS.count,
        )
        expectValid(
          read.preview.entries.map((entry, i) => ({
            id: `n${i}`,
            name: entry.name,
            settings: entry.settings,
          })),
          label,
        )
        for (const entry of read.preview.entries) {
          expect(
            taken.has(nameKey(entry.name)),
            `${label}: import would replace ${entry.name}`,
          ).toBe(false)
        }
        imported += read.preview.entries.length
      }
    }
    // The generator must really produce both outcomes, or the test proves nothing.
    expect(accepted).toBeGreaterThan(50)
    expect(imported).toBeGreaterThan(50)
  })

  it('never throws on any text at all', () => {
    const random = new Random(9)
    const pieces = [
      '{',
      '}',
      '[',
      ']',
      '"',
      ':',
      ',',
      'null',
      '1e999',
      '\\u0000',
      '"presets"',
      '"version":1',
      '\ud800',
      '\n',
    ]
    for (let trial = 0; trial < 300; trial++) {
      const text = Array.from(
        { length: random.int(30) },
        () => pieces[random.int(pieces.length)],
      ).join('')
      const storage = new MemoryStorage()
      storage.setItem(STORAGE_KEY, text)
      expect(() => loadPresets(storage)).not.toThrow()
      expect(() => readImport(text, [])).not.toThrow()
    }
  })
})
