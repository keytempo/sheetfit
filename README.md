# Sheetfit

Sheetfit packs copies of your photos onto printable sheets with as little wasted paper as possible.
You add photos, choose how many copies of each you want and how large each prints, and Sheetfit lays
every copy onto sheets (aspect ratio never changed, 90° rotation allowed) and exports a PDF. You
print it and cut the photos apart by hand, so saving paper and ink is the whole point.

Everything runs in the browser. Photos are read into memory as object URLs and are never uploaded.

## Roadmap

| Chunk | Scope                                                                            | Status  |
| ----- | -------------------------------------------------------------------------------- | ------- |
| 1     | The complete UI, UX and responsiveness. Packing and PDF export are placeholders. | **Now** |
| 2     | The packing algorithm (replaces the placeholder layout)                          | Planned |
| 3     | Presets (a menu in the header)                                                   | Planned |
| 4     | In-app manual (a help button in the header)                                      | Planned |

Real PDF export arrives together with the packer in chunk 2.

### What is a placeholder in chunk 1

Only two things are stand-ins, and both live in `src/placeholders/`:

- **Layout**: `layout.ts` is a trivial shelf layout (left to right, new row, new sheet). It does no
  optimisation and ignores the "Ordering" option. The preview shows a **Placeholder layout** badge.
- **Export**: `export.ts` simulates about two seconds of progress and produces no file. The dialog
  says "UI preview only, no file produced". Every third attempt fails on purpose so the error and
  retry states can be reviewed.

The UI imports them only through `src/placeholders/index.ts`. To swap in the real thing, implement
`LayoutFunction` (`src/lib/layout-types.ts`) or `ExportFunction` (`src/lib/export-types.ts`) and
change the export in that one file. `useSheetLayout()` in `src/store/derived.ts` is the single place
that calls the layout; it is synchronous today and is where a worker-based packer would be awaited.

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
    export/          Export dialog shell
  lib/               Units, sizing maths, sheet geometry, contracts, motion tokens, helpers
  placeholders/      The marked stand-ins for packing and PDF export
  store/             The zustand store (images, options and UI slices) and derived hooks
```

### State and persistence

One store holds the image list, the print options and UI state. Print options and panel sizes persist
in `localStorage` (`sheetfit:v1`); the theme persists under `sheetfit:theme`. The image list never
persists. Every length is stored in millimetres whatever unit is displayed. Anything that can be
computed from state (the layout, printed sizes, the per-image size limit, DPI) is computed when it is
read and never stored.

### Where the header grows

The header leaves room for the later chunks: the empty space between the brand and the actions is
where the presets menu goes, and the help button goes between the Print options button and the theme
menu.

## Browser support

Current evergreen browsers. The preview relies on CSS container query units (Chrome 105, Safari 16,
Firefox 110) so the sheet re-fits while the divider is dragged, and image decoding uses
`createImageBitmap` with EXIF orientation.
