# Sheetfit

Sheetfit packs copies of your photos onto printable sheets with as little wasted paper as possible.
You add photos, choose how many copies of each you want and how large each prints, and Sheetfit lays
every copy onto sheets (aspect ratio never changed, 90° rotation allowed) and exports a PDF. You
print it and cut the photos apart by hand, so saving paper and ink is the whole point.

Everything runs in the browser. Photos are read into memory as object URLs and are never uploaded.

## Roadmap

| Chunk | Scope                                                                                      | Status   |
| ----- | ------------------------------------------------------------------------------------------ | -------- |
| 1     | UI: the complete UI, UX and responsiveness                                                 | **Done** |
| 2     | Packing algorithm: a standalone, tested engine in `src/packing`                            | **Done** |
| 3     | Integration of the packer, real PDF export, and a verification of everything               | **Done** |
| 4     | Presets: named snapshots of the print settings, in a menu in the header                    | **Done** |
| 5     | Work persistence, batch import, direct print, deselect and packing time limit (this chunk) | Done     |
| 6     | In-app manual (a help button in the header)                                                | Planned  |
| 7     | QA                                                                                         | Planned  |

## How it works

- **Layout.** Every change to the photos or the options that can alter a layout sends the sizes to a
  Web Worker, which packs them (`src/packing`), answers with a first layout almost at once, and then
  keeps improving it for up to three seconds. The preview shows each better layout as it arrives and
  says so: "Optimizing…", "Optimal" (proven to use the fewest sheets possible) or "Best found". If the
  worker cannot run, the page packs on its own thread. Design, algorithms, benchmarks and how the app
  uses it: [`docs/packing.md`](docs/packing.md).
- **PDF.** Download PDF writes the layout that is on screen as a PDF in another Web Worker: one page
  per sheet, each photo stored once however many copies there are, JPEGs byte for byte, everything
  else without loss. When it is ready nothing is saved or printed by itself: the dialog offers
  Download PDF and Print, which sends it to the browser's print dialog from memory without saving a
  file. Structure, image rules, the print path and what each browser allows:
  [`docs/pdf-export.md`](docs/pdf-export.md).
- **Packing time limit.** Print options > Layout > Packing time limit (1 s to 10 min, 3 s by default)
  is how long the packer may search. When it stops because of the limit the preview shows a Continue
  pill, which searches again from the best layout found, for another limit,
  as often as wanted. It is not part of a preset. See [`docs/packing.md`](docs/packing.md).
- **Saved work.** Refreshing or closing the app loses nothing: the photos (original bytes, so exports
  stay lossless), their order, copies and sizes are saved on this device in IndexedDB as they change
  and restored on load in one step. Nothing is uploaded. One tab owns the saved work and the others
  work in memory and say so; when storage is unavailable or full the app carries on in memory and
  says so. See [`docs/persistence.md`](docs/persistence.md).
- **Photos.** Many photos added at once (file picker, drop or paste) are decoded one after another
  and added to the list in one step, so the packer runs once for the batch. Clicking empty space in
  the list or the preview, or pressing Escape, deselects the selected photo.
- **Presets.** The Presets menu in the header saves the current print settings under a name and
  applies, updates, renames, duplicates, deletes (with Undo), exports and imports them. A preset is
  the sheet, base size, spacing and layout options only: never the photos, their copies or sizes, the
  units or the preview switches. They live under their own key, apart from the last-used options.
  Everything read from storage or from a file is validated first. Design, the schema, what is
  saved and why, and the rules for storage failures, several tabs and imports:
  [`docs/presets.md`](docs/presets.md).
- **Verification.** Unit tests, benchmarks and browser checks (layout, every control, PDF validity
  with external tools, accessibility, responsiveness, presets, batch import, deselecting, printing): [`docs/testing.md`](docs/testing.md).

## Local development

Requires Node 20.19 or newer (the repository pins Node 22 in `.nvmrc`).

```sh
npm install
npm run dev          # start the dev server
npm run build        # type-check, then build the static site into dist/
npm run preview      # serve the production build locally
npm run typecheck    # tsc, strict mode
npm run lint         # ESLint, zero warnings allowed
npm run format       # Prettier (format:check only verifies)
npm test             # unit tests (the packer, the PDF writer, the app's maths)
npm run bench        # first-result timings of the packer
npm run bench:report # the packer's evidence tables
npm run build && npm run e2e   # browser checks; see docs/testing.md for what they need
```

