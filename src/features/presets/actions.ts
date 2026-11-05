import { toast } from 'sonner'
import { downloadBlob } from '@/lib/download'
import { pluralize } from '@/lib/format'
import {
  addImported,
  addPreset,
  duplicatePreset,
  removePreset,
  renamePreset,
  replaceSettings,
  restorePreset,
  type Failure,
} from '@/lib/presets/operations'
import type { ReadEntry } from '@/lib/presets/read'
import type { Preset } from '@/lib/presets/schema'
import { settingsFromOptions } from '@/lib/presets/settings'
import { exportFileName, serialisePresets } from '@/lib/presets/transfer'
import { useAppStore } from '@/store'
import { presetBook } from '@/store/presets'
import type { LoadNotice } from '@/lib/presets/storage'
import { AVAILABILITY, FAILURES, noticeText, quoted } from './messages'

const UNDO_MS = 6000

/**
 * One preset toast at a time, so an old Undo is never left on screen beside a newer one. The old
 * toast is dismissed and the new one gets an id of its own: reusing an id while the old toast is
 * still leaving makes the new one disappear with it.
 */
let shown: string | number | undefined
function show(post: () => string | number) {
  if (shown !== undefined) toast.dismiss(shown)
  shown = post()
}

const currentSettings = () => settingsFromOptions(useAppStore.getState().options)

/** Tells the person what happened, in the toast and in the live region. */
function say(text: string, undo?: () => void) {
  useAppStore.getState().announce(text)
  show(() => toast(text, { duration: UNDO_MS, action: undo && { label: 'Undo', onClick: undo } }))
}

/** Says what a change to the saved presets did, and adds why when it could not be kept. */
function report(message: string, undo?: () => void) {
  const warning = AVAILABILITY[presetBook.store.getState().availability]
  say(warning && warning !== AVAILABILITY['read-only'] ? `${message} ${warning}` : message, undo)
}

/** Says what the first read of storage had to leave out. It stays up longer than an ordinary toast. */
export function reportLoadNotice(notice: LoadNotice) {
  const text = noticeText(notice)
  useAppStore.getState().announce(text)
  show(() => toast(text, { duration: 10_000 }))
}

function refuse(reason: Failure) {
  useAppStore.getState().announce(FAILURES[reason])
  show(() => toast.error(FAILURES[reason]))
}

/** The active preset goes back to what it was before; one that has since been deleted is dropped. */
function restoreActive(id: string | null) {
  if (id === null || !presetBook.activate(id).ok) presetBook.clearActive()
}

/** Puts a preset's settings into the print options. This is the one place presets reach them. */
export function applyPreset(id: string, verb: 'Applied' | 'Reverted to' = 'Applied') {
  const before = currentSettings()
  const previousActive = presetBook.store.getState().activeId
  const activated = presetBook.activate(id)
  if (!activated.ok) return refuse(activated.reason)

  useAppStore.getState().applyOptions(activated.preset.settings)
  say(`${verb} ${quoted(activated.preset.name)}.`, () => {
    useAppStore.getState().applyOptions(before)
    restoreActive(previousActive)
    useAppStore.getState().announce('Settings restored')
  })
}

/** Returns why it failed, so the dialog can show it next to the name; null when it worked. */
export function saveCurrentSettings(rawName: string): Failure | null {
  const result = presetBook.commit(
    (presets) => addPreset(presets, rawName, currentSettings(), presetBook.makeId),
    (preset) => preset.id,
  )
  if (!result.ok) return result.reason
  report(`Saved ${quoted(result.value.name)}.`)
  return null
}

export function renameSavedPreset(id: string, rawName: string): Failure | null {
  const result = presetBook.commit((presets) => renamePreset(presets, id, rawName))
  if (!result.ok) return result.reason
  const preset = presetBook.store.getState().presets.find((candidate) => candidate.id === id)
  report(`Renamed ${quoted(result.value)} to ${quoted(preset?.name ?? rawName)}.`)
  return null
}

export function updateFromCurrent(id: string) {
  const result = presetBook.commit(
    (presets) => replaceSettings(presets, id, currentSettings()),
    () => id,
  )
  if (!result.ok) return refuse(result.reason)
  const before = result.value
  report(`Updated ${quoted(before.name)} with the current settings.`, () => {
    const undone = presetBook.commit((presets) => replaceSettings(presets, id, before.settings))
    if (undone.ok) report(`Restored ${quoted(before.name)}.`)
    else refuse(undone.reason)
  })
}

export function duplicateSavedPreset(id: string) {
  const result = presetBook.commit((presets) => duplicatePreset(presets, id, presetBook.makeId))
  if (!result.ok) return refuse(result.reason)
  report(`Duplicated as ${quoted(result.value.name)}.`)
}

export function deleteSavedPreset(id: string) {
  const wasActive = presetBook.store.getState().activeId === id
  const result = presetBook.commit((presets) => removePreset(presets, id))
  if (!result.ok) return refuse(result.reason)
  const { preset, index } = result.value
  report(`Deleted ${quoted(preset.name)}.`, () => {
    const undone = presetBook.commit(
      (presets) => restorePreset(presets, preset, index, presetBook.makeId),
      (restored, current) => (wasActive ? restored.id : current),
    )
    if (undone.ok) report(`Restored ${quoted(undone.value.name)}.`)
    else refuse(undone.reason)
  })
}

export function exportPresets(presets: readonly Preset[]) {
  if (presets.length === 0) return
  const text = serialisePresets(presets, __APP_VERSION__, new Date())
  downloadBlob(new Blob([text], { type: 'application/json' }), exportFileName(presets))
  const message =
    presets.length === 1
      ? `Exported ${quoted(presets[0].name)}.`
      : `Exported ${pluralize(presets.length, 'preset')}.`
  useAppStore.getState().announce(message)
  show(() => toast(message))
}

/** Exports what storage holds now, which may include presets another tab just added. */
export function exportAll() {
  presetBook.reload()
  exportPresets(presetBook.store.getState().presets)
}

export function exportOne(id: string) {
  presetBook.reload()
  exportPresets(presetBook.store.getState().presets.filter((preset) => preset.id === id))
}

/** Adds what the previewed file holds. Returns false when nothing could be added. */
export function importEntries(entries: readonly ReadEntry[]): boolean {
  const result = presetBook.commit((presets) => addImported(presets, entries, presetBook.makeId))
  if (!result.ok) {
    refuse(result.reason)
    return false
  }
  const { added, left } = result.value
  report(
    `Added ${pluralize(added.length, 'preset')}.` +
      (left > 0 ? ` ${pluralize(left, 'preset')} did not fit under the limit.` : ''),
  )
  return true
}
