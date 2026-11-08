/**
 * A hint, readable at once, of whether anything was saved: the number of photos at the last save.
 * Opening the database takes a moment, and a person who had work should see "Restoring…" from the
 * first frame while someone with nothing saved should never see it. The hint is only that: the
 * database is the truth, and a stale hint costs a moment of "Restoring…" at worst. It also lets the
 * app notice when the browser has cleared saved work while the page was closed.
 */
const KEY = 'sheetfit:work-hint'

export function readWorkHint(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): number {
  try {
    const value = Number(storage?.getItem(KEY))
    return Number.isInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function writeWorkHint(
  count: number,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage(),
) {
  try {
    if (count > 0) storage?.setItem(KEY, String(count))
    else storage?.removeItem(KEY)
  } catch {
    // The hint is a convenience; losing it changes nothing that matters.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
