import {
  addGenerated,
  open,
  reporter,
  setAllCopies,
  waitForImages,
  waitForSettled,
  watchWorkers,
} from './harness.mjs'

/*
 * Verifies the layout path in real Chrome against the source: the worker (bundling, startup,
 * messages, improvements, cancellation, failure fallback), the stale-result rule, referential
 * stability of the packer input, and that what the preview draws equals the engine's layout.
 * It uses the dev server so the page can import the app's own modules.
 */
const test = reporter('Layout path in a real browser')

const PHOTOS = [
  [600, 400],
  [400, 600],
  [500, 500],
  [800, 300],
  [300, 450],
  [700, 520],
  [450, 450],
  [640, 360],
]
const photoSpecs = (count = PHOTOS.length) =>
  PHOTOS.slice(0, count).map(([width, height], i) => ({ width, height, name: `scene-${i}.jpg` }))

const optionsJson = (options) => JSON.stringify({ state: { options, panelLayout: {} }, version: 1 })

/** Everything a scene check needs, computed inside the page from the app's own modules. */
async function inspect(page) {
  return page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/index.ts')
    const { buildLayoutInput } = await import('/src/lib/layout-input.ts')
    const { toLayoutResult } = await import('/src/packing/result.ts')
    const { packLayout } = await import('/src/packing/index.ts')
    const { validateLayout } = await import('/src/packing/testing/validate.ts')
    const { formatArea, formatNumber, formatSize } = await import('/src/lib/units.ts')
    const { images, options } = useAppStore.getState()
    const input = buildLayoutInput(images, options)

    // The layout on screen is the last one the worker sent for the newest run.
    const messages = window.__packing.received.filter((m) => m.layout)
    const newest = Math.max(...messages.map((m) => m.id))
    const last = messages.filter((m) => m.id === newest).at(-1)
    const layout = toLayoutResult(input, last.layout)
    const quick = packLayout(input)

    const byThumb = new Map(images.map((image) => [image.thumbUrl, image.id]))
    const sheets = [...document.querySelectorAll('[data-sheet-page]')].map((sheet) => ({
      pieces: [...sheet.querySelectorAll('.group\\/piece')].map((el) => {
        const img = el.querySelector('img')
        return {
          imageId: byThumb.get(img.src),
          left: parseFloat(el.style.left),
          top: parseFloat(el.style.top),
          width: parseFloat(el.style.width),
          height: parseFloat(el.style.height),
          rotated: img.classList.contains('rotate-90'),
        }
      }),
    }))
    const stats = [...document.querySelectorAll('[data-sheet-index]')].map((el) => el.textContent)
    const expectedStats = layout.sheets.map((sheet) => ({
      pieces: String(sheet.stats.pieceCount),
      filled: `${formatNumber(sheet.stats.fillPercent, 1)}% filled`,
      used: formatArea(sheet.stats.usedArea, options.unit),
      wasted: formatArea(sheet.stats.wastedArea, options.unit),
      size: formatSize(layout.sheetWidth, layout.sheetHeight, options.unit),
    }))
    return {
      errors: validateLayout(input, layout),
      status: layout.status,
      layout: {
        sheetWidth: layout.sheetWidth,
        sheetHeight: layout.sheetHeight,
        sheets: layout.sheets.map((sheet) =>
          sheet.pieces.map((p) => ({
            imageId: p.piece.imageId,
            x: p.x,
            y: p.y,
            width: p.width,
            height: p.height,
            rotated: p.rotated,
          })),
        ),
      },
      sheets,
      stats,
      expectedStats,
      quickSheets: quick.sheets.length,
      refinedSheets: layout.sheets.length,
      pieceCount: input.pieces.length,
      unplaceable: layout.unplaceable.length,
    }
  })
}

