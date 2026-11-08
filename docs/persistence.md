# Persistence of the work

Refreshing or closing Sheetfit loses nothing a person has set up. The photos (their original bytes,
so exports stay lossless), their order, copies and sizes are saved **on this device** as they change
and put back when the page loads. Nothing is uploaded: the saved copy is in the browser's own
storage for this site, and the only requests the app makes are for its own files.

The code is in four layers, so the logic can be tested without a browser:

| Module                               | Role                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/lib/work/types.ts`, `meta.ts`   | The records, the `WorkStore` interface, parsing and validating what was read       |
| `src/lib/work/restore.ts`, `sync.ts` | Deciding what can be put back; keeping the store in step with the photos           |
| `src/lib/work/idb-store.ts`          | The one `WorkStore` implementation, on IndexedDB                                   |
| `src/features/work/session.ts`       | The wiring: lock, restore, start syncing, status; `storage-notice.tsx` is the line |

`WorkStore` has four methods (`load`, `save`, `clear`, `close`) and every one is all-or-nothing. A
plain in-memory implementation (`src/lib/work/testing/memory-store.ts`) lets 66 unit tests cover
every operation, failure and partial write; the real browser suite (`e2e/persist.mjs`) exercises the
real IndexedDB. No dependency was added, and no fake-IndexedDB package is needed.

## 1. Work contents

Every piece of state, and what happens to it:

| State                                                            | Class              | Decision and reason                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The photos' original bytes, file name and type                   | **Work**           | Restored. The export embeds JPEGs byte for byte, so the original is what must come back; it is stored as the `File` itself, never re-encoded.                                                                |
| Each photo's width and height                                    | **Work**           | Restored. Read once at import (with EXIF orientation applied); saving them means a restore does not decode anything.                                                                                         |
| Each photo's list thumbnail                                      | **Work** (derived) | Restored. A small WebP saved beside the original so a restore of hundreds of photos costs no decoding and no main-thread work. It is checked by decoding it (small and cheap) and skipped if damaged.        |
| Order of the list, copies and size per photo                     | **Work**           | Restored. Saved as a small list, rewritten when it changes, never together with a photo.                                                                                                                     |
| Print options (including the packing time limit)                 | Already persisted  | Left as they were: `localStorage` `sheetfit:v1`, validated by `sanitizeOptions`. "Reset to defaults" still means options only.                                                                               |
| Panel divider position                                           | Already persisted  | Left as it was, in the same entry.                                                                                                                                                                           |
| Presets                                                          | Already persisted  | Left as they were: their own key, versioned, independent of the work. Neither reads or writes the other.                                                                                                     |
| The active preset                                                | Already persisted  | Left as it was: per tab (`sessionStorage`), so a reload keeps it and a new tab does not.                                                                                                                     |
| Theme                                                            | Already persisted  | Left as it was.                                                                                                                                                                                              |
| The layout (sheets and where pieces are)                         | Recomputed         | Not saved. It is a pure function of the photos and options, and a saved one could be stale. One packing run starts after a restore, like after any batch.                                                    |
| Selection                                                        | Session            | Not saved, and not restored. It is where the person was pointing a moment ago; coming back to a highlighted photo would be surprising, and the selection rules say nothing is selected when the page is new. |
| Current sheet, zoom, view mode, the phone's Images / Preview tab | View               | Not restored. The defaults are always valid; a saved sheet number or zoom could point past the end of a different layout.                                                                                    |
| Hovered piece, the open Print options, menus, dialogs            | Transient          | Never saved.                                                                                                                                                                                                 |
| The export dialog, its progress and the finished PDF             | Transient          | Never saved. The PDF is held in memory only, and an export always reads the layout on screen.                                                                                                                |
| Toasts, the announcement for screen readers, import progress     | Transient          | Never saved.                                                                                                                                                                                                 |

The Chunk 1 decision "the image list is not persisted" is superseded by this chunk. The checks that
asserted it (`e2e/controls.mjs`, "Options persist across a reload; images and layouts do not") were
changed on purpose: the options **and the photo list** now persist; selection and layouts do not.

## 2. What is stored

One IndexedDB database, `sheetfit-work`, version 1:

- `images` (key `id`): `{ id, name, type, width, height, bytes, file, thumbnail }`. `file` is the
  original `File` and `thumbnail` a `Blob`; `bytes` is the size at save time, to tell a whole file from
  a cut-off one.
- `meta` (key `'work'`): `{ schema, savedAt, items: [{ id, name, copies, percent }] }` in list order.
  The list is the truth about what exists: a record in `images` that the list does not name is a stray.

Ids are `image-<uuid>`. They are saved with the photos and outlive the session, so a counter from 1
would collide with saved ones; two tabs could also hand out the same number.

`localStorage` `sheetfit:work-hint` holds a number: how many photos were saved last. It is only a
hint, readable at once: a person who had work sees "Restoring…" from the first frame, and someone with
nothing saved never does (opening the database takes a moment). The database is the truth; a stale
hint costs a moment of placeholders. A hint above zero with nothing in the database is how the app
notices the browser cleared the work while the page was closed, and says so.

**Persistent storage.** After the first successful save of a photo the app calls
`navigator.storage.persist()` once. A browser that grants it will not clear the work to free space.
A refusal, an absent API and a rejection are all ignored, with no notice: nothing is asked for before
there is something to protect, and it is never asked twice.

## 3. Writing

`createWorkSync` follows the app's photos and makes the store match them.

- **A photo's bytes are written once**, when it first appears. Moving a slider, changing copies or
  reordering rewrites only the small list. Removing a photo deletes its record; Undo saves it again.
- **Every write is one transaction** over both stores: the photos it needs and the list that names
  them commit together, or not at all. A tab that dies in the middle leaves the last complete state.
  A value that cannot be stored aborts the transaction explicitly, so it never half-commits.
- **One write at a time, coalesced, no timer.** While a write runs, further changes only mark the
  state dirty; when it ends there is one more write, from the state as it is then. Measured in
  `e2e/persist.mjs`: 60 size changes in a row cost **2 list writes and 0 photo writes**. A debounce
  would add latency (a tab closed 200 ms after a change would lose it) for no gain over this.
- **When the app is empty** (Clear all, or the last photo removed) the whole store is cleared in one
  step, strays included. Nothing is written for a change that is not a change to the photos.
- **Failure never loses anything in memory.** A failed save is reported and the next change tries
  again with everything still unsaved. If the store is full and the failed save included new photos,
  the app first frees what the person has removed, which may be what makes room.

## 4. Restoring

On load (`startWorkSession`, called from `main.tsx`):

1. Take ownership of the work ([section 6](#6-more-than-one-tab)).
2. Read the list and the records (`WorkStore.load`), then judge each photo (`restoreWork`):
   missing record, a file shorter than it was saved or empty, a record not shaped like a photo, a
   thumbnail that is empty or that the browser cannot decode. Each is skipped with its reason; none
   stops the others. The original file is **not** decoded at restore (that is slow for a 50 MP
   photo); it is decoded when exported, and an export that cannot read it says so as it always has.
3. Add everything that was usable **in one `commitImport`**, in the saved order, with the saved copies
   and sizes, **before** anything added meanwhile. One update means one packing run.
4. Say what happened: "Restored N images" for screen readers; a toast "Could not restore N photos"
   naming up to four with the reason ("its saved copy is gone / incomplete / damaged").
5. Start syncing. If some photos were skipped the list is rewritten once and their leftovers cleared.

While this happens the list shows placeholders and "Restoring 12 of 54…" (the same placeholders as an
import). Object URLs are created by the store when the batch is added and revoked when a photo is
removed, as for any photo. Restoring while the person adds photos is safe: the restored batch goes
first, nothing is lost, and each batch starts one packing run.

**Measured** (`e2e/persist.mjs`, Vite dev server, one slow core): 54 photos plus a 50-megapixel one
(8000 × 6250) come back byte-identical (SHA-256) in about 2.4 s, with **one packing run**.

## 5. Versions and migration

`WORK_SCHEMA` (in `types.ts`) is the version of the list. `parseMeta` reads the list as untrusted: a
list that is not an object, has no whole schema number or no `items` array is **corrupt** (treated as
nothing saved, set aside with a toast, and cleared on the next save); items that cannot be read are
dropped, a repeated id is kept once, and copies and sizes are put back inside their limits.

- **Older schema:** `MIGRATIONS[n]` turns version `n` into `n + 1`; `parseMeta` applies the chain. There
  is one version so far, so the table is empty; the first change to the shape adds a step and raises
  `WORK_SCHEMA`. A gap in the chain is treated as corrupt. (Tested with an invented version 3.)
- **Newer schema (or a newer database):** the work is left **alone**. It is not restored, nothing is
  ever written over it, and a notice says a newer version made it. Going back to the newer version
  finds it intact.
- **Options saved before the packing time limit existed** need no migration: `sanitizeOptions` gives the
  missing field its default.

## 6. More than one tab

One tab owns the saved work. The first tab to ask holds a Web Lock (`sheetfit-work`) for as long as it
lives; the browser releases it when the tab closes **or crashes**, so there is no stale lock to clear.
Any other tab works in memory, neither reads nor writes the saved work, and says so ("Your saved work
is open in another tab, so this tab does not save…"). That is safe by construction: no two tabs ever
write, so none can write over another, and Clear all in the second tab cannot clear the first's work.
Closing the first tab and reloading the second takes over. A browser without Web Locks (older than
Safari 15.4, Chrome 69, Firefox 96) cannot tell, and every tab takes ownership there, so two tabs can
overwrite each other's list; the presets know a similar limit (`docs/presets.md`).

## 7. When storage does not work

The app keeps working in memory and says so once, as a line at the top of the Images panel (not a
toast, so it neither interrupts nor repeats), which goes when saving works again.

| Situation                                             | Notice                                                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No IndexedDB, blocked (private mode), refused to open | "This browser can't save your work on this device, so it is lost if you close or reload this tab. Nothing is uploaded."                                                    |
| The device is full (`QuotaExceededError`)             | "This device has no room left to save your work, so recent photos are lost if you close or reload this tab…"                                                               |
| Any other failed save                                 | "Your work could not be saved just now… Saving is tried again at your next change."                                                                                        |
| Another tab owns the work                             | "Your saved work is open in another tab, so this tab does not save…"                                                                                                       |
| Work from a newer version                             | "Your saved work was made by a newer version of Sheetfit, which this version leaves alone…"                                                                                |
| Cleared by the browser while the page was closed      | A toast once: "Your saved work is gone. The browser may have cleared it to free space."                                                                                    |
| Cleared or deleted while the page is open             | The connection closes (`onclose`) and is dropped; the next write opens a fresh database and saves what is on screen. This path is written but was not exercised by a test. |
| Part of the saved work is damaged                     | The rest is restored; a toast names what was not.                                                                                                                          |

Simulated in `e2e/persist.mjs`: no IndexedDB, `open` throwing, writes throwing `QuotaExceededError`
(including recovery when room returns), corrupt, cut-off and missing records, a newer schema, two
tabs. **Not tested:** a real full disk (the quota error that surfaces when a transaction commits is
classified the same way as the one thrown by `put`, but only the latter was produced), eviction by a
real browser, and browsers other than Chrome.

## 8. Clear all, and starting fresh

Clear all keeps its meaning and its confirmation, which now also says that it removes "the copy kept on
this device". It clears the saved work in one step. No separate "start fresh" control was added: Clear all
is it, and print options and presets are kept as before (a person who wants those reset has Reset to
defaults and the Presets menu). Presets, options and the saved photos are independent: saving, applying
or deleting presets, editing options and Reset to defaults never touch the saved work
(`e2e/persist.mjs`, section 6).

## 9. Privacy wording

The empty state says "Images stay on this device and are kept here, so a reload does not lose them;
nothing is uploaded." Each notice above says "Nothing is uploaded" where it is about the saved copy
being unavailable. The test suites check that every request is same-origin.
