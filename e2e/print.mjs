import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addGenerated, open, reporter, waitForImages, waitForSettled } from './harness.mjs'

/*
 * Printing from the "Your PDF is ready" dialog, in the full Chrome build (which has the built-in PDF
 * viewer a headless shell lacks) and in the situations other browsers put the app in. A real printer
 * and a real print dialog cannot be driven from here, so what is checked is what the page controls:
 * print() is called, once per click, on the frame that holds the exported PDF; that PDF has the right
 * pages and size; nothing is downloaded or opened by itself; the fallbacks say what they did; and the
 * object URLs and the hidden frame are gone when the dialog closes. Needs qpdf and pdfinfo on PATH.
 */
const t = reporter('Print from the PDF-ready dialog')
const work = mkdtempSync(join(tmpdir(), 'sheetfit-print-'))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Records every PDF object URL, every call to a frame's print(), and every frame created. */
const RECORDERS = `(() => {
  const urls = (window.__urls = { created: [], revoked: [] })
  window.__blobs = new Map()
  const create = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (blob) => {
    const url = create(blob)
    if (blob.type === 'application/pdf') {
      urls.created.push(url)
      window.__blobs.set(url, blob)
    }
    return url
  }
  const revoke = URL.revokeObjectURL.bind(URL)
  URL.revokeObjectURL = (url) => {
    urls.revoked.push(url)
    revoke(url)
  }
  window.__prints = []
  const getter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get() {
      const view = getter.call(this)
      if (view && !view.__hooked) {
        Object.defineProperty(view, '__hooked', { value: true })
        Object.defineProperty(view, 'print', {
          configurable: true,
          value: () => window.__prints.push({ src: this.src, contentType: view.document.contentType }),
        })
      }
      return view
    },
  })
})()`

const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
const as = {
  noViewer: `Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => false })`,
  firefox: `Object.defineProperty(navigator, 'userAgent', { get: () => ${JSON.stringify(FIREFOX_UA)} })`,
  blocked: `window.open = () => null`,
  brokenFrame: `Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { configurable: true, get: () => null })`,
}

/** Opens the app, counts downloads and popups from the first moment, and adds photos. */
async function start({ photos = 3, settle = true, ...options } = {}) {
  const app = await open({ colorScheme: 'light', ...options })
  const { page, context } = app
  app.downloads = []
  app.popups = []
  page.on('download', (d) => app.downloads.push(d))
  context.on('page', (p) => app.popups.push(p))
  await addGenerated(
    page,
    Array.from({ length: photos }, (_, i) => ({
      width: 1200,
      height: 900 + i * 100,
      name: `p${i}.jpg`,
    })),
  )
  await waitForImages(page, photos)
  if (settle) await waitForSettled(page)
  else await page.waitForTimeout(1500)
  return app
}

const makeReady = async (page) => {
  await page.click('[aria-label="Download PDF"]')
  await page.getByText('Your PDF is ready').waitFor({ timeout: 60000 })
}
const dialog = (page) => page.locator('[role=dialog]')
const prints = (page) => page.evaluate(() => window.__prints.length)
const urls = (page) => page.evaluate(() => window.__urls)
const frames = (page) => page.locator('iframe').count()
const status = (page) => dialog(page).locator('[role=status]').allInnerTexts()
const blobBytes = async (page, url) =>
  Buffer.from(
    await page.evaluate(async (u) => {
      const bytes = new Uint8Array(await window.__blobs.get(u).arrayBuffer())
      let binary = ''
      for (const b of bytes) binary += String.fromCharCode(b)
      return btoa(binary)
    }, url),
    'base64',
  )

