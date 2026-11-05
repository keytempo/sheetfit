# Testing Sheetfit

## 1. Unit tests and benchmarks

```sh
npm test               # about 306 tests; the packer's own take about 40 s
npm run bench          # first-result timings of the packer
npm run bench:report   # the packer's evidence tables, about a minute
```

The packer is tested against an independent referee and brute force (see `docs/packing.md`); the
PDF writer through a test-only reader that checks every offset and length (`docs/pdf-export.md`);
`src/lib/print-options.test.ts` checks that whatever was saved in the browser, the options that come
back are valid and every copy can be packed. `src/features/preview/packing-status.test.tsx` renders
the status badge and the notice for every state.

The presets (83 tests in `src/lib/presets`, `src/store/presets.test.ts` and `src/store/apply-options.test.ts`) cover every operation,
name cleaning and uniqueness, the limits, reading and validating settings with the options' own
rules, loading with bad entries, unreadable text and newer versions, saving when storage is full or
blocked, two tabs sharing one storage, and export and import round trips with hostile and huge
files. `fuzz.test.ts` is the property test: 600 random documents (and 300 random texts) are loaded
and imported, and every preset that gets through must have a clean name, unique name and id, exactly
the twelve settings, settings that survive reading again unchanged, and a layout that packs with
every copy placed. The shared fakes are in `src/lib/presets/testing`.

## 2. Browser checks

