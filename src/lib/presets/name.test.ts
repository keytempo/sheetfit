import { describe, expect, it } from 'vitest'
import { checkName, cleanName, copyName, nameKey, nameLength, uniqueName } from './name'

const keys = (...names: string[]) => new Set(names.map(nameKey))

describe('cleanName', () => {
  it('trims and collapses every kind of whitespace', () => {
    expect(cleanName('  Passport \t photos\n\u00a0A4  ')).toBe('Passport photos A4')
  })

  it('removes invisible and direction-changing characters', () => {
    expect(cleanName('Pass\u200Bport\u202E')).toBe('Passport')
    expect(cleanName('a\u0000b\u001Fc\u007F')).toBe('abc')
  })

  it('removes lone surrogates and keeps real emoji and other scripts', () => {
    expect(cleanName('a\ud800b')).toBe('ab')
    expect(cleanName('📷 パスポート')).toBe('📷 パスポート')
  })

  it('gives an empty name for anything that is not a string', () => {
    for (const value of [undefined, null, 7, {}, [], true]) expect(cleanName(value)).toBe('')
  })

  it('stays fast on a huge string', () => {
    expect(nameLength(cleanName('x'.repeat(5_000_000)))).toBeLessThanOrEqual(400)
  })
})

describe('checkName', () => {
  it('accepts a good name as it will be stored', () => {
    expect(checkName('  4×6   on A3 ')).toEqual({ ok: true, name: '4×6 on A3' })
  })

  it('refuses an empty name and one that is only invisible', () => {
    expect(checkName('   ')).toEqual({ ok: false, problem: 'empty' })
    expect(checkName('\u200B\u200B')).toEqual({ ok: false, problem: 'empty' })
  })

  it('counts characters, not code units, and refuses what is too long instead of cutting it', () => {
    expect(checkName('📷'.repeat(40)).ok).toBe(true)
    expect(checkName('📷'.repeat(41))).toEqual({ ok: false, problem: 'too-long' })
    expect(checkName('a'.repeat(41))).toEqual({ ok: false, problem: 'too-long' })
  })
})

describe('uniqueName and copyName', () => {
  it('keeps a free name and numbers a taken one, ignoring case', () => {
    expect(uniqueName('Photos', keys('Other'))).toBe('Photos')
    expect(uniqueName('Photos', keys('photos'))).toBe('Photos 2')
    expect(uniqueName('Photos', keys('Photos', 'photos 2', 'PHOTOS 3'))).toBe('Photos 4')
  })

  it('stays inside the length limit and never cuts a character in two', () => {
    const long = '📷'.repeat(40)
    const result = uniqueName(long, keys(long))
    expect(nameLength(result)).toBeLessThanOrEqual(40)
    expect(result.endsWith(' 2')).toBe(true)
  })

  it('names a copy "copy", then "copy 2"', () => {
    expect(copyName('Photos', keys('Photos'))).toBe('Photos copy')
    expect(copyName('Photos', keys('Photos', 'Photos copy'))).toBe('Photos copy 2')
    expect(nameLength(copyName('x'.repeat(40), keys()))).toBe(40)
  })
})
