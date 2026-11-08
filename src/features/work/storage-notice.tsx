import { CloudOffIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import type { WorkStatus } from '@/store/types'

const NOTICES: Partial<Record<WorkStatus, string>> = {
  unavailable:
    'This browser can’t save your work on this device, so it is lost if you close or reload this tab. Nothing is uploaded.',
  full: 'This device has no room left to save your work, so recent photos are lost if you close or reload this tab. Nothing is uploaded.',
  failed:
    'Your work could not be saved just now, so it may be lost if you close or reload this tab. Saving is tried again at your next change.',
  'other-tab':
    'Your saved work is open in another tab, so this tab does not save. Close the other tab and reload this one to carry on with it.',
  newer:
    'Your saved work was made by a newer version of Sheetfit, which this version leaves alone, so this tab does not save.',
}

/**
 * Says, once and plainly, when this session's work is only in memory and why. It is a line in the
 * list, not a toast, so it does not interrupt and does not repeat; it goes away when saving works again.
 */
export function StorageNotice() {
  const status = useAppStore((state) => state.workStatus)
  const text = NOTICES[status]
  if (!text) return null
  return (
    <p
      role="status"
      className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/20 p-3 text-xs text-warning-foreground"
    >
      <CloudOffIcon className="mt-0.5 size-4 shrink-0" />
      {text}
    </p>
  )
}