// ---------------------------------------------------------------------------------------------
// 1. Chrome with its PDF viewer: the whole life of the dialog.
{
  const app = await start({ channel: 'chromium', init: RECORDERS })
  const { page } = app
  t.check(
    'the full browser has a PDF viewer',
    await page.evaluate(() => navigator.pdfViewerEnabled),
  )
  await makeReady(page)
  // Counted once the export is done: a sheet that is still animating away is not a page.
  const sheets = await page.locator('[data-sheet-page]').count()
  await page.waitForTimeout(2500)
  t.check('nothing is downloaded when the export finishes', app.downloads.length === 0)
  t.check(
    'nothing is opened or printed by itself',
    app.popups.length === 0 && (await prints(page)) === 0,
  )
  t.check(
    'no object URL for the PDF exists until a button needs one',
    (await urls(page)).created.length === 0,
  )

  const buttons = await dialog(page).getByRole('button').allInnerTexts()
  t.check(
    'the dialog offers Print and Download PDF, and has no Done button (it closes with its X and Escape)',
    ['Print', 'Download PDF'].every((name) => buttons.some((b) => b.trim() === name)) &&
      !buttons.some((b) => b.trim() === 'Done') &&
      (await dialog(page).getByRole('button', { name: 'Close' }).count()) === 1,
    buttons.join(' | '),
  )
  t.check(
    'there is no "Download again" any more',
    (await dialog(page).getByRole('button', { name: /again/i }).count()) === 0,
  )
  const classes = async (name) =>
    dialog(page).getByRole('button', { name, exact: true }).getAttribute('class')
  t.check(
    'Download PDF is the primary action and Print the secondary one',
    (await classes('Download PDF')).includes('bg-primary') &&
      (await classes('Print')).includes('border-input'),
  )
  t.check(
    'the dialog carries no print-scaling tip',
    !/Actual size|Fit to page|100%/.test(await dialog(page).innerText()),
  )
  const text = await dialog(page).innerText()
  t.check(
    'the filename and the size are shown',
    /sheetfit-\d{4}-\d{2}-\d{2}\.pdf/.test(text) && /\d+ KB/.test(text),
  )

  // Print: invoked on the frame that holds the exported PDF.
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).click()
  await page.waitForFunction(() => window.__prints.length === 1, null, { timeout: 15000 })
  const first = (await page.evaluate(() => window.__prints))[0]
  const created = (await urls(page)).created
  t.check(
    'Print called print() once, on a frame showing a PDF',
    first.contentType === 'application/pdf',
    JSON.stringify(first),
  )
  t.check(
    'that frame loaded the exported PDF from memory (a blob: URL)',
    first.src === created[0] && first.src.startsWith('blob:'),
  )
  t.check(
    'the frame is hidden and hidden from assistive technology',
    await page.evaluate(() => {
      const f = document.querySelector('iframe')
      return f.getAttribute('aria-hidden') === 'true' && getComputedStyle(f).visibility === 'hidden'
    }),
  )
  const printed = await blobBytes(page, first.src)
  const path = join(work, 'printed.pdf')
  writeFileSync(path, printed)
  const info = execFileSync('pdfinfo', [path], { encoding: 'utf8' })
  t.check(
    `the printed document has ${sheets} page(s) of A4`,
    new RegExp(`Pages:\\s+${sheets}\\b`).test(info) && /595\.276 x 841\.89/.test(info),
    info
      .split('\n')
      .filter((l) => /Pages|Page size/.test(l))
      .join('; '),
  )
  t.check(
    'the printed document is a valid PDF (qpdf)',
    (() => {
      try {
        return execFileSync('qpdf', ['--check', path], { encoding: 'utf8' }).includes(
          'No syntax or stream encoding errors',
        )
      } catch {
        return false
      }
    })(),
  )
  t.check(
    'the keyboard focus is back on the Print button, not left in the hidden frame',
    await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Print'),
  )
  t.check(
    'printing downloaded nothing and opened nothing',
    app.downloads.length === 0 && app.popups.length === 0,
  )
  t.check(
    'the dialog stays open and the buttons are usable again',
    (await dialog(page).getByRole('button', { name: 'Print', exact: true }).isEnabled()) &&
      (await dialog(page).getByRole('button', { name: 'Download PDF' }).isEnabled()),
  )

  // Again: same frame, same URL.
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).click()
  await page.waitForFunction(() => window.__prints.length === 2, null, { timeout: 15000 })
  t.check(
    'printing again reuses the one frame and the one URL',
    (await frames(page)) === 1 && (await urls(page)).created.length === 1,
  )

  // Keyboard: Enter and Space on Print.
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__prints.length === 3, null, { timeout: 15000 })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.__prints.length === 4, null, { timeout: 15000 })
  t.check('Print works from the keyboard (Enter and Space)', true)

  // Download PDF: the same document, and printing still works afterwards.
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    dialog(page).getByRole('button', { name: 'Download PDF' }).click(),
  ])
  const saved = join(work, 'saved.pdf')
  await file.saveAs(saved)
  t.check(
    'Download PDF saves exactly the document that was printed',
    sha(readFileSync(saved)) === sha(printed),
    file.suggestedFilename(),
  )
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).click()
  await page.waitForFunction(() => window.__prints.length === 5, null, { timeout: 15000 })
  t.check(
    'Print after Download works, and Download after Print works (any order, any number of times)',
    app.downloads.length === 1,
  )
  await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    dialog(page).getByRole('button', { name: 'Download PDF' }).click(),
  ])
  t.check('a second Download PDF saves again', app.downloads.length === 2)

  // Closing releases everything.
  await dialog(page).getByRole('button', { name: 'Close' }).click()
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0, null, {
    timeout: 5000,
  })
  const afterClose = await urls(page)
  t.check('closing the dialog removes the frame', (await frames(page)) === 0)
  t.check('closing the dialog releases the object URL', afterClose.revoked.includes(created[0]))

  // A second export is a new document with a new session; Escape closes it the same way.
  await makeReady(page)
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).click()
  await page.waitForFunction(() => window.__prints.length === 6, null, { timeout: 15000 })
  const secondSrc = (await page.evaluate(() => window.__prints)).at(-1).src
  t.check('a second export prints from a URL of its own', secondSrc !== first.src)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0, null, {
    timeout: 5000,
  })
  t.check(
    'Escape closes the dialog and releases that URL too',
    (await urls(page)).revoked.includes(secondSrc),
  )

  // The built-in PDF viewer loads its own files (chrome-extension:// and chrome://), which ship inside
  // the browser and never touch the network.
  const local = (u) => u.startsWith(app.url) || /^(blob|data|chrome-extension|chrome):/.test(u)
  t.check(
    'only same-origin requests: the page, its blob: URLs and the viewer’s built-in files',
    app.log.requests.every(local),
    app.log.requests.filter((u) => !local(u)).join(' '),
  )
  t.check('no page errors', app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
}