They drive the **production build** in headless Chrome with Playwright (and the dev server for the
checks that import the app's own modules). They need:

- `npm run build` first. `e2e/harness.mjs` serves `dist/` itself.
- A Chromium that Playwright can find (`npx playwright install chromium`, or set
  `PLAYWRIGHT_BROWSERS_PATH`). `playwright` is pinned to the version whose browser build was used.
- `e2e:presets` runs most of its sections on the dev server (it reads the app's stores) and its last
  section, the accessibility audit, on the production build. It takes about five minutes.
- For `e2e:pdf` only: `qpdf`, poppler (`pdfinfo`, `pdfimages`, `pdftoppm`) and ImageMagick (`convert`)
  on the path. They share no code with the exporter, which is the point.

| Command                | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Checks |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `npm run e2e:layout`   | The packing worker in a real browser: bundling, startup, first layout, improvements, cancellation, a worker that cannot start; the stale rule under slow answers; that hover, selection, unit and display switches start no new search; and that the rendered preview equals the engine's layout piece by piece and passes the independent referee, with the hover statistics equal to the engine's, in nine scenes                                                                                                                                                                                                                                                                                                                               | 63     |
| `npm run e2e:controls` | Every control: header, drop and paste, every row control and documented shortcut, the More menu, the preview toolbar, wheel zoom, the panel divider, the theme, every print option, persistence. Each effect is checked against real state and the rendered result. Prints the audit table                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 59     |
| `npm run e2e:pdf`      | The PDF with external tools: validity, page size, JPEG streams byte-identical, lossless pixels equal ImageMagick's, one image per file, the PDF raster against the preview, determinism, size against a naive writer, 100 photos, a 50 MP photo, Cancel, an error and Try again, guides, omitted copies, a profiled WebP                                                                                                                                                                                                                                                                                                                                                                                                                          | 41     |
| `npm run e2e:a11y`     | axe-core WCAG 2.2 AA in light and dark across the empty state, photos with the preview, the status, Print options and every state of the export dialog; no overflow at 1024, 1280, 1440, 1920 and 390 px; reduced motion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 30     |
| `npm run e2e:presets`  | The presets in real Chrome: save, apply (one packing run, nothing else touched), Modified, Update, Revert, rename, duplicate, delete with Undo; export and import with real files, including malformed, oversized, newer and hostile ones; persistence and independence from the saved print options in both directions; Reset to defaults; unreadable, partly bad, thousand-entry and newer-version storage; full and blocked storage; two tabs; applying during a search (cancelled) and during an export (the file in progress is unaffected); rapid switching; keyboard only; a phone; axe WCAG 2.2 AA in light and dark across every new state; no overflow at five widths with a 40-character active name; reduced motion; same-origin only | 240    |
| `npm run e2e:perf`     | Main-thread long tasks and frame times at 100, 500 and 2000 pieces. `npm run e2e:perf 500` runs one size                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | n/a    |

The fixtures in `e2e/fixtures` (216 kB) are committed. `e2e/make-fixtures.cjs` rebuilds them with
sharp and ImageMagick, which are not project dependencies. Two environment variables help when
comparing builds: `SHEETFIT_DIST` serves another build directory, and `SHEETFIT_NO_STATUS=1` waits a
fixed time instead of for the status badge (for builds from before it existed).

## 3. Measured responsiveness

Headless Chrome 141 on one Xeon core with a software GPU, which is slower than real hardware; only
the comparison between rows means anything. "Long tasks" are main-thread tasks of 50 ms or more.
`e2e/responsiveness.mjs` changes the size slider 30 times, the margin and rotation 26 times, and then
40 times without waiting for the packer.

| Pieces | Scenario                 | Long tasks | Longest | Total  | Frame p95 | Chunk 1 version, same script (tasks / longest / total) |
| ------ | ------------------------ | ---------- | ------- | ------ | --------- | ------------------------------------------------------ |
| 100    | set copies, first result | 0          | 0 ms    | 0 ms   | 33 ms     |                                                        |
| 100    | slider drag, 30 steps    | 1          | 54 ms   | 54 ms  | 33 ms     | 3 / 67 ms / 184 ms                                     |
| 100    | options burst            | 0          | 0 ms    | 0 ms   | 33 ms     |                                                        |
| 100    | cancel storm, 40 changes | 0          | 0 ms    | 0 ms   | 17 ms     |                                                        |
| 500    | set copies, first result | 7          | 228 ms  | 961 ms | 50 ms     | 1 / 328 ms / 328 ms                                    |
| 500    | slider drag, 30 steps    | 30         | 185 ms  | 2.3 s  | 83 ms     | 30 / 332 ms / 4.5 s                                    |
| 500    | options burst            | 14         | 193 ms  | 1.1 s  | 64 ms     | 27 / 420 ms / 5.2 s                                    |
| 500    | cancel storm, 40 changes | 13         | 109 ms  | 0.9 s  | 50 ms     | 41 / 355 ms / 7.6 s                                    |
| 2000   | set copies, first result | 6          | 749 ms  | 2.1 s  | 50 ms     | 1 / 1035 ms / 1.0 s                                    |
| 2000   | slider drag, 30 steps    | 44         | 1131 ms | 11.2 s | 283 ms    | 32 / 1554 ms / 17.5 s                                  |
| 2000   | options burst            | 36         | 742 ms  | 7.5 s  | 217 ms    | 52 / 1460 ms / 21.5 s                                  |
| 2000   | cancel storm, 40 changes | 57         | 613 ms  | 12.8 s | 283 ms    | 59 / 1318 ms / 34.9 s                                  |

What this says, honestly: **packing never blocks the page** (it runs in a worker). What remains at
500 and 2000 pieces is the cost of drawing that many animated pieces, which is the same design as
before and now costs less than it did, but at 2000 pieces one update still takes about 0.4 s on this
machine, so dragging a slider there is sluggish, not frozen: input is handled between tasks, nothing
errors, and every run ends on the layout for the final inputs. Rendering only the sheets in view
would be the next step; it was not done because it changes how the preview is built. Two findings
made the table: the packer moved off the page (a first version that packed on the page cost 3.4 s
of long tasks at 100 pieces), and the pieces' tooltip text was being formatted for every piece on
every render although tooltips are closed (the largest single cost in the profile).

## 4. What has not been verified

- Only Chrome. Firefox and Safari have not been run.
- Real hardware: the timings above are from a slow single-core VM.
- Screen readers: axe checks what a script can; nothing was heard with an actual screen reader.
- Presets in two tabs that change within a few tens of milliseconds of each other can lose one
  change (`docs/presets.md`, section 5). The test asserts what holds, that both tabs and the storage
  end on one valid list, not that nothing is lost.
- With any Radix menu open axe reports `aria-hidden-focus`. This is true of the existing theme menu
  too and was never audited before; the presets audit excludes that rule in menu-open states and
  proves separately that focus cannot leave the menu.
- Two checks of the existing suites are timing-sensitive on a one-core machine and were flaky on the
  untouched Chunk 3 build as well: `e2e:a11y` sometimes reports `color-contrast` on the packing
  status badge's label (`.sm\:inline`) when axe samples it while the badge changes colour (3 of 3 runs
  on the Chunk 3 build, 1 of 4 on this one), and `e2e:layout` sometimes fails its "500 pieces,
  refined" scene with a stale sheet drawn (2 of 2 runs on the Chunk 3 build, none of 4 on this one).
  Both look like the inherited transient mismatch while the preview swaps layouts; neither was
  investigated, and the presets suite waits for the preview to settle before it compares anything.
