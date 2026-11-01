import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  addFiles,
  addGenerated,
  open,
  reporter,
  setAllCopies,
  waitForImages,
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
    `${scheme}: the status reads Optimal or Best found once the search ends`,
    /Optimal|Best found/.test(settled),
    settled,
  )
  await audit(page, `${scheme}, packing status settled`)

  await page.click('#print-options-button')
  await page.waitForTimeout(700)
  await audit(page, `${scheme}, Print options open`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // Export dialog: ready.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[aria-label="Download PDF"]'),
  ])
  await download.path()
  await page.getByText('Your PDF is ready').waitFor()
  await page.waitForTimeout(600)
  await audit(page, `${scheme}, export dialog (ready)`)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForTimeout(400)
  test.check(`${scheme}: no page errors`, app.log.errors.length === 0, app.log.errors.join('; '))
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
  const spinner = page.locator('[role=status] svg.animate-spin')
  const animation = (await spinner.count())
    ? await spinner.first().evaluate((el) => getComputedStyle(el).animationName)
    : 'none'
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
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[aria-label="Download PDF"]'),
    ])
    await file.path()
    test.check('phone width: export works from the preview tab', true)
  }
  await app.close()
}

test.done()
