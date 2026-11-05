import { PRESET_LIMITS } from './schema'

/** Names are cut to this many characters before they are cleaned, so a huge string costs nothing. */
const SCANNED_CHARACTERS = 400

// Invisible characters: controls, zero-width marks and the ones that change the direction of the
// text around them. They can make two different names look alike or reorder what is next to them.
const INVISIBLE = /[\p{Cc}\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069]/gu
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

/** Collapses every run of whitespace to one space, drops invisible characters and trims. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .slice(0, SCANNED_CHARACTERS)
    .normalize('NFC')
    .replace(LONE_SURROGATE, '')
    .replace(/\s+/g, ' ')
    .replace(INVISIBLE, '')
    .trim()
}

export const nameLength = (name: string) => Array.from(name).length

/** At most `max` characters, never cutting a character in two. */
export const shorten = (name: string, max: number) =>
  Array.from(name).slice(0, Math.max(0, max)).join('').trim()

/** Two names are the same name when they differ only in case. */
export const nameKey = (name: string) => name.toLowerCase()

const withTail = (name: string, tail: string) =>
  shorten(name, PRESET_LIMITS.nameLength - nameLength(tail)) + tail

/** `name` itself when it is free, otherwise `name 2`, `name 3` and so on, within the length limit. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(nameKey(name))) return name
  for (let n = 2; ; n++) {
    const candidate = withTail(name, ` ${n}`)
    if (!taken.has(nameKey(candidate))) return candidate
  }
}

/** The name of a duplicate: `name copy`, then `name copy 2` and so on. */
export const copyName = (name: string, taken: ReadonlySet<string>) =>
  uniqueName(withTail(name, ' copy'), taken)

export type NameCheck = { ok: true; name: string } | { ok: false; problem: 'empty' | 'too-long' }

/** What a person typed, judged as it will be stored. It is never silently shortened. */
export function checkName(raw: string): NameCheck {
  const name = cleanName(raw)
  if (name === '') return { ok: false, problem: 'empty' }
  if (nameLength(name) > PRESET_LIMITS.nameLength) return { ok: false, problem: 'too-long' }
  return { ok: true, name }
}