/** Does the rendered scene equal the engine's layout, piece by piece? */
function compare(label, found) {
  const { layout, sheets } = found
  test.check(
    `${label}: the packer's layout passes the independent referee`,
    found.errors.length === 0,
    found.errors.slice(0, 2).join('; '),
  )
  test.check(`${label}: nothing is unplaceable`, found.unplaceable === 0)
  test.check(
    `${label}: as many sheets drawn as in the layout (${layout.sheets.length})`,
    sheets.length === layout.sheets.length,
    `${sheets.length} drawn`,
  )
  let worst = 0
  let mismatched = 0
  for (const [s, expected] of layout.sheets.entries()) {
    const drawn = sheets[s]?.pieces ?? []
    if (drawn.length !== expected.length) mismatched += Math.abs(drawn.length - expected.length) + 1
    for (const [i, piece] of expected.entries()) {
      const d = drawn[i]
      if (!d || d.imageId !== piece.imageId || d.rotated !== piece.rotated) {
        mismatched += 1
        continue
      }
      const wanted = [
        piece.x / layout.sheetWidth,
        piece.y / layout.sheetHeight,
        piece.width / layout.sheetWidth,
        piece.height / layout.sheetHeight,
      ].map((v) => v * 100)
      const got = [d.left, d.top, d.width, d.height]
      for (const [k, v] of wanted.entries()) worst = Math.max(worst, Math.abs(v - got[k]))
    }
  }
  test.check(
    `${label}: every piece is where the layout puts it`,
    mismatched === 0 && worst < 1e-3,
    `${mismatched} mismatched, worst error ${worst.toExponential(1)} % of the sheet`,
  )
  const statsOk = found.expectedStats.every((e, i) =>
    [e.pieces, e.filled, e.used, e.wasted, e.size].every((text) => found.stats[i]?.includes(text)),
  )
  test.check(`${label}: the hover statistics equal the engine's`, statsOk)
}

async function scene(label, options, { copies = 3, settle = true, photos = PHOTOS.length } = {}) {
  const app = await open({ dev: true, storage: optionsJson(options), init: watchWorkers() })
  const { page } = app
  await addGenerated(page, photoSpecs(photos))
  await waitForImages(page, photos)
  await page.waitForTimeout(600)
  await setAllCopies(page, copies)
  if (settle) await waitForSettled(page)
  await page.waitForTimeout(400)
  return { app, page }
}