// ---------------------------------------------------------------------------------------------
// 2. A browser with no PDF viewer: no pretending, no tab, no download, and it says so.
for (const [label, options] of [
  ['the headless shell, which really has no viewer', {}],
  [
    'a full browser reporting no viewer (Chrome on Android)',
    { channel: 'chromium', init: RECORDERS + ';' + as.noViewer },
  ],
]) {
  const app = await start(options)
  const { page } = app
  await makeReady(page)
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).click()
  await page.getByText(/can.t print a PDF from here/).waitFor({ timeout: 5000 })
  t.check(
    `${label}: Print says it cannot, in words, and points to Download`,
    /Download it and print it from a PDF viewer/.test((await status(page)).join(' ')),
  )
  t.check(
    `${label}: nothing was opened, downloaded or framed`,
    app.downloads.length === 0 && app.popups.length === 0 && (await frames(page)) === 0,
  )
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    dialog(page).getByRole('button', { name: 'Download PDF' }).click(),
  ])
  t.check(`${label}: Download PDF still works`, (await file.failure()) === null)
  await app.close()
}

// ---------------------------------------------------------------------------------------------
// 3. A browser that opens PDFs in its own viewer in a tab (Firefox, Safari): the tab, and a plain line.
{
  const app = await start({ channel: 'chromium', init: RECORDERS + ';' + as.firefox })
  const { page, context } = app
  await makeReady(page)
  const popup = context.waitForEvent('page')
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).click()
  const tab = await popup
  await page
    .getByText('The PDF opened in a new tab. Print it from there.')
    .waitFor({ timeout: 5000 })
  t.check('a new tab opens on the PDF held in memory', tab.url().startsWith('blob:'), tab.url())
  t.check(
    'no hidden frame was used, and nothing was downloaded',
    (await frames(page)) === 0 && app.downloads.length === 0,
  )
  t.check(
    'the dialog says what happened, as a polite status',
    (await status(page)).some((s) => s.includes('opened in a new tab')),
  )
  await tab.close()
  await dialog(page).getByRole('button', { name: 'Close' }).click()
  const url = (await urls(page)).created[0]
  t.check(
    'the URL is kept a moment after closing, for the tab that may still be reading it',
    !(await urls(page)).revoked.includes(url),
  )
  await page.waitForFunction((u) => window.__urls.revoked.includes(u), url, { timeout: 15000 })
  t.check('and then released', true)
  await app.close()
}

