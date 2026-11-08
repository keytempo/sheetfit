import type { NewImage } from '@/store/types'
import type { LoadResult, WorkItem, WorkStore } from './types'

export interface SkippedImage {
  name: string
  reason: 'missing' | 'cut-off' | 'unreadable'
}

type RestoreOutcome =
  /** Nothing was saved. */
  | { kind: 'nothing' }
  /** The saved work belongs to a newer version of the app and must be left alone. */
  | { kind: 'newer' }
  /** Something was saved but cannot be read; `storedIds` are the records to clear away. */
  | { kind: 'corrupt'; storedIds: string[] }
  | {
      kind: 'restored'
      images: NewImage[]
      skipped: SkippedImage[]
      storedIds: string[]
      /** The list as it was saved, for the sync to compare against. */
      saved: WorkItem[]
    }

interface RestoreHooks {
  /** True when the browser can show this thumbnail. A damaged one cannot. */
  canShow: (thumbnail: Blob) => Promise<boolean>
  /** Called once, when the list has been read, with how many photos it names. */
  onListed?: (count: number) => void
  /** Called once for every photo looked at, whether it can be used or not. */
  onChecked?: () => void
}

/**
 * Reads the saved work and decides, photo by photo, what can be put back. Nothing here touches the
 * app: it returns the photos, in their saved order with their saved copies and sizes, and the ones it
 * had to skip with the reason, and the caller adds them all in one step. A photo that is missing,
 * whose file is shorter than it was saved or whose thumbnail cannot be shown never holds up the rest.
 * The original file is not decoded here (that is slow for a large photo); it is decoded when it is
 * exported, and the export says so if that fails.
 */
export async function restoreWork(store: WorkStore, hooks: RestoreHooks): Promise<RestoreOutcome> {
  const loaded: LoadResult = await store.load()
  if (loaded.kind === 'empty') return { kind: 'nothing' }
  if (loaded.kind === 'newer') return { kind: 'newer' }
  if (loaded.kind === 'corrupt') return { kind: 'corrupt', storedIds: loaded.ids }

  hooks.onListed?.(loaded.meta.items.length)
  const images: NewImage[] = []
  const skipped: SkippedImage[] = []
  for (const item of loaded.meta.items) {
    const record = loaded.records.get(item.id)
    let reason: SkippedImage['reason'] | null = null
    if (record === undefined) reason = 'missing'
    else if (record === 'unreadable') reason = 'unreadable'
    else if (record.file.size === 0 || record.file.size !== record.bytes) reason = 'cut-off'
    else if (record.thumbnail.size === 0 || !(await hooks.canShow(record.thumbnail)))
      reason = 'unreadable'

    if (reason !== null || record === undefined || record === 'unreadable') {
      skipped.push({ name: item.name, reason: reason ?? 'missing' })
    } else {
      images.push({
        id: item.id,
        name: item.name,
        file: new File([record.file], item.name, { type: record.type }),
        thumbnail: record.thumbnail,
        width: record.width,
        height: record.height,
        copies: item.copies,
        percent: item.percent,
      })
    }
    hooks.onChecked?.()
  }
  return {
    kind: 'restored',
    images,
    skipped,
    storedIds: loaded.storedIds,
    saved: loaded.meta.items,
  }
}

/** The plain words for why a photo could not be put back. */
export const SKIP_REASONS: Record<SkippedImage['reason'], string> = {
  missing: 'its saved copy is gone',
  'cut-off': 'its saved copy is incomplete',
  unreadable: 'its saved copy is damaged',
}
