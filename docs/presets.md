# Presets

A preset is a named snapshot of the print settings. People print the same kinds of job again and
again (passport photos on A4, 4×6 inch prints on A3, a custom sheet for one paper stock), and a
preset switches the whole set of settings in one step.

Presets are separate from the persisted print options. Persistence remembers "what I had last"
(`sheetfit:v1`); presets are the snapshots a person chose to keep (`sheetfit:presets`). Neither key
reads, writes or depends on the other. The photos a person is working on are saved in a third place
(`sheetfit-work`, [persistence.md](persistence.md)); presets never touch them and they never touch presets.

## 1. What a preset contains

Every piece of state in the app, and the decision about it:

| State                                                                                          | In a preset? | Why                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheetSize`, `customWidth`, `customHeight`, `orientation`                                      | Yes          | The paper. A job is defined by it.                                                                                                                                                                                                                                                                                                                        |
| `baseMode`, `baseLength`, `baseDpi`                                                            | Yes          | The base print size every photo is scaled from.                                                                                                                                                                                                                                                                                                           |
| `margin`, `gap`                                                                                | Yes          | Spacing changes what is printed and how much fits.                                                                                                                                                                                                                                                                                                        |
| `allowRotation`, `ordering`                                                                    | Yes          | They change the layout.                                                                                                                                                                                                                                                                                                                                   |
| `cutGuides`                                                                                    | Yes          | They change the PDF.                                                                                                                                                                                                                                                                                                                                      |
| `timeLimit`                                                                                    | **No**       | How hard the packer searches, not what a preset produces: the same preset gives the same sheet, sizes and gaps at any limit, so it is an effort preference like the unit. Applying a preset never changes it, saving one never stores it, and presets need no migration (their stored version is unchanged). Changing it never makes a preset "Modified". |
| `unit`                                                                                         | **No**       | A display preference. Every length is stored in millimetres, so a preset means the same in any unit; applying one must not flip the units.                                                                                                                                                                                                                |
| `showMargins`, `showSheetNumbers`                                                              | **No**       | Preview-only switches that never reach the PDF. A person who hid the margins does not expect a preset to turn them back on.                                                                                                                                                                                                                               |
| The images, their order, `copies`, per-image `percent`                                         | **No**       | They belong to a job, not to print settings. Presets never touch them.                                                                                                                                                                                                                                                                                    |
| Selection, hovered piece, current sheet, zoom, view mode, panel split, Print options open, tab | **No**       | View state.                                                                                                                                                                                                                                                                                                                                               |
| The theme (`sheetfit:theme`)                                                                   | **No**       | A device preference with its own storage.                                                                                                                                                                                                                                                                                                                 |

The save dialog says it in plain words: it keeps the sheet, the base print size, spacing and layout
options, and does not keep images, copies, per-image sizes, units or the preview switches.

Per-image sizes are percentages of the base print size, so an image the person resized prints larger
or smaller when a preset changes the base size. That is how sizes already behave when the base size is
edited by hand, and it is why they are not part of a preset.

## 2. What happens when a preset is applied

Applying calls one store action, `applyOptions`, which merges the twelve settings into the options in
a single update. Everything after that is the app's existing flow, unchanged.

- **Packing.** The layout inputs change once, so exactly one packing run starts, the run that was
  still searching is cancelled, and the previous layout stays on screen until the new one arrives.
  Several applies in the same tick make one run. Several in separate ticks cancel each other and
  end on the layout for the final settings (`e2e/presets.mjs`, section 7).
- **Sizes.** The size limit depends on the sheet, margin and orientation, so applying a preset can
  change the effective printed size of images that were already at their limit. Stored percentages
  are never modified.
- **Export.** An export works on a snapshot taken when Download PDF was pressed. A preset applied
  while it runs changes the preview, not the file in progress. (The export dialog is modal, so this
  is only reachable from a script.)
- **Hover statistics and the status badge** read the layout, so they follow it.
- **Last-used options.** The change is saved by the normal persistence of the options, like any
  other change.
- **Reset to defaults** is unchanged: it resets every print option, including units and the preview
  switches, and never touches presets. The active preset is then shown as modified.
- **Undo.** The apply toast has Undo, which puts the previous settings back in one update and
  restores which preset was active. Only one preset toast is ever on screen, so an old Undo cannot
  outlive a newer action.

## 3. The active preset and "Modified"

The store remembers which preset was last applied or saved (`activeId`). Whether the current settings
still match it is worked out whenever it is read, never stored (`resolveActive` in
`src/lib/presets/settings.ts`):

1. The remembered preset, while the current settings equal its settings.
2. Otherwise the first preset the current settings equal exactly.
3. Otherwise the remembered preset, shown as **Modified**.
4. Otherwise no preset.

Settings are compared as they act. A custom width and height do nothing while a standard sheet is
chosen, a length does nothing in native mode, and a DPI does nothing in the other modes, so a
difference in one of those is not "modified".

From Modified the menu offers **Update** (overwrite the preset with the current settings, with Undo)
and **Revert** (apply it again, with Undo).

## 4. Storage

Key `sheetfit:presets`, one JSON document:

```json
{
  "version": 1,
  "presets": [{ "id": "9f3a…", "name": "Passport photos", "settings": { "sheetSize": "a4", … } }],
  "activeId": "9f3a…"
}
```

`settings` has exactly the twelve keys of section 1. Ids are random hex strings.

### Limits and names

| Limit                    | Value                                                         |
| ------------------------ | ------------------------------------------------------------- |
| Presets                  | 50                                                            |
| Name length              | 40 characters (code points, so one emoji counts as one)       |
| Import file              | 512 kB                                                        |
| Entries read from a list | 1000; further entries are counted as over the limit, not read |

A name is normalised to NFC, lone surrogates and invisible characters (controls, zero-width marks and
direction overrides, which can make two names look alike) are removed, runs of whitespace become one
space, and it is trimmed. Names are unique ignoring case. A typed name that is taken is refused with
a message; a duplicate is called `X copy`, then `X copy 2`; an imported name that is taken becomes
`X 2`. A name that is too long is refused when typed and cut when read from storage or a file.

### Versions

Version 1 is the first schema. `loadPresets` reads a document by its `version`:

- **1**: read as described below.
- **Greater than 1** (written by a newer deployment and then opened by an older one): read as far as
  this version understands it (unknown fields are dropped) and treated as **read-only**. Presets can
  be applied and exported, never changed, and the stored text is never written, so nothing a newer
  version stored is lost.
- **Missing, zero, fractional, not a number, or not JSON**: unreadable. The list starts empty and the
  person is told. The stored text is replaced by the next successful save.

A later schema adds a reader for its version and keeps the version 1 reader as the upgrade step; the
in-memory model stays the same.

### Reading is validation

Nothing from storage or from a file is trusted. Each entry is read on its own by `readEntries`, and a
bad entry never stops the others:

- Not an object, no usable name, or no recognised setting: **skipped** and counted.
- Beyond the limit: skipped as over the limit.
- Settings pass through `sanitizeOptions`, the same rules as the options themselves (so the rules are
  not duplicated), and only the twelve keys are kept. A missing setting takes its default, which is
  how a preset from an older version keeps working. A value outside its limits is clamped, and the
  preset is counted as **adjusted**.
- An invalid or repeated id is replaced; a repeated name is made unique.
- Prototype keys such as `__proto__` are never copied.

Loading never writes. Bad entries are dropped when the next change saves the list.

### When storage fails

`availability` is one of:

| State         | Meaning                                              | What the person sees                             |
| ------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `ok`          | Read and written normally                            | Nothing                                          |
| `unavailable` | The browser gives no storage (blocked, private mode) | A line in the menu, and a sentence in each toast |
| `full`        | Storage refused the last write                       | The same                                         |
| `read-only`   | Presets from a newer version                         | A line in the menu; changing items are disabled  |

In `unavailable` and `full` the tab's own list is the only copy: every operation still works on it,
nothing crashes, and it is no longer re-read from storage. The next write that succeeds saves the whole
list and returns to `ok`.

## 5. Several tabs

Storage is the truth. Every change first reads it again, applies the change to what it finds, and
writes the result, so a change another tab made since the last read is not lost. A `storage` event
for the key makes the tab read the list again, so a preset saved in one tab appears in the other
without a reload, and a preset deleted in one disappears from the other.

Only the list is shared. Each tab keeps its own print options and its own active preset: applying
a preset in one tab never changes another tab's options, and a tab whose active preset was deleted
elsewhere simply has none. A new tab starts from what the last tab to write had (its options and its
active preset), as the persisted options already do.

**Known limit.** localStorage is not instantly coherent between two tab processes, so two changes that
land within a few tens of milliseconds can lose one of them: the reader of the second change has not
yet seen the write of the first. This was measured with two tabs pressing Save at a set interval
apart, 12 rounds per interval: one save was lost in 2 rounds at 0 ms, 1 at 3 ms, none at 10 ms, 1 at
25 ms and none at 50 or 100 ms (earlier runs lost 3 of 10 rounds at 0 ms and 3 of 10 at 5 ms, and 6 of
12 at 0 ms). Both tabs and the storage always ended on the same valid list. A person using one tab at
a time cannot produce this, and nothing repairs it: a repair (re-adding a preset that vanished)
cannot tell a lost write from a deletion in the other tab and could bring back a preset someone
deleted.

## 6. Export and import

An exported file is plain JSON with a marker, the schema version and the app version:

```json
{
  "format": "sheetfit-presets",
  "version": 1,
  "appVersion": "0.1.0",
  "exportedAt": "2026-11-04T09:30:00.000Z",
  "presets": [{ "name": "Passport photos", "settings": { "sheetSize": "a4", … } }]
}
```

Ids are not exported; an import always makes new ones. A single preset exports as
`sheetfit-preset-<name>.json`, all of them as `sheetfit-presets.json`.

Import never changes anything before the person confirms:

1. The file is refused as a whole, with a plain reason, when it is over 512 kB, not JSON, not a
   Sheetfit presets file (no marker or malformed), from a newer version, or empty.
2. Inside a good file each entry stands or falls on its own. The dialog lists what will be added,
   which names were changed because they were taken, which values were adjusted, and what is skipped
   and why (up to 20 shown, the rest counted).
3. Confirming adds the entries after the existing presets. Nothing existing is replaced or changed.
   If the list changed since the preview, names and the limit are checked again at that moment.

Nothing in a file is ever evaluated. Names are text; they are rendered as text.

## 7. The interface

- **Where.** A button in the header, right after the brand, in the space Chunk 1 reserved. It shows
  the active preset's name (and "Modified") from 1024 px up, and only an icon below that, with a dot
  for Modified. Its accessible name always contains the visible text: `Presets: <name> Modified`.
- **The menu.** The presets as a radio group (choosing one applies it); when the active preset is
  modified, Update and Revert; Save current settings…; Manage presets (each preset has Rename…,
  Duplicate, Update with current settings, Export and Delete); Import presets…; Export all presets.
  Status lines at the top say when presets cannot be kept, when stored data was skipped, and when a
  list came from a newer version. An empty list says so and offers to save.
- **Dialogs** only where a name or a file is needed (save, rename, import). They follow the existing
  dialog pattern, return focus to the control, and show errors next to the field.
- **Feedback.** Every result is a toast and an aria-live announcement. Delete, Update, Apply and Revert
  have Undo. Delete has no confirmation: Undo is the app's pattern for removal (images), and it puts
  the preset back in the same place with the same id and active mark.
- **No built-in "Defaults" entry.** Reset to defaults already exists and resets a different set of
  options (it includes the units and preview switches). A second way to "go back to defaults" that
  did something slightly different would be confusing.
- **No keyboard shortcut.** The app has no global shortcuts apart from paste; a menu reached from the
  keyboard is enough.
- **Mobile.** The control sits in the header at every width. Below 380 px the "Sheetfit" wordmark
  is hidden (still read by screen readers) so the header fits a 360 px phone with 44 px targets.

### A finding about every menu in the app

With any Radix menu open, including the existing theme menu, axe reports `aria-hidden-focus`: Radix
hides the page behind a menu with `aria-hidden` and keeps focus inside the menu instead of making the
page inert. The audit of the presets menu excludes that one rule in menu-open states, and a separate
check shows that Tab and Shift+Tab cannot leave an open menu. Making the page inert while a menu is
open would settle it for all menus; it is outside this chunk.

## 8. Where the code is

| Path                            | Role                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/presets/schema.ts`     | The twelve keys, limits, storage key, ids                                   |
| `src/lib/presets/name.ts`       | Cleaning, uniqueness, copy names                                            |
| `src/lib/presets/settings.ts`   | Reading settings through `sanitizeOptions`, comparing, the active preset    |
| `src/lib/presets/read.ts`       | Reading a list of entries, with skip reasons                                |
| `src/lib/presets/operations.ts` | Add, update, rename, duplicate, remove, restore, import: pure functions     |
| `src/lib/presets/storage.ts`    | Loading and saving the document, availability                               |
| `src/lib/presets/transfer.ts`   | The export file and the import preview                                      |
| `src/store/presets.ts`          | The preset book: re-read before each change, memory-only when storage fails |
| `src/features/presets/`         | The menu, the dialogs, the actions (toasts, Undo) and the wording           |

Everything under `src/lib/presets` and `src/store/presets.ts` is plain TypeScript with no React;
`src/lib/presets` is excluded from the Tailwind scanner. Tests: `docs/testing.md`.

## 9. Limits of this feature

- Two changes from two tabs within a few tens of milliseconds can lose one (section 5).
- Unreadable stored text and entries that were skipped are replaced by the next save; a copy is not
  kept.
- Presets live in one browser on one device. Export and import move them between devices.
- Only Chrome was tested.
