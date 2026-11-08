# Sheetfit packing engine

A standalone, tested engine that packs copies of photos onto sheets. It is plain TypeScript with no
runtime dependency, imports nothing from React, the DOM or the app store, and runs in Node, in the
browser and in a Web Worker. The app runs it in a worker and shows what it finds; the
[integration guide](#10-integration-guide) says how, and what that taught.

Everything here was measured on one machine (Node 22, a single 2.8 GHz Xeon core, no GPU). Numbers
from another machine will differ; the comparisons between methods are the part to trust.

- [1. What it delivers](#1-what-it-delivers)
- [2. The Contract](#2-the-contract)
- [3. The objective](#3-the-objective)
- [4. Public API](#4-public-api)
- [5. How it works](#5-how-it-works)
- [6. Determinism and the time budget](#6-determinism-and-the-time-budget)
- [7. Execution model and worker protocol](#7-execution-model-and-worker-protocol)
- [8. Verification](#8-verification)
- [9. Benchmarks](#9-benchmarks)
- [10. Integration guide](#10-integration-guide)
- [11. Known limitations](#11-known-limitations)

## 1. What it delivers

| Piece       | Where                                       | Job                                                                          |
| ----------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| Fast packer | `packLayout` in `src/packing/pack.ts`       | A good layout in milliseconds, synchronously, same shape as `LayoutFunction` |
| Refinement  | `refineLayout` in `src/packing/refine.ts`   | Keeps improving, reports every strict improvement, can be cancelled          |
| Worker      | `src/packing/worker/`                       | Runs the refinement off the main thread, same interface                      |
| Tests       | `src/packing/*.test.ts`, `worker/*.test.ts` | 102 tests, an independent referee, two independent oracles                   |
| Benchmarks  | `src/packing/bench/`                        | `npm run bench` (timings), `npm run bench:report` (evidence)                 |

The packing problem is two-dimensional rectangle bin packing with rotation into identical bins (the
sheets), with a margin on every edge, a gap between pieces, and two ordering modes. It is NP-hard,
so the engine is a portfolio of constructive methods, an improvement phase, lower bounds that can
prove a result optimal, and an exact solver for small inputs.

## 2. The Contract

This is what the engine promises, derived from the app's code (`src/lib`, `src/store`,
`src/features`) and the product description.

### 2.1 Inputs: everything that can influence a layout

| Input                                      | Where it comes from in the app                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Unit and rounding   | What the engine does                                                                                                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pieces[].width`, `.height`                | `getPrintInfo()` in `src/lib/sizing.ts`: base size (by width, height, longest side or native DPI) times the image's percent (10–300 %) times its pixel size. The percent is clamped by `getMaxPercent()` (rounded down to 0.01 %, and kept a few micrometres under the usable area, see [section 8](#8-verification)) so the piece fits the usable area of the sheet the limit is measured on: the chosen orientation's, or the portrait one for Automatic, upright or turned if rotation is on | millimetres, floats | Uses the effective (clamped) printed size. Rounds to the nearest micrometre; a positive size never becomes 0 (at least 1 µm). Not finite or not positive: unplaceable `invalid-size`. Does not clamp again; a piece that still does not fit is `too-large` |
| `pieces[].id`, `imageId`, `copy`, `copies` | `buildLayoutInput()` in `src/lib/layout-input.ts`: id is `${image.id}:${copy}`, copies are numbered from 1                                                                                                                                                                                                                                                                                                                                                                                      | none                | Never read. The same piece objects are returned, so identity is stable                                                                                                                                                                                     |
| `sheetSize`                                | `getPortraitSize()`: a preset, or a custom size of 30–1500 mm per side; always portrait, shorter side as width                                                                                                                                                                                                                                                                                                                                                                                  | millimetres         | Normalises (shorter side is the portrait width) and caps each side at 10 m                                                                                                                                                                                 |
| `orientation`                              | Print options: portrait, landscape or Automatic. `resolveOrientation()` currently maps Automatic to portrait                                                                                                                                                                                                                                                                                                                                                                                    | none                | Automatic solves both and keeps the better by the objective; ties go to portrait                                                                                                                                                                           |
| `margin`                                   | `getSheetGeometry()`: the stored margin limited by `getMaxMargin()` (at most 50 mm, and at least 10 mm stays usable)                                                                                                                                                                                                                                                                                                                                                                            | millimetres         | Accepts any value. Negative or not a number: 0. No usable area left: every piece is unplaceable `no-usable-area`                                                                                                                                           |
| `gap`                                      | Print options, 0–30 mm. Not clamped by the geometry                                                                                                                                                                                                                                                                                                                                                                                                                                             | millimetres         | Applies between pieces only, never between a piece and the margin. Negative or not a number: 0                                                                                                                                                             |
| `allowRotation`                            | "Allow 90° rotation"                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | none                | A piece may be turned by exactly 90°; `rotated: true` means 90° clockwise, as the preview draws it                                                                                                                                                         |
| `ordering`                                 | "Optimize packing" or "Strict order"                                                                                                                                                                                                                                                                                                                                                                                                                                                            | none                | See [section 5.8](#58-strict-order)                                                                                                                                                                                                                        |

Not inputs: the copy counts (they become pieces; zero copies means no pieces), the base size, DPI,
percent and display unit (all folded into the printed size), and the cut guides, margin outline and
sheet numbers (display and export only).

### 2.2 Outputs the UI reads

- `orientation`, `sheetWidth`, `sheetHeight`, `margin` (millimetres): the sheet frame, the empty
  sheet (so they must be set even when there are no pieces) and the toolbar's sheet row.
- `sheets[]`: `index`; `pieces[]` with `piece` (its `id` is the React key; the tooltip reads
  `imageId`, `copy`, `copies`), `x`, `y`, `width`, `height` in millimetres from the top-left corner
  (the preview turns them into percentages), and `rotated`; and `stats` with `pieceCount`,
  `usableArea`, `usedArea`, `wastedArea`, `fillPercent` (the hover card).
- `sheets.length`: the toolbar count and the empty state when it is 0.
- `status`, `lowerBound`, `unplaceable`, `totals`: the status badge and the notice for copies that fit on no sheet.

### 2.3 Promises the UI makes about layout, and how each is kept

| Promise in the UI                                                                 | How the engine keeps it                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Strict order: "pieces are placed in list order, even when that wastes more paper" | The sheet never goes back along the list, reading order (top to bottom, then left to right) follows the list, copies stay consecutive. Checked by the referee on every strict layout |
| Optimize packing: order is only a tie-break and never costs a sheet               | Geometry is decided without looking at the list. Afterwards interchangeable pieces are dealt to slots in list order, which cannot change a sheet count                               |
| Gap: space between neighbouring photos, "zero packs photos edge to edge"          | Pieces and the usable area are both inflated by the gap, so the gap exists between pieces and never against the margin; the real distance is verified                                |
| Margin: "nothing is placed inside this border"                                    | Every piece lies inside the margins, verified                                                                                                                                        |
| Rotation: turned photos fit tighter, orientation is irrelevant once cut           | Pieces are only translated and turned by exactly 90°; never scaled, cropped or distorted                                                                                             |
| Automatic orientation: "uses portrait or landscape, whichever needs fewer sheets" | Both orientations are solved and compared, see [5.9](#59-automatic-orientation). The size limit stays that of the portrait sheet, so every size shown fits whichever is chosen       |
| The size you see is the size that prints                                          | The engine takes the displayed (clamped) size as it is                                                                                                                               |

### 2.4 Edge conditions the UI can produce, and the behaviour

Zero copies, no images: no sheets, sheet size still reported, status optimal. One piece. A piece
exactly the usable size: fits. A piece one micron too big: `too-large`. Tiny pieces (at least one
micrometre) and huge ones. Extreme aspect ratios. Extreme sliders: margin up to nearly the whole
sheet, gap larger than the pieces. A sheet with no usable area: nothing crashes, every piece is
listed as unplaceable with its reason. Non-finite or negative numbers anywhere: treated as invalid
size, zero margin or zero gap, never a crash. In the real app the UI's size limit keeps every piece
on the sheet, so nothing is ever unplaceable. That is tested on random legal app states, on
explicitly landscape sheets with rotation off, and on 4000 sizes that sit within a micrometre of the
limit, which is where an off-by-one-micrometre defect was found ([section 8](#8-verification)); the
list exists for every other caller, and for settings that were saved by hand.

### 2.5 What the shared types cannot express

`src/lib/layout-types.ts` was extended with `status`, `lowerBound`, `unplaceable` and `totals` (all
required once the first version's shelf layout, which did not fill them, was gone), and the supporting types `LayoutStatus`,
`UnplaceablePiece`, `UnplaceableReason` and `LayoutTotals`. Three needs fall outside what the types
can say:

1. **Time.** A layout is a value. Refinement is a separate API (`refineLayout`, and the same
   interface through the worker client).
2. **Run state.** "Optimizing…" is a property of a running refinement, not of a layout, so it
   lives in the hook that calls the engine.
3. **Stable identity across updates** is a convention (same objects, same order), not a type. It is
   kept and tested.

## 3. The objective

In this lexicographic order:

1. **Fewest sheets.** Pieces that cannot be placed are counted first when comparing orientations.
2. **Fullest sheets except the last.** The total area is fixed, so this means the emptiest sheet is
   as empty as possible. It is the second figure the search minimises, and the output puts that
   sheet last.
3. **Compact toward the top-left, free space in large regions.** Achieved by deterministic
   post-processing (every piece slides up and left until nothing moves, so free space collects at
   the bottom and right) and by rules that prefer the top-left. It is **not** a searched figure: a
   searched compactness score would make nearly every step an "improvement" and flood the UI.
4. **List order as tie-break (Optimize mode).** Sheets other than the last are ordered by the first
   list item they hold, and interchangeable pieces are dealt to slots in reading order and list
   order, so copies of an image stay together and earlier images take earlier slots.
5. **Deterministic** for identical input ([section 6](#6-determinism-and-the-time-budget)).

`status: 'optimal'` means the **sheet count** is proven to be the fewest possible. The tie-breaks in
2 to 4 are best effort and carry no proof.

## 4. Public API

```ts
// src/packing/index.ts
packLayout(input: LayoutInput, options?: PackOptions): LayoutResult
refineLayout(input: LayoutInput, options?: RefineOptions): Promise<RefineSummary>
REFINEMENT_BUDGET_MS = 3000

// src/packing/worker/client.ts: import it separately so the worker is only bundled where used
createWorkerRefiner(createWorker?: () => WorkerLike): {
  refine: RefineFunction
  resume: (options?: ResumeOptions) => Promise<RefineSummary>   // continue the latest run if it stopped at its time limit
  terminate: () => void
}

interface PackOptions   { seed?: number; exactLimit?: number }
interface RefineOptions extends PackOptions {
  signal?: AbortSignal
  budgetMs?: number          // wall clock; default REFINEMENT_BUDGET_MS
  maxSteps?: number          // deterministic budget; wins over budgetMs when set
  onFirst?: (layout: LayoutResult) => void        // once, first: the packLayout result
  onImprovement?: (layout: LayoutResult) => void
}
interface RefineSummary { layout: LayoutResult | null; steps: number; elapsedMs: number; aborted: boolean; stopped: StopReason }
type StopReason = 'finished' | 'time-limit' | 'step-limit' | 'aborted'
type RefineFunction = (input: LayoutInput, options?: RefineOptions) => Promise<RefineSummary>
```

- `packLayout` never reads the clock and always returns the same layout for the same input.
- `refineLayout` and the worker's `refine` have the **same signature**. `onFirst` is called once,
  before anything else, with the layout `packLayout` returns (so a caller can leave `packLayout`
  off its own thread entirely); it is not called for a run that is already aborted. `onImprovement`
  is called for every layout that is strictly better than the one before (fewer sheets, or the
  same sheets with a less full emptiest sheet) and once more, with unchanged geometry, when the
  layout is _proven optimal_, so the badge can change. It is never called for the layout
  `packLayout` returned, and never after an abort.
- The promise resolves when the budget is spent, the layout is proven optimal, or the run is
  aborted. `layout` is the last layout reported (or the `packLayout` result when nothing improved).
  It is `null` only when aborted before anything was reported.
- `exactLimit` (default 9) is the largest piece count the exact solver takes; 0 turns it off, which
  is how the tests measure the heuristics alone. It is capped at 20.
- `seed` seeds every random choice (default a fixed constant).

## 5. How it works

### 5.1 Integer units and the gap

Everything inside is a whole number of micrometres (µm). Sizes are rounded to the nearest µm, far
below what a printer resolves, so no floating-point drift can create an overlap or a spurious
"does not fit": four 105 × 148.5 mm pieces tile an A4 sheet at zero margin and gap, exactly.

The gap is handled by **inflation**: every piece grows by the gap on its right and bottom, and the
usable area grows by the gap too. That is an equivalent problem with no gap, in which a piece may
touch the margin line. The validator checks the real minimum distance on the result. The guarantee
is in integer micrometres; against the real-valued inputs the distance can differ by under 1 µm.

### 5.2 Interchangeable classes and slot dealing

Pieces whose sides are equal (up to a 90° turn when rotation is allowed) form a **class**. The
algorithms place classes and produce _slots_; they never see ids. A final step deals the class's
real pieces to its slots in reading order and list order. This is why list order is free in
Optimize mode, and why copies of one image stay together.

### 5.3 Lower bounds

All four work on the inflated problem and charge a piece its cheapest orientation, so they hold
with rotation. The result is the largest of them.

- **Area.** The sheets must hold the total area.
- **Line.** A horizontal line through a sheet crosses pieces whose widths add up to a sum of piece
  sides that fits the width, and that sum can be well below the width (sides of 35 and 45 mm fit at
  most 195 mm into 200 mm). So one sheet holds at most `min(height × best width sum, width × best
height sum)` of area. For 35 × 45 mm photos on A4 this caps a sheet at 35 pieces, not 36, and
  proves 15 sheets optimal for 500 of them.
- **Clique.** Pieces that pairwise cannot share a sheet (no orientation puts two of them side by
  side or one above the other) each need their own.
- **Dual feasible functions** (Fekete and Schepers): conservative scales and threshold functions
  applied to both sides turn each piece into a "volume" that no sheet can exceed.

The bounds are checked against brute force: on 1200 tiny instances none ever exceeded the true
optimum, and more than 80 of them were beyond plain area, so the stronger bounds were exercised.

### 5.4 The constructive portfolio

| Method                                               | What it is                                                                                                                                                                                                                           | When it wins                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| MaxRects, five rules                                 | Maximal free rectangles. Best short side, best long side, best area, top-left, contact point. Each piece goes to the best position across **all open sheets**, either orientation                                                    | Mixed sizes with no dominant type                                                                                                                   |
| Skyline (top-left, minimum waste)                    | A profile of occupied depth per column span                                                                                                                                                                                          | Rarely; kept in the refinement                                                                                                                      |
| Guillotine (best area, shorter or longer axis split) | Free space is always disjoint rectangles; every placement leaves one straight cut                                                                                                                                                    | Sets that suit straight cuts                                                                                                                        |
| Block patterns                                       | Dynamic program over sub-rectangles whose sides are sums of piece sides: grids of one type in either orientation joined by straight cuts, and for one type the five-block pinwheel                                                   | Identical pieces: finds the 2 × 2 tiling that greedy placement misses; the pinwheel reaches 28 pieces of 3 × 2 in 13 × 13 where cuts alone reach 27 |
| Greedy patterns                                      | Use a dense pattern on every sheet the demand covers, then place the rest into the holes. A pattern must cover at least 90 % of a sheet, or it would use up the small pieces that fill holes                                         | Few types with many copies                                                                                                                          |
| Cutting stock (column generation)                    | A master problem chooses how many sheets use each pattern; its dual prices become piece values for the block search, which generates the next pattern (Gilmore and Gomory). Whole-sheet multiples are taken, the remainder is packed | **Many copies of a few types**: the largest single gain, see [section 9.3](#93-what-each-ingredient-buys)                                           |

The block search is exact over the raster of piece-side sums. When that is too large it falls back
to sums of multiples of single sides, and gives up (returning nothing) past a work limit, so it can
never stall. Cutting stock runs for up to 12 types.

The synchronous `packLayout` runs a small fixed set chosen from the instance (a single type needs
only the pattern solver; two to twelve types add a cheap cutting-stock plan). The deep set, with
every rule, order and algorithm and the thorough cutting-stock plan, runs in the refinement.
Which methods earn a place in the quick set was **measured**: over 449 instances, counting how often
each was the first-best of those it ran on, the greedy pattern solver won 161 of 404, cutting stock
194 of 268, MaxRects best-long 16 of 286, top-left 17, guillotine 14, skyline 2, and MaxRects
best-short in area order 0 (the
pattern solver reduces to exactly that when no dense pattern applies). The last two were dropped
from the quick set; skyline alone cost about 30 ms of a 115 ms cold first result.

### 5.5 The improvement phase

Each `step` is one deterministic unit of work:

1. the next deep heuristic (the first eight steps, then one in six);
2. the exact solver, once, for small inputs;
3. **ruin and recreate**: empty the emptiest sheet and a few others (chosen several ways), then
   place their pieces again, largest first with noise, into every open sheet, with a random rule
   and sometimes a pinned orientation per type. A move is kept if it is no worse by
   (sheets, emptiest sheet, sum of squared fills); the last term turns a plateau into a slope
   towards emptying a sheet;
4. a **search over type orders and orientation pins** (a mutation of the order, a pin or the rule,
   kept if no worse), with restarts from a shuffled order.

It stops at the lower bound. The longest single step measured was about 107 ms at 500 pieces and
102 ms at 2000 (the thorough cutting-stock plan, in the first deep steps), which bounds how long a
cancel can wait.

### 5.6 The exact solver

For up to nine pieces, when the heuristics have not met the bound: pieces are split over `k`
sheets for `k` from the bound upwards, and what each sheet can hold is decided by a complete search.
That search places pieces in reading order, at tops that are 0 or the bottom of an earlier piece
and at lefts that are sums of piece sides; a stable layout (pushed up and left until it stops
moving) always has this form, so the search is complete. If a node limit is hit, the result is
reported as _not proven_ rather than optimal. It matches brute force on every tiny instance tried.

### 5.7 Compaction, ordering, dealing

After the search, each sheet's pieces slide up, then left, repeatedly. Then the emptiest sheet is
placed last and the rest are ordered by the first list item they hold, and pieces are dealt to
slots (twice, because the sheet order depends on the dealing). None of this changes which pieces
share a sheet, so none of it can cost a sheet.

### 5.8 Strict order

The contract is the list. Under it, the engine searches **order-preserving shelf layouts**:
consecutive pieces form a shelf (a row of top-aligned pieces, left to right), consecutive shelves
stack down a sheet, and the next sheet starts when a shelf no longer fits. A dynamic program
chooses every shelf break and every piece's rotation. After each prefix of the list the state is
(sheets opened, height used on the last sheet), compared lexicographically; that is a valid
dominance because a sheet can always be closed to reach (sheets + 1, 0). So within the family the
result is **exact**, which the tests confirm against an independent exhaustive search on 300 small
lists, on sheet count and on last-sheet height.

Why this family: reading order is "top to bottom, then left to right" by top edge, so a piece that
shares a row with its predecessor must share its top edge. Layouts outside the family exist (a
piece may sit below and to the left of an earlier one and still read later), so this is the best
shelf layout, not a proof of the best strict-order layout. A result is called optimal only when
its sheet count equals the general lower bound.

### 5.9 Automatic orientation

Both orientations are solved and compared by (pieces unplaceable, sheets, emptiest sheet). Ties go
to portrait. An orientation is skipped once its bound shows it cannot beat the other.

## 6. Determinism and the time budget

- `packLayout` is a pure function of its input: no clock, no `Math.random`, a seeded generator
  (mulberry32) for everything random. Layouts are identical across runs, which the fuzz run checks
  on 2000 instances.
- Refinement is a **sequence of steps**, and every step is deterministic. The clock decides only
  how many steps run. So: same input, same seed and same `maxSteps` give the same layout on any
  machine. With the wall-clock budget (`budgetMs`, default `REFINEMENT_BUDGET_MS` = 3000 ms) a faster
  machine simply runs more steps and can reach a better layout, never a worse one.
- The orientations are worked on in a fixed order, and the default seed is a constant, shifted for
  landscape.

## 7. Execution model and worker protocol

`refineLayout` works in slices of about 8 ms and yields between them through a `MessageChannel`
(nested `setTimeout` is clamped to 4 ms in browsers). It checks the abort signal between steps and
never publishes after an abort.

The worker is created the way Vite expects, so it is bundled as its own chunk (31.9 kB minified,
11.7 kB gzipped):

```ts
new Worker(new URL('./packing.worker.ts', import.meta.url), { type: 'module' })
```

| Direction   | Message                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| to worker   | `{ type: 'run', id, input, limits }` where `input` carries only sizes and settings                                                      |
| to worker   | `{ type: 'cancel', id }`                                                                                                                |
| from worker | `{ type: 'first', id, layout }`, `{ type: 'improved', id, layout }`, `{ type: 'done', id, summary }`, `{ type: 'failed', id, message }` |

- **Slim input.** The engine reads only each piece's width and height, so only those cross.
- **Packed output.** Layouts come back as plain numbers naming pieces by list index. The client
  rebuilds a `LayoutResult` around the caller's own `PieceSpec` objects, so identity is stable by
  construction.
- **Stale runs.** Starting a run cancels the one before it in the host; a cancelled run posts no
  improvements; the client drops anything whose id is not current, and removes its own listener on
  abort. A crashed or terminated worker rejects the running calls.
- **Separation.** `host.ts` holds the behaviour with the messaging removed, so it is tested in
  plain Node.

## 8. Verification

```sh
npm test                 # all tests, the engine's about 40 s
npm run bench            # first-result timings (vitest bench mode)
npm run bench:report     # the evidence below; a few minutes
```

An **independent referee** (`testing/validate.ts`) shares no code with the packer. It checks, on
every layout: every piece appears exactly once (placed, or unplaceable with a reason it re-derives),
as the same object; nothing overlaps; everything lies inside the margins; the gap holds as a real
minimum distance; sizes and aspect ratios are preserved; rotation only when allowed and only by
90°; sheet indices and per-sheet pieces in list order; used + wasted = usable; totals are sums;
the claimed bound is not above the sheet count; and the strict contract.

Two **independent oracles**: a cell-scanning brute-force packer for tiny integer instances
(`testing/bruteforce.ts`) and an exhaustive shelf search (`testing/shelves.ts`).

| Check                                                                                                                                                                                   | Result                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seeded fuzz, synchronous: sheets A0–A6 to custom, all orientations, margins, gaps, strict and optimize                                                                                  | 2000 instances, 0 violations, identical on a second run                                                                                               |
| Seeded fuzz, refinement: every published layout valid, strictly better, final equals last published, deterministic, strict never "improved"                                             | 300 instances, 0 violations                                                                                                                           |
| Bounds against brute force                                                                                                                                                              | 1200 tiny instances, never above the optimum; over 80 of them beyond plain area. In a separate 1500-instance run the optimum exceeded the bound in 84 |
| Exact solver against brute force                                                                                                                                                        | about 600 instances, optimum found and proven on all                                                                                                  |
| Heuristics alone (exact solver off) against brute force                                                                                                                                 | optimum on at least 97 % (a regression guard; a 1500-instance run had no misses)                                                                      |
| `optimal` never wrong                                                                                                                                                                   | 400 instances                                                                                                                                         |
| Strict order DP against an exhaustive search of the same family                                                                                                                         | 300 lists, sheets and last-sheet height identical                                                                                                     |
| Block patterns against brute force                                                                                                                                                      | valid on every case, optimal on at least 90 % (guillotine plus pinwheel is a heuristic)                                                               |
| Cutting-stock master                                                                                                                                                                    | a certificate (primal feasible, dual feasible, equal objectives) on 200 random problems                                                               |
| Worker client and host over real structured-clone message ports                                                                                                                         | identical layouts to in-thread; abort, replacement, crash, terminate                                                                                  |
| The app's own sizing functions, 250 random legal app states                                                                                                                             | every piece placed, none unplaceable                                                                                                                  |
| Adversarial: 2000 distinct sizes, 9990 pieces (ten images of 999 copies), 600 one-per-sheet pieces, sizes spanning six orders of magnitude, invalid numbers, a sheet beyond the maximum | all valid, all within their time bounds                                                                                                               |

**Defects the tests found and that were fixed** (they are the reason these tests exist):

1. Four 105 × 148.5 mm pieces on an A4 sheet used two sheets: greedy placement picks the
   landscape orientation first. Fixed by the block pattern solver.
2. On mixed sets the pattern solver used 259 sheets against 224 for plain MaxRects: dense patterns
   for awkward types swallowed the small pieces that fill holes. Fixed by a minimum fill.
3. The lower bound took 742 ms for 1400 types (allocation inside a clique loop). Fixed.
4. The exact solver proved a layout optimal, but the proof was not reflected unless the sheet
   count changed. Found by the brute-force comparison. Fixed, and the proof is now published.
5. After the last reported improvement the search kept accepting equal moves, so the final layout
   differed from the last one published. Fixed: the published layout is kept explicitly.
6. My own tests contained two wrong assertions (a mean of identical sheets cannot differ from a
   ratio of sums; a brute-force oracle too slow for its instances); the engine was right both times.
7. _Found while integrating._ The packer rounds the sheet, the margin and every piece to whole
   micrometres, each by up to half of one. The app's size limit (`getMaxPercent()`, rounded down to
   0.01 %) could leave a piece less than a micrometre under the usable width, and after rounding
   the piece was one micrometre too wide: `too-large`, although the preview showed it fitting. About
   one limited piece in thirty was within reach of this, so it was reachable in normal use (any
   photo pushed to 300 %). The engine is right (one micron too big is too big); the app's limit now
   keeps `PACKER_SLACK_MM` (3 µm) under the usable area. Regression tests: 120 landscape and
   automatic trials with rotation off, and 4000 native-DPI sizes on A3. Both fail without the fix.
   The earlier claim of "250 random legal states, none unplaceable" did not reach this case, because
   random percentages rarely land that close to the limit.

**The worker in a real browser** (not possible when the engine was built) is verified by
`e2e/layout.mjs` against headless Chrome: the module worker bundles and starts, sends a first
layout, improvements and done, cancellations arrive (49 of 51 runs cancelled in a storm of changes),
a worker that cannot start leaves the page packing on its own thread, and the layout drawn equals
the layout the engine sent, piece by piece, and passes the referee. See
[testing.md](testing.md).

## 9. Benchmarks

### 9.1 Environment and method

Node 22, one logical core of an Intel Xeon at 2.8 GHz, no GPU. Run through vitest, whose module
runner adds some overhead (its own warning says so); in plain Node the warm timings were within
about 25 %. Each row runs the synchronous packer, then the refinement with the production budget of
3000 ms, and every layout is checked by the referee before it is printed. "Gap" is sheets minus the
proven lower bound. **The bound is often loose**, so a gap is an upper limit on how far from the
optimum a result can be, not a measured distance to it. "Sorted shelf" is first-fit decreasing
height, run with both orientation conventions and the better kept; "Chunk 1 shelf" is the
layout the first version of the app showed before the packer existed (pieces in list order, left to
right, a new row when one does not fit), kept as `chunk1Shelf` in `src/packing/bench/baselines.ts`.

The families: five photo sets (ID photos 35 × 45 mm, passport 2 × 2 inch, 4 × 6 and 5 × 7 inch
prints, wallets 2.5 × 3.5 inch, a mixed event set) plus the mixed set again with a 2 mm gap and
Automatic orientation, Martello-Vigo and Berkey-Wang classes I, III, V, VI, VII, VIII, IX, X (one piece per
image, bin sizes scaled to millimetres, margin 0) and a perfect packing built by cutting each sheet
recursively into 20 rectangles (so the optimum is known). The first-result column carries JIT
warm-up in the first rows of each group; cold and warm figures are in [9.2](#92-first-result-time).

### 9.2 First result time

| Measure                                                            | Result                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| Cold, first call in a fresh process, 500 mixed pieces (plain Node) | 109–125 ms                                            |
| The same under vitest                                              | 132–168 ms                                            |
| Warm, about 500 pieces, mean over the 15 families                  | 0.8–14.3 ms (slowest: mixed set, 2 mm gap, Automatic) |
| Warm, about 2000 pieces, mean over the 15 families                 | 3.2–132 ms (slowest: Martello-Vigo class V)           |
| Longest single refinement step                                     | about 107 ms at 500 pieces, 102 ms at 2000            |

The target was about 100 ms for 500 pieces on a cold start and acceptable up to 2000. Cold it is a
little over, warm it is 10 times under, and the first result of a drag after the first is warm.

### 9.3 What each ingredient buys

Sheets from each method on its own, portrait (`npm run bench:report`, last section):

| Instance                              | MaxRects best short side | Best of 5 generic | Greedy patterns | Cutting stock (quick) | `packLayout` |
| ------------------------------------- | -----------------------: | ----------------: | --------------: | --------------------: | -----------: |
| mixed event set, 501 pieces           |                       57 |                57 |              57 |                    53 |           53 |
| mixed event set, 2 mm gap, Auto, 501  |                       57 |                57 |              57 |                    55 |           55 |
| ID photos 35 × 45, 500                |                       16 |                16 |              15 |                    15 |           15 |
| mixed event set, 2000 pieces          |                      224 |               224 |             224 |                   208 |          208 |
| mixed event set, 2 mm gap, Auto, 2000 |                      227 |               227 |             227 |                   219 |          217 |
| ID photos 35 × 45, 2000               |                       63 |                63 |              59 |                    59 |           59 |

On the 2000-piece mixed set: generic heuristics 224, cutting stock 208, after refinement 201.

### 9.4 Results

Sheets, the proven lower bound, fill, timings and baselines for about 100, 500 and 2000 pieces.
"Fill % (all but last)" is the fill of every sheet except the emptiest. "Final ms" is the whole
refinement (it stops early when the layout is proven optimal) and the figure in brackets is when
the last improvement arrived.

**About 100 pieces**

| family                                  | pieces | sheets | lower bound |        gap | fill % | fill % (all but last) | first result ms | final ms (last improvement) | status     | sorted shelf | Chunk 1 shelf |
| --------------------------------------- | -----: | -----: | ----------: | ---------: | -----: | --------------------: | --------------: | --------------------------: | ---------- | -----------: | ------------: |
| photos: ID photos 35x45                 |    100 |      3 |           3 |  0 (0.0 %) |   91.5 |                  93.3 |              19 |                       6 (0) | optimal    |            4 |             4 |
| photos: passport 2x2 inch               |    100 |      7 |           7 |  0 (0.0 %) |   64.2 |                  67.4 |               7 |                       5 (0) | optimal    |            7 |             7 |
| photos: prints 4x6 and 5x7 inch         |    100 |     50 |          50 |  0 (0.0 %) |   64.3 |                  64.5 |               2 |                       1 (0) | optimal    |           50 |            71 |
| photos: wallets 2.5x3.5 inch            |    100 |     12 |          12 |  0 (0.0 %) |   82.0 |                  88.5 |               3 |                       3 (0) | optimal    |           12 |            12 |
| photos: mixed event set                 |    100 |     10 |          10 |  0 (0.0 %) |   93.6 |                  94.2 |              54 |                   237 (237) | optimal    |           12 |            17 |
| photos: mixed event set, 2 mm gap, auto |    100 |     11 |          10 | 1 (10.0 %) |   85.1 |                  91.6 |              97 |                 3000 (2784) | best-found |           12 |            17 |
| Martello-Vigo class I                   |    100 |     26 |          26 |  0 (0.0 %) |   97.6 |                  98.3 |              10 |                     33 (33) | optimal    |           30 |            42 |
| Martello-Vigo class III                 |    100 |     21 |          20 |  1 (5.0 %) |   94.0 |                  97.2 |              44 |                 3000 (2124) | best-found |           25 |            35 |
| Martello-Vigo class V                   |    100 |     21 |          21 |  0 (0.0 %) |   96.3 |                  96.7 |              39 |                     23 (23) | optimal    |           24 |            36 |
| Martello-Vigo class VI                  |    100 |      4 |           4 |  0 (0.0 %) |   75.5 |                  96.1 |              14 |                      10 (0) | optimal    |            4 |             6 |
| Martello-Vigo class VII                 |    100 |     25 |          24 |  1 (4.2 %) |   95.5 |                  96.7 |              11 |                 3000 (1758) | best-found |           29 |            40 |
| Martello-Vigo class VIII                |    100 |     24 |          23 |  1 (4.3 %) |   93.2 |                  97.0 |               6 |                 3000 (1920) | best-found |           27 |            34 |
| Martello-Vigo class IX                  |    100 |     71 |          71 |  0 (0.0 %) |   64.4 |                  64.9 |              13 |                      13 (0) | optimal    |           71 |            76 |
| Martello-Vigo class X                   |    100 |     13 |          13 |  0 (0.0 %) |   95.0 |                  95.7 |              15 |                       8 (0) | optimal    |           14 |            24 |
| perfect packing (recursive cuts)        |    100 |      6 |           5 | 1 (20.0 %) |   83.3 |                  99.4 |              23 |                 3000 (2886) | best-found |            6 |            11 |

**About 500 pieces**

| family                                  | pieces | sheets | lower bound |       gap | fill % | fill % (all but last) | first result ms | final ms (last improvement) | status     | sorted shelf | Chunk 1 shelf |
| --------------------------------------- | -----: | -----: | ----------: | --------: | -----: | --------------------: | --------------: | --------------------------: | ---------- | -----------: | ------------: |
| photos: ID photos 35x45                 |    500 |     15 |          15 | 0 (0.0 %) |   91.5 |                  93.3 |               1 |                       1 (0) | optimal    |           16 |            17 |
| photos: passport 2x2 inch               |    500 |     34 |          34 | 0 (0.0 %) |   66.1 |                  67.4 |               1 |                       1 (0) | optimal    |           34 |            34 |
| photos: prints 4x6 and 5x7 inch         |    500 |    250 |         250 | 0 (0.0 %) |   64.2 |                  64.3 |               5 |                       1 (0) | optimal    |          250 |           354 |
| photos: wallets 2.5x3.5 inch            |    500 |     56 |          56 | 0 (0.0 %) |   87.8 |                  88.5 |               3 |                       1 (0) | optimal    |           56 |            56 |
| photos: mixed event set                 |    501 |     51 |          48 | 3 (6.3 %) |   92.9 |                  94.1 |               8 |                  3001 (877) | best-found |           60 |            84 |
| photos: mixed event set, 2 mm gap, auto |    501 |     52 |          49 | 3 (6.1 %) |   91.1 |                  91.4 |              30 |                 3000 (1632) | best-found |           61 |            84 |
| Martello-Vigo class I                   |    500 |    157 |         157 | 0 (0.0 %) |   97.0 |                  97.4 |               3 |                       4 (0) | optimal    |          173 |           242 |
| Martello-Vigo class III                 |    500 |    105 |         103 | 2 (1.9 %) |   97.8 |                  98.6 |              12 |                 3001 (1844) | best-found |          129 |           189 |
| Martello-Vigo class V                   |    500 |    133 |         130 | 3 (2.3 %) |   96.5 |                  97.0 |              38 |                 3000 (2376) | best-found |          156 |           221 |
| Martello-Vigo class VI                  |    500 |     15 |          14 | 1 (7.1 %) |   92.7 |                  98.8 |              15 |                 3000 (2538) | best-found |           15 |            27 |
| Martello-Vigo class VII                 |    500 |    112 |         108 | 4 (3.7 %) |   96.2 |                  96.9 |              19 |                 3000 (2901) | best-found |          129 |           180 |
| Martello-Vigo class VIII                |    500 |    121 |         116 | 5 (4.3 %) |   95.7 |                  95.9 |              25 |                 3001 (2584) | best-found |          138 |           178 |
| Martello-Vigo class IX                  |    500 |    363 |         363 | 0 (0.0 %) |   62.8 |                  62.9 |               9 |                      15 (0) | optimal    |          363 |           390 |
| Martello-Vigo class X                   |    500 |     73 |          72 | 1 (1.4 %) |   97.8 |                  98.8 |              13 |                 3001 (1292) | best-found |           80 |           129 |
| perfect packing (recursive cuts)        |    500 |     26 |          25 | 1 (4.0 %) |   96.2 |                 100.0 |              14 |                  3000 (238) | best-found |           27 |            47 |

**About 2000 pieces**

| family                                  | pieces | sheets | lower bound |        gap | fill % | fill % (all but last) | first result ms | final ms (last improvement) | status     | sorted shelf | Chunk 1 shelf |
| --------------------------------------- | -----: | -----: | ----------: | ---------: | -----: | --------------------: | --------------: | --------------------------: | ---------- | -----------: | ------------: |
| photos: ID photos 35x45                 |   2000 |     59 |          57 |  2 (3.5 %) |   93.0 |                  93.3 |              46 |                    3000 (0) | best-found |           63 |            67 |
| photos: passport 2x2 inch               |   2000 |    134 |         134 |  0 (0.0 %) |   67.1 |                  67.4 |              57 |                      27 (0) | optimal    |          134 |           134 |
| photos: prints 4x6 and 5x7 inch         |   2000 |   1000 |        1000 |  0 (0.0 %) |   64.2 |                  64.3 |              15 |                      16 (0) | optimal    |         1000 |          1416 |
| photos: wallets 2.5x3.5 inch            |   2000 |    223 |         223 |  0 (0.0 %) |   88.2 |                  88.5 |              29 |                      11 (0) | optimal    |          223 |           223 |
| photos: mixed event set                 |   2000 |    201 |         191 | 10 (5.2 %) |   94.1 |                  94.3 |             134 |                  3012 (845) | best-found |          237 |           334 |
| photos: mixed event set, 2 mm gap, auto |   2000 |    207 |         196 | 11 (5.6 %) |   91.3 |                  91.4 |             193 |                 3012 (1514) | best-found |          244 |           334 |
| Martello-Vigo class I                   |   2000 |    616 |         616 |  0 (0.0 %) |   99.5 |                  99.6 |              40 |                      48 (0) | optimal    |          696 |           965 |
| Martello-Vigo class III                 |   2000 |    420 |         417 |  3 (0.7 %) |   99.3 |                  99.4 |              84 |                 3003 (2688) | best-found |          517 |           770 |
| Martello-Vigo class V                   |   2000 |    524 |         520 |  4 (0.8 %) |   98.2 |                  98.3 |             169 |                 3015 (1616) | best-found |          605 |           883 |
| Martello-Vigo class VI                  |   2000 |     57 |          57 |  0 (0.0 %) |   98.7 |                  99.2 |              65 |                      63 (0) | optimal    |           58 |           106 |
| Martello-Vigo class VII                 |   2000 |    485 |         474 | 11 (2.3 %) |   97.6 |                  97.8 |             116 |                 3013 (2760) | best-found |          560 |           791 |
| Martello-Vigo class VIII                |   2000 |    474 |         464 | 10 (2.2 %) |   97.7 |                  97.9 |             104 |                 3024 (2088) | best-found |          547 |           716 |
| Martello-Vigo class IX                  |   2000 |   1361 |        1361 |  0 (0.0 %) |   64.6 |                  64.6 |             100 |                      95 (0) | optimal    |         1361 |          1514 |
| Martello-Vigo class X                   |   2000 |    300 |         298 |  2 (0.7 %) |   99.2 |                  99.5 |              84 |                 3002 (2043) | best-found |          334 |           530 |
| perfect packing (recursive cuts)        |   2000 |    100 |         100 |  0 (0.0 %) |  100.0 |                 100.0 |              63 |                   517 (517) | optimal    |          103 |           193 |

### 9.5 Reading the results honestly

- Of the 45 cases, **23 are proven optimal**. In the other 22 the engine is within 11 sheets of the
  bound (at worst 7.1 % at 500 pieces and 5.6 % at 2000; at 100 pieces a single extra sheet is
  4 % to 20 %). Because the bounds are loose, some of those results may well be
  optimal already; none is proven.
- In **every one of the 45 cases the engine uses no more sheets than either baseline**. Summed,
  it uses 8028 sheets against 8696 for the sorted shelf (7.7 % fewer) and 11 640 for the Chunk 1
  shelf (31.0 % fewer).
- **Weakest spots.** The recursive-cut packings at 100 and 500 pieces end one sheet above the
  optimum, with every sheet but the last about 99 % to 100 % full: the leftover pieces cannot be
  rearranged into the exact fits the other sheets need. At 2000 pieces the same family is solved
  exactly. A single dominant type can end a little above a loose bound (ID photos: 34 pieces
  fit a sheet and no method found 35; the bound allows 35).
- A single perfect tiling of one sheet (random recursive cuts, 1.5 s of refinement) is recovered in 12
  of 12 trials for 4 to 12 pieces and for 20, and 11 of 12 for 16 and 30, against 3 to 4 of 12 for the
  synchronous pass from 16 pieces up.
- More time rarely helps once the cutting-stock plan has run: the 500-piece mixed set reaches 51
  sheets within 0.5 s and is still at 51 after 3, 12 and 30 seconds, against a bound of 48.

### 9.6 Measured non-improvements

Following the rule that low-level technique stays only where a measurement justifies it:

- **Typed arrays** in the block search tables: 0.61 vs 0.61 ms, 17.3 vs 15.4 ms and 4.15 vs
  4.90 ms (typed vs plain), identical results, no consistent winner. Removed; the engine uses
  plain arrays throughout.
- **Reusing a scratch array** in MaxRects' free-space update: no gain, slightly slower. Not kept.
- **Memoisation and caching**: none beyond what the algorithms are. The subset memo in the exact
  solver, the dynamic-programming tables and the once-per-type pattern are the algorithms
  themselves; no result is cached across calls.

## 10. Integration guide

How the app uses the engine, and why. The guide that came with the engine described a plan; this is
what was built and what measuring it changed.

### 10.1 Where it lives

| File                                  | Role                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/layout-input.ts`             | `buildLayoutInput(images, options)`: one piece per copy, each at the printed size the list and the preview show. Pure, and the tests use it |
| `src/store/packing.ts`                | `usePacking()`: runs the engine in the worker and holds the layout that is on screen                                                        |
| `src/store/layout-context.ts`         | `useSheetLayout()`: the layout on screen, for everything below the provider                                                                 |
| `src/app/layout-provider.tsx`         | Calls `usePacking()` once, above both the desktop and the phone layout (the header exports the layout, and a phone may show only the list)  |
| `src/store/derived.ts`                | `snapshotExportInput(layout)`: what an export contains, frozen when Download PDF is pressed                                                 |
| `src/features/preview/packing-status` | The status badge and the notice for copies that fit on no sheet                                                                             |

### 10.2 The mapping

`buildLayoutInput()` passes the printed sizes as the UI shows them (clamped by `getMaxPercent()`), in
millimetres, the margin and gap from `getSheetGeometry()`, and `allowRotation`, `ordering` and
`orientation` unchanged. The packer rounds everything to micrometres.

### 10.3 The hook, and what measuring changed

`usePacking()` builds the input only from the options that can change a layout (a `useShallow`
selection) and the image list, inside a `useMemo`. Hover, selection, the unit and the preview
switches therefore never rebuild it, and a rebuilt input would restart the search; this is tested in
a real browser (twelve hovers, two selections and four switches start no new search).

The first version of the sketch packed the first layout on the page and refined in the worker.
Measured in headless Chrome on one core with a software GPU, that cost the page 21 ms per slider
step at 100 pieces and 35 to 96 ms at 2000, inside React's render, where it cannot be interrupted;
the long tasks of a 30-step slider drag at 100 pieces went from 184 ms (the first version's shelf layout) to 3438 ms. So
**all packing runs in the worker**: it sends `first` (the `packLayout` result), then improvements,
and the hook shows each as it arrives, inside `startTransition`, so React may drop one that a newer
update has made obsolete. Until the layout for the latest inputs arrives, the previous layout stays
on screen (no debouncing) and `pending` is true; the status badge then says "Optimizing…" and Download
PDF is disabled, because the layout on screen is not for the inputs on screen. The same drag then
cost 357 ms of long tasks (first version: 184 ms).

If the worker cannot run, `refine` rejects, and the hook packs that input once on the page and
settles. That path is tested with a worker that throws on start.

The stale rule is enforced twice: the client drops anything whose run id is not current, and the hook
shows a layout only as the answer for the input it was computed for.

### 10.4 The status

| State                                                   | Badge                             |
| ------------------------------------------------------- | --------------------------------- |
| no answer yet for the latest inputs, or still searching | "Optimizing…"                     |
| `status === 'optimal'`                                  | "Optimal"                         |
| finished with `status === 'best-found'`                 | "Best found"                      |
| stopped at the time limit, not optimal, not exhausted   | "Time limit reached" and Continue |

Strict order never refines (its layout is final), so it goes straight to "Optimal" or "Best found".
A search that stopped because it used up the time limit shows "Time limit reached" with a Continue
button instead of "Best found" ([10.6](#106-the-time-limit-and-continue)).
Copies that fit on no sheet get a warning badge above it ("1 copy does not fit on the sheet"), and
an export says how many it left out.

### 10.5 Pitfalls the handoff listed, and what became of each

1. **Export must use the displayed layout.** Done: the header builds the export from the layout of
   the context, in the click handler, and the dialog works on that snapshot. A layout that arrives
   while the file is written is not applied to it (tested).
2. **Size limit uses portrait.** With an explicitly chosen landscape sheet the limit is measured on
   the landscape sheet, so a tall photo is shrunk to the sheet's short side and is placeable: proven
   by tests with rotation off. With Automatic and rotation off the limit is the portrait one, so
   every size shown fits in whichever orientation the packer picks; a wide photo could be printed
   larger on a landscape sheet, which is what choosing Landscape is for.
3. **Referential stability.** Described in 10.3, and tested in the browser.
4. **Helper text.** Now reads "Uses portrait or landscape, whichever needs fewer sheets."
5. **Download button.** Disabled with no sheets (zero copies, no images, nothing placeable) and while
   the layout is pending.
6. **Stable keys.** Pieces are keyed by `piece.id` inside a sheet, so a piece that moves to another
   sheet is remounted; ids and order inside a sheet are stable, so a piece that stays glides.
7. **Units.** Everything is millimetres, top-left origin, `rotated` meaning 90° clockwise. The PDF
   writer uses `x`, `y`, `width`, `height` directly.
8. **Worker lifecycle.** One refiner per page, created on first use. A failed run falls back to the
   page's own packing for that input.
9. **Bundling.** Only `src/store/packing.ts` imports `@/packing/worker/client`.
10. **Tailwind scans every file.** Words in new folders produced three unused utilities (`collapse`,
    `filter`, `table`). `e2e/` and `src/pdf/` are listed as ignored sources in `src/index.css`.
    The production CSS now differs from before by the two utilities the status spinner needs.

### 10.6 The time limit and Continue

**The setting.** Print options, Layout section: "Packing time limit", whole seconds, **1 to 600**
(10 minutes), step 1, **default 3 s**, which is the `REFINEMENT_BUDGET_MS` the app has always used
(a unit test keeps the two equal). One second is the shortest limit offered: long enough for the
search to do real work on a small job and short enough for quick checks. Ten minutes is a ceiling, so
that a forgotten search cannot keep a worker busy for hours. The benchmarks in [section 9](#9-benchmarks)
were run at 3 s; what a longer limit buys on a particular job is not tabulated here, only that the
search keeps improving while it can and never worsens what is on screen.
It is stored with the other options, validated by
`sanitizeOptions` (rounded, clamped, anything that is not a number becomes the default), and
options saved before it existed load with 3 s without any migration. It is **not** part of a preset
([presets.md](presets.md)). With Strict order it is disabled, because strict order has nothing to
search.

**Which run gets which limit.** The limit is read when a search starts (`timeLimitMs()` in
`src/store/packing.ts`), not followed: it is not part of the packer input, so changing it never
restarts a search and a running search keeps the limit it began with; it applies from the next run
or the next Continue.

**Why a run ended.** `RefineSummary.stopped` says: `finished` (nothing left to try or the layout is
proven optimal), `time-limit`, `step-limit` (only in step-bounded mode) or `aborted`. Only
`time-limit` can be continued.

**Continuing.** The search is already a deterministic state machine (`Packer.step()`), so continuing
is just running it again from where it stopped; nothing is replayed. `Refinement`
(`src/packing/refine.ts`) wraps one `Packer` and can be `run` repeatedly; each run gets a fresh
budget measured from its own start, and reports only layouts that strictly improve on the best so
far, so the layout on screen can never get worse. `refinePacked` is `Refinement` run once and
behaves as before.

**Where the paused search lives.** In the worker (`src/packing/worker/host.ts`). A run that stops at
its time limit leaves its `Refinement` paused there. A `continue` message names the run it continues
(`from`); any request, run or continue, discards what was paused first, so only the latest run can be
continued and a continue for a layout that has since been replaced is answered with a failure and
never touches the new one. A continued run that again stops at the limit is paused again under its own
id, so Continue can be used repeatedly. The paused search keeps the packer's working state in the worker until the
next run replaces it (its size was not measured); nothing is retained in the page. If the worker
crashes or is terminated nothing is left to continue and Continue is no longer offered.

**What the person sees.** `usePacking` tracks a phase for the current inputs (`searching`,
`time-limit`, `done`) and returns `limitReached` and `resume`. `limitReached` is true only when the
layout for the current inputs is on screen, the search stopped at the limit and the layout is not
proven optimal. The status then reads "Time limit reached" with a Continue button; Continue returns
the status to "Optimizing…", moves the keyboard focus to the sheets (the button is gone), and when
the continued search stops at the limit again the button returns.

| Situation                                                | What happens                                                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any input changes (image, copies, size, a layout option) | The search, resumed or not, is cancelled and a fresh one starts with the limit as it is then. While the new layout is pending there is no Continue. |
| The time limit changes                                   | Nothing restarts; the next run or Continue uses the new value.                                                                                      |
| The layout is proven optimal                             | No Continue: there is nothing to find.                                                                                                              |
| Strict order                                             | No search, no Continue.                                                                                                                             |
| Export while stopped or while continuing                 | Uses the layout on screen when the button is pressed, as always.                                                                                    |
| The worker cannot run                                    | The layout is packed on the page and is final; no Continue.                                                                                         |

**Reproducibility.** A wall-clock-limited result depends on how fast the machine is and what else it
is doing, so two runs with the same limit can end differently, and so can a run and its
continuations. The step-bounded mode (`maxSteps`, used by tests and benchmarks, never by the app) is
unchanged and still deterministic, and continuing it is deterministic too: running 250 steps and then
350 more reaches exactly the layout 600 steps reach in one run (`resume.test.ts`).

## 11. Known limitations

- **No proof of optimality in general.** `optimal` is claimed only when the sheet count meets a
  proven bound or the exact solver (up to 9 pieces) completes. Everything else is "best found".
- **Bounds are loose** on mixed sets; the gaps in the results are upper limits.
- **Strict order is best only among shelf layouts** ([5.8](#58-strict-order)).
- **Recursive-cut perfect packings** at 100–500 pieces end one sheet above the optimum.
- **Wall-clock budgets are not reproducible**, and neither are continued runs; use `maxSteps`
  where results must be. The synchronous result always is.
- **Sizes are rounded to a micrometre**, and a sheet side beyond 10 m is capped.
- **Timings in this document are from one single-core machine** under Node. The browser timings
  for the integrated app (long tasks per scenario) are in [testing.md](testing.md).
- **Cutting stock runs for up to 12 types**; beyond that the other methods carry the result.
