import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  addFiles,
  addGenerated,
  open,
  reporter,
  setAllCopies,
  waitForImages,
  waitForQuiet,
  waitForSettled,
} from './harness.mjs'

/*
 * Accessibility and responsiveness: axe-core (WCAG 2.2 AA) in light and dark across the empty
 * state, photos with the preview, Print options open, the packing status states and every state of
 * the export dialog; no horizontal overflow at four desktop widths and a phone width; and the
 * motion preference. Requires `npm run build` first.
 */
const test = reporter('Accessibility and responsiveness')
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
)
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function audit(page, label) {
  await waitForQuiet(page)
  await page.evaluate(axeSource)
  const result = await page.evaluate(
    (tags) => axe.run(document, { runOnly: { type: 'tag', values: tags } }),
    TAGS,
  )
  const bad = result.violations.map(
    (v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')}`,
  )
  test.check(`axe, ${label}: no WCAG 2.2 AA violations`, bad.length === 0, bad.join(' | '))
}

for (const scheme of ['light', 'dark']) {
  const app = await open({
    colorScheme: scheme,
    storage: JSON.stringify({
      state: { options: { cutGuides: true }, panelLayout: {} },
      version: 1,
    }),
  })
  const { page } = app
  await page.waitForTimeout(500)
  await audit(page, `${scheme}, empty state`)

  await addFiles(page, [
    'photo.jpg',
    'orient-6.jpg',
    'opaque.png',
    'alpha.png',
    'photo.webp',
    'gray.jpg',
  ])
  await waitForImages(page, 6)
  await page.waitForTimeout(600)
  await setAllCopies(page, 25)
  // The status while the packer is still searching.
  const searching = await page.locator('[role=status]').filter({ hasText: 'Optimizing' }).count()
  await audit(
    page,
    `${scheme}, photos with the preview${searching ? ' (status: Optimizing…)' : ''}`,
  )
  await waitForSettled(page)
  const settled = (await page.locator('[role=status]').allInnerTexts()).join('|')
  test.check(
    `${scheme}: the status reads Optimal, Best found or Time limit reached once the search ends`,
    /Optimal|Best found|Time limit reached/.test(settled),
    settled,
  )
  await audit(page, `${scheme}, packing status settled`)

  await page.click('#print-options-button')
  await page.waitForTimeout(700)
  await audit(page, `${scheme}, Print options open`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // Export dialog: ready.
  await page.click('[aria-label="Download PDF"]')
  await page.getByText('Your PDF is ready').waitFor()
  await page.waitForTimeout(600)
  await audit(page, `${scheme}, export dialog (ready)`)
  // Print where the browser has no PDF viewer (the headless shell): the dialog says so.
  await page.getByRole('dialog').getByRole('button', { name: 'Print', exact: true }).click()
  await page.getByText(/can.t print a PDF from here/).waitFor()
  await audit(page, `${scheme}, export dialog (print not possible here)`)
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(400)
  test.check(`${scheme}: no page errors`, app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
}

// The "opened in a new tab" note and the blocked-tab warning, in a browser that prints through a tab.
for (const [label, extra, scheme] of [
  ['opened in a tab', '', 'light'],
  ['tab blocked', 'window.open = () => null;', 'light'],
  ['opened in a tab', '', 'dark'],
  ['tab blocked', 'window.open = () => null;', 'dark'],
]) {
  const app = await open({
    colorScheme: scheme,
    init: `(() => { Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => true }); Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' }); ${extra} })()`,
  })
  const { page } = app
  await addFiles(page, ['photo.jpg', 'opaque.png'])
  await waitForImages(page, 2)
  await page.waitForTimeout(700)
  await page.click('[aria-label="Download PDF"]')
  await page.getByText('Your PDF is ready').waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Print', exact: true }).click()
  await page.getByText(/opened in a new tab|blocked the new tab/).waitFor()
  await page.waitForTimeout(600)
  await audit(page, `${scheme}, export dialog (${label})`)
  await app.close()
}

// The time-limit state of the status, with its Continue button: a one-second limit on a job too big to
// finish in it, in both colour schemes and on a phone.
for (const [label, scheme, width, height] of [
  ['light', 'light', 1280, 800],
  ['dark', 'dark', 1280, 800],
  ['phone', 'light', 390, 844],
]) {
  const app = await open({
    colorScheme: scheme,
    width,
    height,
    storage: JSON.stringify({ state: { options: { timeLimit: 1 } }, version: 1 }),
  })
  const { page } = app
  await addGenerated(
    page,
    [
      [1600, 1200],
      [1200, 1600],
      [1920, 1080],
      [1000, 1000],
      [1500, 2100],
      [2100, 1500],
      [1280, 960],
      [960, 1280],
      [1800, 1200],
      [1100, 1650],
    ].map(([w, h], i) => ({ width: w, height: h, name: `t${i}.jpg` })),
  )
  await waitForImages(page, 10)
  await setAllCopies(page, 40)
  if (width === 390)
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('button', { name: 'Preview' })
      .click()
  await page
    .getByRole('button', { name: 'Continue searching for a tighter layout' })
    .waitFor({ timeout: 60000 })
  await page.waitForTimeout(700)
  await audit(page, `${label}, status: time limit reached with Continue`)
  const continueButton = page.getByRole('button', {
    name: 'Continue searching for a tighter layout',
  })
  const box = await continueButton.boundingBox()
  // Points 2 px outside each edge of the pill, in the margin the button adds round itself (3 px: the
  // padding box starts inside the 1 px border).
  const hits = box
    ? await page.evaluate(
        ({ x, y, width: w, height: h }) =>
          [
            [x + w / 2, y - 2],
            [x + w / 2, y + h + 2],
            [x - 2, y + h / 2],
            [x + w + 2, y + h / 2],
          ].map(
            ([px, py]) =>
              document.elementFromPoint(px, py)?.getAttribute('aria-label') ===
              'Continue searching for a tighter layout',
          ),
        box,
      )
    : []
  test.check(
    `${label}: Continue is on screen, and its clickable area (a 3 px margin round the 22 px pill) is at least the 24 px WCAG 2.2 target size`,
    box !== null &&
      box.x >= 0 &&
      box.x + box.width <= width &&
      box.width >= 24 &&
      hits.every(Boolean) &&
      box.height + 6 >= 24,
    JSON.stringify(box),
  )
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  test.check(
    `${label}: no horizontal overflow with the time-limit status showing`,
    overflow <= 0,
    `${overflow}`,
  )
  await app.close()
}

// Saved work: the "Restoring" state held still, and the notices for work that is only in memory, in both
// colour schemes and on a phone.
for (const [label, scheme, width, height, kind] of [
  ['light', 'light', 1280, 800, 'restoring'],
  ['dark', 'dark', 1280, 800, 'restoring'],
  ['phone', 'light', 390, 844, 'restoring'],
  ['light', 'light', 1280, 800, 'unavailable'],
  ['dark', 'dark', 1280, 800, 'unavailable'],
  ['phone', 'light', 390, 844, 'unavailable'],
  ['dark', 'dark', 1280, 800, 'other-tab'],
]) {
  const init =
    kind === 'restoring'
      ? // The database never answers, so the state stays put for the audit.
        `localStorage.setItem('sheetfit:work-hint', '5'); indexedDB.open = () => ({})`
      : `Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })`
  const app = await open({ colorScheme: scheme, width, height, init })
  const { page } = app
  if (kind === 'other-tab') {
    // A second tab in the same browser, while the first owns the saved work.
    await app.page.waitForTimeout(500)
    const second = await app.context.newPage()
    await second.emulateMedia({ colorScheme: scheme })
    await second.setViewportSize({ width, height })
    await second.goto(app.url)
    await second.waitForTimeout(500)
  }
  if (width === 390)
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('button', { name: 'Images' })
      .click()
      .catch(() => {})
  if (kind === 'unavailable') {
    await addFiles(page, ['photo.jpg'])
    await waitForImages(page, 1)
  }
  await page.waitForTimeout(700)
  const target = kind === 'other-tab' ? app.context.pages().at(-1) : page
  const expected = {
    restoring: /Restoring your work/,
    unavailable: /can.t save your work/,
    'other-tab': /another tab/,
  }[kind]
  await target.getByText(expected).first().waitFor({ timeout: 10000 })
  await audit(target, `${label}, saved work: ${kind}`)
  const overflow = await target.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  test.check(`${label}, saved work (${kind}): no horizontal overflow`, overflow <= 0, `${overflow}`)
  await app.close()
}

// The progress state of the dialog, held still: the export itself finishes in milliseconds, and
// axe must not sample the dialog while it is still fading in.
for (const scheme of ['light', 'dark']) {
  const app = await open({
    colorScheme: scheme,
    init: `(() => { const O = window.Worker; window.Worker = class extends O { constructor(u, o) { super(u, o); if (String(u).includes('export.worker')) this.postMessage = () => {} } } })()`,
  })
  const { page } = app
  await addFiles(page, ['photo.jpg', 'opaque.png', 'gray.jpg'])
  await waitForImages(page, 3)
  await page.waitForTimeout(700)
  await page.click('[aria-label="Download PDF"]')
  await page.getByRole('progressbar').waitFor()
  await page.waitForTimeout(1200)
  await audit(page, `${scheme}, export dialog (progress)`)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await app.close()
}

// The error state of the dialog.
{
  const app = await open({
    init: `(() => { const O = window.Worker; let n = 0; window.Worker = class extends O { constructor(u, o) { if (String(u).includes('export.worker') && n++ === 0) super('data:text/javascript,postMessage({type:"failed",message:"Could not read a.jpg. The file may have been moved or deleted."})', o); else super(u, o) } } })()`,
  })
  const { page } = app
  await addFiles(page, ['photo.jpg'])
  await waitForImages(page, 1)
  await page.waitForTimeout(700)
  await page.click('[aria-label="Download PDF"]')
  await page.getByText('The export didn’t finish').waitFor()
  await audit(page, 'light, export dialog (error)')
  await app.close()
}

// Reduced motion: the spinner and animations are switched off.
{
  const app = await open()
  const { page } = app
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await addGenerated(page, [{ width: 800, height: 600 }])
  await waitForImages(page, 1)
  await setAllCopies(page, 40)
  // Read in one step: the spinner is gone the moment the search ends, and a detached element reads empty.
  const animation = await page.evaluate(() => {
    const spinner = document.querySelector('[role=status] svg.animate-spin')
    return spinner ? getComputedStyle(spinner).animationName : 'none'
  })
  test.check('reduced motion: the status spinner does not spin', animation === 'none', animation)
  await app.close()
}

// Responsiveness: no horizontal overflow and nothing cut off, at four desktop widths and a phone.
for (const [width, height] of [
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [390, 844],
]) {
  const app = await open({ width, height })
  const { page } = app
  await addFiles(page, ['photo.jpg', 'orient-6.jpg', 'opaque.png', 'alpha.png', 'photo.webp'])
  await waitForImages(page, 5)
  await page.waitForTimeout(700)
  await setAllCopies(page, 12)
  // On a phone the status is on the Preview tab, which is shown only once it is chosen.
  if (width === 390)
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('button', { name: 'Preview' })
      .click()
  await waitForSettled(page)
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }))
  test.check(
    `${width} px wide: no horizontal overflow`,
    overflow.x <= 0 && overflow.body <= 0,
    JSON.stringify(overflow),
  )
  const header = await page.getByRole('button', { name: 'Download PDF' }).boundingBox()
  test.check(
    `${width} px wide: Download PDF is on screen`,
    header && header.x >= 0 && header.x + header.width <= width,
    JSON.stringify(header),
  )
  if (width === 390) {
    await page.waitForTimeout(600)
    await audit(page, 'phone width, preview tab')
    await page.click('[aria-label="Download PDF"]')
    await page.getByText('Your PDF is ready').waitFor()
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('dialog').getByRole('button', { name: 'Download PDF' }).click(),
    ])
    await file.path()
    await audit(page, 'phone width, export dialog (ready)')
    test.check('phone width: export works from the preview tab', true)
  }
  await app.close()
}

test.done()
