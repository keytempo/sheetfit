import { pluralize } from '@/lib/format'
import type { Failure } from '@/lib/presets/operations'
import { totalSkipped, type SkipReason } from '@/lib/presets/read'
import { PRESET_LIMITS } from '@/lib/presets/schema'
import type { Availability, LoadNotice } from '@/lib/presets/storage'
import type { ImportProblem } from '@/lib/presets/transfer'

export const quoted = (name: string) => `“${name}”`

/** What a preset keeps and what it does not, said in the save dialog so nobody is surprised. */
export const WHAT_IS_SAVED =
  'Keeps the sheet, base print size, spacing and layout options. Images, copies, per-image sizes, units and the preview switches are not saved.'

export const FAILURES: Record<Failure, string> = {
  'name-empty': 'Enter a name.',
  'name-too-long': `Use ${PRESET_LIMITS.nameLength} characters or fewer.`,
  'name-taken': 'A preset with that name already exists.',
  limit: `You can keep up to ${PRESET_LIMITS.count} presets. Delete one first.`,
  'not-found': 'That preset no longer exists.',
  'read-only': 'These presets come from a newer version of Sheetfit and can’t be changed here.',
}

/** Shown in the menu while presets cannot be kept, and added to what a change says. */
export const AVAILABILITY: Record<Availability, string | null> = {
  ok: null,
  unavailable:
    'This browser can’t save presets, so they last only until you close or reload the tab. Export them to keep a copy.',
  full: 'Browser storage is full, so changes to presets last only until you close or reload the tab. Export them to keep a copy.',
  'read-only':
    'Saved by a newer version of Sheetfit. You can apply and export these presets, not change them.',
}

export const IMPORT_PROBLEMS: Record<ImportProblem, string> = {
  'too-big': 'That file is too big to be a presets file.',
  'not-json': 'That file can’t be read: it is not JSON.',
  'not-presets': 'That is not a Sheetfit presets file.',
  'newer-version': 'That file was made by a newer version of Sheetfit and can’t be read here.',
  'no-presets': 'That file has no presets in it.',
}

export const SKIP_REASONS: Record<SkipReason, string> = {
  'not-a-preset': 'not a preset',
  'no-name': 'has no name',
  'no-settings': 'has no settings',
  'over-limit': `over the limit of ${PRESET_LIMITS.count} presets`,
}

/** What the first read of storage had to leave out. */
export function noticeText(notice: LoadNotice): string {
  switch (notice.kind) {
    case 'unreadable':
      return 'Saved presets couldn’t be read, so none were loaded. Saving a preset replaces them.'
    case 'newer-version':
      return AVAILABILITY['read-only'] ?? ''
    case 'skipped': {
      const skipped = totalSkipped(notice.counts)
      const parts = []
      if (skipped > 0)
        parts.push(
          `${pluralize(skipped, 'saved preset')} couldn’t be used and ${skipped === 1 ? 'was' : 'were'} skipped.`,
        )
      if (notice.adjusted > 0)
        parts.push(
          `${pluralize(notice.adjusted, 'preset')} had values outside their limits and ${notice.adjusted === 1 ? 'was' : 'were'} adjusted.`,
        )
      return parts.join(' ')
    }
  }
}
