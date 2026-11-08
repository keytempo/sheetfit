import { toast } from 'sonner'
import { pluralize } from '@/lib/format'
import { createIndexedDbStore } from '@/lib/work/idb-store'
import { readWorkHint, writeWorkHint } from '@/lib/work/hint'
import { restoreWork, SKIP_REASONS, type SkippedImage } from '@/lib/work/restore'
import { createWorkSync, type WorkSource } from '@/lib/work/sync'
import { WorkStorageError, type StorageFailure } from '@/lib/work/types'
import { useAppStore } from '@/store'
import type { WorkStatus } from '@/store/types'

const LOCK_NAME = 'sheetfit-work'

const STATUS_BY_FAILURE: Record<StorageFailure, WorkStatus> = {
  unavailable: 'unavailable',
  full: 'full',
  newer: 'newer',
  failed: 'failed',
}

/**
 * One tab owns the saved work. The first tab to ask holds a Web Lock for as long as it lives (the
 * browser releases it when the tab closes or crashes), and any other tab is told so and works in
 * memory without reading or writing the saved work, so two tabs can never write over each other. A
 * browser without Web Locks has no way to tell, and every tab then takes ownership.
 */
function claimWork(): Promise<boolean> {
  const { locks } = navigator
  if (!locks) return Promise.resolve(true)
  return new Promise((resolve) => {
    void locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      resolve(lock !== null)
      return lock ? new Promise<never>(() => undefined) : undefined
    })
  })
}

/** A damaged thumbnail cannot be decoded; a whole one can, and decoding a small image is cheap. */
const canShow = (thumbnail: Blob) =>
  createImageBitmap(thumbnail).then(
    (bitmap) => {
      bitmap.close()
      return true
    },
    () => false,
  )

function describeSkipped(skipped: readonly SkippedImage[]) {
  const shown = skipped.slice(0, 4).map(({ name, reason }) => `${name} (${SKIP_REASONS[reason]})`)
  const more = skipped.length - shown.length
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ')
}

/** Asked for once, after something has been saved: a browser that grants it will not clear the work to free space. */
let persistenceAsked = false
function askForPersistence() {
  if (persistenceAsked) return
  persistenceAsked = true
  void navigator.storage?.persist?.().catch(() => undefined)
}

const source: WorkSource = {
  read: () => useAppStore.getState().images,
  subscribe: (listener) =>
    useAppStore.subscribe((state, previous) => {
      if (state.images !== previous.images) listener()
    }),
}

/**
 * Brings back the work saved on this device, adding it to the app in one step like any other batch,
 * and from then on keeps the saved copy in step with the photos. It runs once, when the page loads.
 * Whatever goes wrong, the app carries on in memory and the status says why.
 */
export async function startWorkSession() {
  const state = () => useAppStore.getState()
  const hinted = readWorkHint() > 0

  if (!(await claimWork())) {
    state().setWorkStatus('other-tab')
    return
  }

  const store = createIndexedDbStore()
  let epoch = 0
  let listed = 0
  let released = false
  const release = () => {
    if (listed > 0 && !released) state().commitImport([], listed, epoch)
    released = true
  }

  let outcome
  try {
    outcome = await restoreWork(store, {
      canShow,
      onListed: (count) => {
        listed = count
        epoch = state().beginImport(count, 'restore')
      },
      onChecked: () => state().reportDecoded(),
    })
  } catch (error) {
    release()
    state().setWorkStatus(
      STATUS_BY_FAILURE[error instanceof WorkStorageError ? error.failure : 'failed'],
    )
    store.close()
    return
  }

  if (outcome.kind === 'newer') {
    state().setWorkStatus('newer')
    store.close()
    return
  }

  let initial: Parameters<typeof createWorkSync>[0]['initial'] = { ids: [], items: [] }
  if (outcome.kind === 'corrupt') {
    initial = { ids: outcome.storedIds, items: null }
    toast.error('Your saved work could not be read', {
      description: 'It was set aside and the photos you add from now on are saved afresh.',
    })
  } else if (outcome.kind === 'restored') {
    initial = { ids: outcome.storedIds, items: outcome.saved }
    const { images, skipped } = outcome
    const added = state().commitImport(images, listed, epoch, 'start')
    released = true
    if (added && images.length > 0)
      state().announce(`Restored ${pluralize(images.length, 'image')}`)
    if (skipped.length > 0)
      toast.error(`Could not restore ${pluralize(skipped.length, 'photo')}`, {
        description: describeSkipped(skipped),
      })
  } else if (hinted) {
    writeWorkHint(0)
    toast.error('Your saved work is gone', {
      description: 'The browser may have cleared it to free space.',
    })
  }

  state().setWorkStatus('saved')
  createWorkSync({
    store,
    source,
    initial,
    onState: (next) =>
      state().setWorkStatus(next.kind === 'saved' ? 'saved' : STATUS_BY_FAILURE[next.failure]),
    onSaved: (count) => {
      writeWorkHint(count)
      if (count > 0) askForPersistence()
    },
  })
}