// 4. The browser blocks the tab.
{
  const app = await start({
    channel: 'chromium',
    init: RECORDERS + ';' + as.firefox + ';' + as.blocked,
  })
  const { page } = app
  await makeReady(page)
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).click()
  await page.getByText(/blocked the new tab/).waitFor({ timeout: 5000 })
  t.check(
    'a blocked tab is reported, with the way out',
    /Download the PDF and print it from a PDF viewer/.test((await status(page)).join(' ')),
  )
  await app.close()
}

// 5. Chrome, but the frame cannot be reached: falls back to the tab, never silently.
{
  const app = await start({ channel: 'chromium', init: RECORDERS + ';' + as.brokenFrame })
  const { page, context } = app
  await makeReady(page)
  const popup = context.waitForEvent('page')
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).click()
  const tab = await popup
  await page
    .getByText('The PDF opened in a new tab. Print it from there.')
    .waitFor({ timeout: 5000 })
  t.check(
    'a frame that cannot be printed falls back to a tab, and says so',
    tab.url().startsWith('blob:') && (await frames(page)) === 0,
  )
  await app.close()
}

// ---------------------------------------------------------------------------------------------
// 6. A phone: every action reachable, nothing overflowing, with the longest note showing.
{
  const app = await start({
    channel: 'chromium',
    width: 390,
    height: 780,
    settle: false,
    init: RECORDERS + ';' + as.noViewer,
  })
  const { page } = app
  await page
    .getByRole('tab', { name: /Preview/ })
    .click()
    .catch(() => {})
  await makeReady(page)
  await dialog(page).getByRole('button', { name: 'Print', exact: true }).click()
  await page.getByText(/can.t print a PDF from here/).waitFor({ timeout: 5000 })
  await page.waitForTimeout(400)
  const fit = await page.evaluate(() => {
    const box = document.querySelector('[role=dialog]').getBoundingClientRect()
    const buttons = [...document.querySelectorAll('[role=dialog] button')]
      .filter((b) => ['Print', 'Download PDF'].includes(b.textContent.trim()))
      .map((b) => b.getBoundingClientRect())
    return {
      dialogInside: box.left >= 0 && box.right <= innerWidth,
      buttonsInside:
        buttons.length === 2 &&
        buttons.every(
          (b) => b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight && b.height >= 36,
        ),
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      dialogOverflow:
        document.querySelector('[role=dialog]').scrollWidth >
        document.querySelector('[role=dialog]').clientWidth,
    }
  })
  t.check(
    '390 px: the dialog and both buttons are on screen and no wider than the screen',
    fit.dialogInside && fit.buttonsInside && !fit.pageOverflow && !fit.dialogOverflow,
    JSON.stringify(fit),
  )
  await app.close()
}

t.done()
