import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Failure, Outcome } from '@/lib/presets/operations'
import { newId, type Preset } from '@/lib/presets/schema'
import {
  browserStorage,
  loadPresets,
  savePresets,
  type Availability,
  type LoadNotice,
  type StorageLike,
} from '@/lib/presets/storage'

export interface PresetsState {
  presets: Preset[]
  /** The preset last applied or saved in this tab. Whether it still matches is worked out on read. */
  activeId: string | null
  availability: Availability
  /** What the last read of storage had to leave out, until the next successful save. */
  notice: LoadNotice | null
}

const keepIfPresent = (id: string | null, presets: readonly Preset[]) =>
  presets.some((preset) => preset.id === id) ? id : null

/**
 * The saved presets of this tab. Storage is the truth: every change first reads it again, applies
 * the change to what it finds and writes the result, so a change made in another tab since the last
 * read is never lost; and a change made in another tab is picked up when `reload` is called. Only
 * when storage cannot be used (`unavailable`, `full`) does the tab's own list stand in for it, and
 * then it is the only copy.
 */
export function createPresetBook(storage: StorageLike | null, makeId: () => string = newId) {
  const first = loadPresets(storage, makeId)
  const store: StoreApi<PresetsState> = createStore<PresetsState>(() => first)

  /** Reads storage again, unless this tab holds the only copy. */
  function reload() {
    const { availability, activeId } = store.getState()
    if (availability === 'unavailable' || availability === 'full') return
    const fresh = loadPresets(storage, makeId)
    store.setState({ ...fresh, activeId: keepIfPresent(activeId, fresh.presets) })
  }

  /**
   * Applies `change` to the current presets and saves the result. `nextActive` says which preset is
   * active afterwards; by default the one that was.
   */
  function commit<T>(
    change: (presets: Preset[]) => Outcome<T>,
    nextActive?: (value: T, current: string | null) => string | null,
  ): Outcome<T> {
    reload()
    const state = store.getState()
    if (state.availability === 'read-only') return { ok: false, reason: 'read-only' }
    const result = change(state.presets)
    if (!result.ok) return result
    const activeId = keepIfPresent(
      nextActive ? nextActive(result.value, state.activeId) : state.activeId,
      result.presets,
    )
    const saved = savePresets(storage, result.presets, activeId)
    store.setState({
      presets: result.presets,
      activeId,
      availability: saved,
      notice: saved === 'ok' ? null : state.notice,
    })
    return result
  }

  /**
   * Makes a preset the active one and gives back its latest version. Works on presets from a newer
   * version too, in this tab only, since it must not write to them.
   */
  function activate(id: string): { ok: true; preset: Preset } | { ok: false; reason: Failure } {
    reload()
    const state = store.getState()
    const preset = state.presets.find((candidate) => candidate.id === id)
    if (!preset) return { ok: false, reason: 'not-found' }
    if (state.availability === 'read-only') {
      store.setState({ activeId: id })
      return { ok: true, preset }
    }
    const saved = savePresets(storage, state.presets, id)
    store.setState({ activeId: id, availability: saved })
    return { ok: true, preset }
  }

  /** Makes no preset the active one. */
  function clearActive() {
    const state = store.getState()
    if (state.activeId === null) return
    const saved =
      state.availability === 'read-only'
        ? state.availability
        : savePresets(storage, state.presets, null)
    store.setState({ activeId: null, availability: saved })
  }

  return { store, reload, commit, activate, clearActive, makeId }
}

export const presetBook = createPresetBook(browserStorage())

export function usePresets<T>(select: (state: PresetsState) => T): T {
  return useStore(presetBook.store, select)
}
