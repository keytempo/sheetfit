import { LIMITS } from '../print-options'
import {
  WORK_SCHEMA,
  type LoadResult,
  type StoredImage,
  type WorkItem,
  type WorkMeta,
} from './types'

type ParsedMeta = { kind: 'ok'; meta: WorkMeta } | { kind: 'newer' } | { kind: 'corrupt' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Brings saved metadata of an older schema up to the current one. Each step turns version `n` into
 * `n + 1`. There is only one version so far, so nothing is listed; the first change to the shape adds
 * its step here and raises `WORK_SCHEMA`.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

const readItem = (raw: unknown): WorkItem | null => {
  if (!isRecord(raw)) return null
  const { id, name, copies, percent } = raw
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') return null
  if (typeof copies !== 'number' || !Number.isFinite(copies)) return null
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
  return {
    id,
    name,
    copies: clamp(Math.round(copies), LIMITS.copies.min, LIMITS.copies.max),
    percent: clamp(percent, LIMITS.percent.min, LIMITS.percent.max),
  }
}

/**
 * Reads saved metadata. It is untrusted like anything read from storage: whatever is wrong with it
 * ends in `corrupt` (which the caller treats as nothing saved), a list from a newer version ends in
 * `newer` (which the caller must not overwrite), and values are put back inside their limits. An item
 * that cannot be read is dropped and a repeated id is kept once, in its first place.
 */
export function parseMeta(
  raw: unknown,
  { current = WORK_SCHEMA, steps = MIGRATIONS } = {},
): ParsedMeta {
  if (!isRecord(raw)) return { kind: 'corrupt' }
  let data: Record<string, unknown> = raw
  let schema = data.schema
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1)
    return { kind: 'corrupt' }
  if (schema > current) return { kind: 'newer' }
  while (schema < current) {
    const step = steps[schema]
    if (!step) return { kind: 'corrupt' }
    data = step(data)
    schema += 1
  }
  const { items, savedAt } = data
  if (!Array.isArray(items)) return { kind: 'corrupt' }
  const seen = new Set<string>()
  const kept: WorkItem[] = []
  for (const candidate of items) {
    const item = readItem(candidate)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    kept.push(item)
  }
  return {
    kind: 'ok',
    meta: {
      schema: current,
      items: kept,
      savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0,
    },
  }
}

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** A saved photo, if what was read is shaped like one. */
export function readStoredImage(raw: unknown): StoredImage | null {
  if (!isRecord(raw)) return null
  const { id, name, type, width, height, bytes, file, thumbnail } = raw
  if (typeof id !== 'string' || typeof name !== 'string' || typeof type !== 'string') return null
  if (!positive(width) || !positive(height) || typeof bytes !== 'number') return null
  if (!(file instanceof Blob) || !(thumbnail instanceof Blob)) return null
  return { id, name, type, width, height, bytes, file, thumbnail }
}

/**
 * Turns what a store read (the raw metadata, the raw record of each listed id, and the ids of every
 * record it holds) into a `LoadResult`. Both the real store and the test store go through it, so the
 * rules about what counts as empty, corrupt, newer or readable are written once.
 */
export function assembleLoad(
  rawMeta: unknown,
  rawRecords: ReadonlyMap<string, unknown>,
  storedIds: string[],
): LoadResult {
  if (rawMeta === undefined)
    return storedIds.length > 0 ? { kind: 'corrupt', ids: storedIds } : { kind: 'empty' }
  const parsed = parseMeta(rawMeta)
  if (parsed.kind === 'newer') return { kind: 'newer' }
  if (parsed.kind === 'corrupt') return { kind: 'corrupt', ids: storedIds }
  const records = new Map<string, StoredImage | 'unreadable'>()
  for (const item of parsed.meta.items) {
    if (!rawRecords.has(item.id)) continue
    records.set(item.id, readStoredImage(rawRecords.get(item.id)) ?? 'unreadable')
  }
  return { kind: 'work', meta: parsed.meta, records, storedIds }
}