// 1. Worker path: bundling, startup, first layout, improvements, status.
{
  const { app, page } = await scene(
    'hard scene',
    { ordering: 'optimize', gap: 2, orientation: 'auto' },
    { copies: 25 },
  )
  const seen = await page.evaluate(() => ({
    created: window.__packing.created.length,
    types: [...new Set(window.__packing.received.map((m) => m.type))],
    errors: window.__packing.errors,
  }))
  test.check(
    'the packing worker starts (module worker, real browser)',
    seen.created >= 1 && seen.errors.length === 0,
    JSON.stringify(seen),
  )
  test.check(
    'it sends a first layout and finishes with done',
    seen.types.includes('first') && seen.types.includes('done'),
    seen.types.join(','),
  )
  const found = await inspect(page)
  compare('hard scene (optimize, gap 2, automatic)', found)
  test.check(
    'the refined layout uses no more sheets than the first one',
    found.refinedSheets <= found.quickSheets,
    `${found.quickSheets} -> ${found.refinedSheets}`,
  )
  test.check('no page errors', app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
}

// 1b. A scene large enough that the search finds better layouts: improvements arrive, each valid.
{
  const { app, page } = await scene('large scene', { ordering: 'optimize', gap: 2 }, { copies: 60 })
  const types = await page.evaluate(() => window.__packing.received.map((m) => m.type))
  test.check(
    'improvements arrive from the worker for a large scene',
    types.includes('improved'),
    `${types.filter((t) => t === 'improved').length} improvements`,
  )
  compare('large scene (500 pieces, refined)', await inspect(page))
  await app.close()
}

// 2. Varied scenes: layout to screen equality for each.
const SCENES = [
  ['A4 portrait, strict order', { ordering: 'strict' }, 4],
  [
    'landscape, no rotation, margin 12, gap 3',
    { orientation: 'landscape', allowRotation: false, margin: 12, gap: 3, ordering: 'strict' },
    5,
  ],
  ['Letter, automatic, no gap', { sheetSize: 'letter', orientation: 'auto', gap: 0 }, 6],
  [
    'custom 100 x 150 mm sheet, margin 5, inches',
    {
      sheetSize: 'custom',
      customWidth: 100,
      customHeight: 150,
      margin: 5,
      unit: 'in',
      baseMode: 'width',
      baseLength: 30,
    },
    3,
  ],
  [
    'A3, native 300 dpi, cut guides',
    { sheetSize: 'a3', baseMode: 'native', baseDpi: 300, cutGuides: true },
    7,
  ],
  [
    'A6 with big photos (limited by the sheet)',
    { sheetSize: 'a6', baseMode: 'width', baseLength: 500 },
    2,
  ],
]
for (const [label, options, copies] of SCENES) {
  const { app, page } = await scene(label, options, { copies })
  compare(label, await inspect(page))
  test.check(`${label}: no page errors`, app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
}

// 3. Stable input: hover, selection, unit and guides must not restart the search.
{
  const { app, page } = await scene(
    'stability',
    { ordering: 'optimize', gap: 2 },
    { copies: 20, settle: false },
  )
  await page.waitForTimeout(300)
  const before = await page.evaluate(
    () => window.__packing.sent.filter((m) => m.type === 'run').length,
  )
  const pieces = page.locator('.group\\/piece')
  for (let i = 0; i < 12; i++) await pieces.nth(i).hover()
  await pieces.nth(3).click()
  await pieces.nth(40).click()
  await page.keyboard.press('Escape')
  await page.click('#print-options-button')
  await page.waitForTimeout(400)
  for (const name of ['Show page margins', 'Show sheet numbers', 'Cut guides']) {
    const toggle = page.getByRole('switch', { name })
    if (await toggle.count()) await toggle.first().click()
  }
  await page
    .getByRole('radio', { name: 'in', exact: true })
    .first()
    .click()
    .catch(() => undefined)
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => ({
    runs: window.__packing.sent.filter((m) => m.type === 'run').length,
    cancels: window.__packing.sent.filter((m) => m.type === 'cancel').length,
  }))
  test.check(
    'hover, selection, unit and display switches start no new search',
    after.runs === before,
    `${before} -> ${after.runs} runs`,
  )
  await app.close()
}

// 4. Cancel storm with slow answers: only the layout for the final inputs is ever shown.
{
  const app = await open({
    dev: true,
    storage: optionsJson({ ordering: 'optimize', gap: 2 }),
    init: watchWorkers(250),
  })
  const { page } = app
  await addGenerated(page, photoSpecs())
  await waitForImages(page, PHOTOS.length)
  await page.waitForTimeout(800)
  await setAllCopies(page, 15)
  const slider = page.locator('[role=slider]').first()
  await slider.focus()
  for (let i = 0; i < 40; i++) await page.keyboard.press(i % 3 ? 'ArrowRight' : 'ArrowLeft')
  test.check(
    'Download PDF is disabled while the layout for the latest inputs is on its way',
    await page.getByRole('button', { name: /Download PDF/ }).isDisabled(),
  )
  await waitForSettled(page)
  test.check(
    'and enabled again once it has arrived',
    await page.getByRole('button', { name: /Download PDF/ }).isEnabled(),
  )
  await page.waitForTimeout(800)
  const sent = await page.evaluate(() => window.__packing.sent)
  test.check(
    'stale runs were cancelled (cancel messages were sent)',
    sent.some((m) => m.type === 'cancel'),
    `${sent.filter((m) => m.type === 'run').length} runs, ${sent.filter((m) => m.type === 'cancel').length} cancels`,
  )
  compare('after the cancel storm with slow answers', await inspect(page))
  await app.close()
}

// 5. The worker cannot run: the layout is still packed, on the page, and the export still works.
{
  const app = await open({
    dev: true,
    storage: optionsJson({ ordering: 'optimize' }),
    init: `(() => {
      const Original = window.Worker
      window.Worker = class extends Original {
        constructor(url, options) {
          if (String(url).includes('packing.worker')) {
            super('data:text/javascript,throw new Error("no worker")', options)
          } else super(url, options)
        }
      }
    })()`,
  })
  const { page } = app
  await addGenerated(page, photoSpecs(4))
  await waitForImages(page, 4)
  await page.waitForTimeout(800)
  const pieces = await page.locator('.group\\/piece').count()
  test.check(
    'with the worker broken, the pieces are still packed and drawn',
    pieces === 4,
    `${pieces} pieces`,
  )
  await page.waitForTimeout(500)
  const badge = (await page.locator('[role=status]').allInnerTexts()).join('|')
  test.check(
    'and the status is honest: it says Optimal or Best found, not Optimizing',
    /Optimal|Best found/.test(badge) && !/Optimizing/.test(badge),
    badge,
  )
  test.check(
    'Download PDF is enabled',
    await page.getByRole('button', { name: /Download PDF/ }).isEnabled(),
  )
  await app.close()
}

test.done()
