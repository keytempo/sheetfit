import {
  addFiles,
  addPrepared,
  open,
  prepareGenerated,
  reporter,
  startFrameLog,
  stopFrameLog,
  waitForImages,
  waitForSettled,
  watchRenders,
  watchWorkers,
} from './harness.mjs'

/*
 * A batch of photos is added in one step, and the packer runs once for it, however the photos
 * arrive. The 54-photo scene prints the numbers the work was measured by: packing runs, React
 * commits and component renders, and the long tasks (work that blocks the page for over 50 ms).
 * Run against a build from before the change (SHEETFIT_DIST) it prints the "before" figures too.
 */
const t = reporter('Batch import: one packing run per batch')

const specs = (count, { offset = 0, prefix = 'batch', width = 1600 } = {}) =>
  Array.from({ length: count }, (_, i) => ({
    width,
    height: Math.round(width * 0.75) + ((i + offset) % 5) * 100,
    name: `${prefix}-${String(i + offset + 1).padStart(3, '0')}.jpg`,
  }))

const counts = (page) =>
  page.evaluate(() => ({
    runs: window.__packing.sent.filter((m) => m.type === 'run').length,
    commits: window.__renders.commits,
    renders: window.__renders.renders,
  }))
const names = (page) =>
  page
    .locator('ul[aria-label=Images] > li [data-image-row]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const rowCount = (page) => page.locator('[data-image-row]').count()
const skeletons = (page) => page.locator('ul[aria-label=Images] > li[aria-hidden=true]').count()
const busy = (page) => page.locator('ul[aria-label=Images]').getAttribute('aria-busy')
const pieces = (page) => page.locator('[data-piece]').count()
const delta = (a, b) => ({
  runs: b.runs - a.runs,
  commits: b.commits - a.commits,
  renders: b.renders - a.renders,
})
/** Waits until exactly `count` real rows are listed and nothing is loading (placeholders are not rows). */
const waitForRows = (page, count, timeout = 90000) =>
  page.waitForFunction(
    (count) =>
      document.querySelectorAll('[data-image-row]').length === count &&
      document.querySelector('ul[aria-label=Images]')?.getAttribute('aria-busy') === 'false',
    count,
    { timeout },
  )
const openApp = (extra = {}) => open({ init: watchWorkers() + ';' + watchRenders(), ...extra })

async function main() {
  // 1. 54 photos through the file input: the numbers the work is judged by.
  {
    const app = await openApp()
    const { page } = app
    await prepareGenerated(page, specs(54), 'fifty-four')
    const before = await counts(page)
    await startFrameLog(page)
    const started = Date.now()
    await addPrepared(page, 'fifty-four')
    await waitForImages(page, 54)
    const listed = Date.now() - started
    await waitForSettled(page)
    const long = await stopFrameLog(page)
    const d = delta(before, await counts(page))
    console.log(
      `  54 photos: ${d.runs} packing runs, ${d.commits} React commits, ${d.renders} component renders, ` +
        `${long.longTasks} long tasks (longest ${long.longTaskMax} ms, total ${long.longTaskTotal} ms), ` +
        `frames: median ${long.frameMedian} ms, p95 ${long.frameP95} ms, max ${long.frameMax} ms, all listed after ${listed} ms`,
    )
    t.check('54 photos start exactly one packing run', d.runs === 1, `${d.runs}`)
    t.check(
      'the 54 photos are listed in the order they were selected',
      JSON.stringify(await names(page)) === JSON.stringify(specs(54).map((s) => s.name)),
    )
    t.check('every copy is on a sheet', (await pieces(page)) > 0 && (await busy(page)) === 'false')
    await app.close()
  }

  // 2. A batch of one, and then a second batch of one.
  {
    const app = await openApp()
    const { page } = app
    await prepareGenerated(page, specs(1, { prefix: 'one' }), 'one')
    await prepareGenerated(page, specs(1, { prefix: 'two' }), 'two')
    const before = await counts(page)
    await addPrepared(page, 'one')
    await waitForRows(page, 1)
    await waitForSettled(page)
    t.check('a batch of one starts one packing run', delta(before, await counts(page)).runs === 1)
    await addPrepared(page, 'two')
    await waitForRows(page, 2)
    await waitForSettled(page)
    t.check(
      'and a later batch of one starts one more',
      delta(before, await counts(page)).runs === 2,
    )
    await app.close()
  }

  // 3. Files that cannot be used: skipped with a toast each, the rest added together, one run.
  {
    const app = await openApp()
    const { page } = app
    const before = await counts(page)
    await addFiles(page, ['photo.jpg', 'corrupt.jpg', 'opaque.png', 'not-an-image.png', 'gray.jpg'])
    await waitForRows(page, 3)
    await waitForSettled(page)
    await page.waitForTimeout(600)
    t.check(
      'the usable files are listed in order',
      JSON.stringify(await names(page)) === JSON.stringify(['photo.jpg', 'opaque.png', 'gray.jpg']),
      (await names(page)).join(', '),
    )
    t.check(
      'each unusable file got its own toast',
      (await page.locator('[data-sonner-toast]').count()) >= 2,
    )
    t.check(
      'the rest still start exactly one packing run',
      delta(before, await counts(page)).runs === 1,
    )
    t.check(
      'nothing is left loading',
      (await busy(page)) === 'false' && (await skeletons(page)) === 0,
    )
    await app.close()
  }

  // 4. While photos decode the list shows placeholders and progress, and no photo appears early.
  {
    const app = await openApp()
    const { page } = app
    await prepareGenerated(page, specs(8, { prefix: 'big', width: 4200 }), 'big')
    await addPrepared(page, 'big')
    await page.waitForSelector('ul[aria-label=Images][aria-busy=true]')
    const during = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-image-row]').length,
      skeletons: document.querySelectorAll('ul[aria-label=Images] > li[aria-hidden=true]').length,
      progress: document.querySelector('section[aria-label=Images]')?.textContent ?? '',
    }))
    t.check(
      'placeholders show while photos decode, no more than four',
      during.skeletons >= 1 && during.skeletons <= 4,
      `${during.skeletons}`,
    )
    t.check('no photo is listed before the batch is complete', during.rows === 0, `${during.rows}`)
    t.check(
      'the toolbar says how far it is',
      /Importing \d+ of 8…/.test(during.progress),
      during.progress.slice(0, 120),
    )
    await waitForRows(page, 8)
    t.check(
      'then all eight are listed and the placeholders are gone',
      (await rowCount(page)) === 8 &&
        (await skeletons(page)) === 0 &&
        (await busy(page)) === 'false',
    )
    t.check(
      'the toolbar goes back to the counts',
      /8 pieces · 8 images/.test(await page.locator('section[aria-label=Images]').innerText()),
    )
    t.check(
      'listing announces the batch once',
      (await page.locator('[aria-live=polite][aria-atomic=true]').innerText()) === 'Added 8 images',
    )
    await app.close()
  }

  // 5. A second batch dropped while the first is still loading: nothing lost, order kept, one run each.
  {
    const app = await openApp()
    const { page } = app
    await prepareGenerated(page, specs(10, { prefix: 'first', width: 3600 }), 'first')
    await prepareGenerated(page, specs(3, { prefix: 'second' }), 'second')
    const before = await counts(page)
    await addPrepared(page, 'first')
    await page.waitForSelector('ul[aria-label=Images][aria-busy=true]')
    await addPrepared(page, 'second')
    await waitForRows(page, 13)
    await waitForSettled(page)
    const expected = [
      ...specs(10, { prefix: 'first', width: 3600 }),
      ...specs(3, { prefix: 'second' }),
    ].map((s) => s.name)
    t.check(
      'the second batch lands after the first, nothing lost or duplicated',
      JSON.stringify(await names(page)) === JSON.stringify(expected),
      (await names(page)).join(', '),
    )
    t.check(
      'two batches start two packing runs, not one per photo',
      delta(before, await counts(page)).runs === 2,
      `${delta(before, await counts(page)).runs}`,
    )
    t.check('the layout on screen is for all 13 photos', (await pieces(page)) === 13)
    t.check(
      'nothing is left loading',
      (await busy(page)) === 'false' && (await skeletons(page)) === 0,
    )
    await app.close()
  }

  // 6. Clear all while a batch is still loading drops that batch too.
  {
    const app = await openApp()
    const { page } = app
    await addFiles(page, ['photo.jpg'])
    await waitForRows(page, 1)
    await prepareGenerated(page, specs(6, { prefix: 'late', width: 4000 }), 'late')
    await addPrepared(page, 'late')
    await page.waitForSelector('ul[aria-label=Images][aria-busy=true]')
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: /Clear all/ }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /Clear all|Remove|Yes/ })
      .last()
      .click()
    await page.waitForTimeout(4000)
    t.check(
      'nothing from the cleared batch appears afterwards',
      (await rowCount(page)) === 0 && (await skeletons(page)) === 0,
    )
    await app.close()
  }

  // 7. Dropping and pasting many files: the same single step.
  for (const how of ['drop', 'paste']) {
    const app = await openApp()
    const { page } = app
    await prepareGenerated(page, specs(12, { prefix: how }), how)
    const before = await counts(page)
    await page.evaluate(
      ({ how }) => {
        const transfer = new DataTransfer()
        for (const file of window.__prepared[how]) transfer.items.add(file)
        if (how === 'drop') {
          document.body.dispatchEvent(
            new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true }),
          )
          document.body.dispatchEvent(
            new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
          )
        } else {
          document.dispatchEvent(
            new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }),
          )
        }
      },
      { how },
    )
    await waitForRows(page, 12)
    await waitForSettled(page)
    t.check(
      `${how}: 12 photos start exactly one packing run, in order`,
      delta(before, await counts(page)).runs === 1 &&
        JSON.stringify(await names(page)) ===
          JSON.stringify(specs(12, { prefix: how }).map((s) => s.name)),
    )
    await app.close()
  }

  t.done()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