## Deploying to Cloudflare Pages

The build is a fully static site: no server code, no Workers or Functions, and no environment
variables are needed.

| Setting                | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| Framework preset       | None (or Vite; the commands below are what matter)          |
| Build command          | `npm run build`                                             |
| Build output directory | `dist`                                                      |
| Root directory         | _(repository root)_                                         |
| Node version           | 22. Pages reads it from `.nvmrc`, so nothing needs setting. |

If you prefer to set it in the dashboard instead, add the variable `NODE_VERSION` = `22`.

## Stack

Vite, React 19, TypeScript (strict), Tailwind CSS 4 and shadcn/ui (Radix). The only other runtime
libraries are the ones the brief allows, each used for one job:

- `lucide-react`: icons
- `@dnd-kit/*`: the accessible sortable list (mouse, touch and keyboard)
- `react-resizable-panels`: the resizable divider (the shadcn Resizable component)
- `sonner`: toasts
- `zustand`: the one small store
- `motion`: layout, presence and fade animations only
- `@fontsource-variable/*`: self-hosted fonts (Bricolage Grotesque, Instrument Sans, JetBrains
  Mono). Nothing is requested from a CDN at runtime.

The packer and the PDF writer are written for this project and have no dependency at all. For
checking the app, `vitest` runs the unit tests, and `playwright` and `axe-core` drive the browser
checks; all three are development dependencies and are not part of the build.

## Project structure

```
src/
  app/               App shell, providers, theme, header, desktop and mobile layouts
  components/ui/     shadcn/ui components
  components/        Small shared components (number field, icon button, logo, kbd)
  features/
    images/          Window drop overlay, image list, rows, bulk actions
    print-options/   The Print options slide-over, its sections and controls
    preview/         Sheet preview, pieces, toolbar, hover stats, zoom
    export/          Export dialog: progress, then Download PDF and Print
    selection/       Deselecting: empty-space clicks and Escape
    work/            Restoring and saving the work (session) and the storage notice
    presets/         The presets menu, its dialogs, actions and wording
  lib/               Units, sizing maths, sheet geometry, contracts, motion tokens, helpers
    presets/         The presets data model: validation, storage, import and export
    work/            The saved work: records, validation, restore, sync, the IndexedDB store
  packing/           The packing engine, its worker, tests and benchmarks
  pdf/               The PDF writer, its worker, and a test-only PDF reader
  store/             The zustand store (images, options and UI slices), the packing hook, the presets
docs/                Developer documentation: packing, PDF export, presets, persistence, testing
e2e/                 Browser checks and their fixtures (run against the production build)
```

### State and persistence

One store holds the image list, the print options and UI state. Print options and panel sizes persist
in `localStorage` (`sheetfit:v1`); the theme persists under `sheetfit:theme`, and the presets under
`sheetfit:presets`, which never reads or writes the print options. The photos persist in IndexedDB
(`sheetfit-work`), separately from all of those ([`docs/persistence.md`](docs/persistence.md)); a
layout never persists, and neither does the selection. Saved settings are checked when they are read back, so a stale or
edited entry falls back to valid values. Every length is stored in millimetres whatever unit is
displayed. Printed sizes, the per-image size limit and DPI are computed when they are read and never
stored; the layout is the packer's answer for the current photos and options, held in memory by
`LayoutProvider` and replaced as the packer finds better ones.

### Where the header grows

The Presets menu now sits in the header, right after the brand. The help button for the in-app manual
goes between the Print options button and the theme menu.

## Browser support

Current evergreen browsers: Chrome and Edge 105 or newer, Firefox 114 or newer, Safari 16.4 or
newer. The preview relies on CSS container query units so the sheet re-fits while the divider is
dragged; packing and export use module Web Workers, and the export uses `CompressionStream`,
`OffscreenCanvas` and `createImageBitmap` (with EXIF orientation) inside a worker. These versions
are the ones where each of those features first shipped; **only Chrome has been tested**. Without
module workers the page still packs on its own thread, but cannot export.
