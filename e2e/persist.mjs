import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addFiles,
  addPrepared,
  open,
  prepareGenerated,
  reporter,
  waitForSettled,
  watchRenders,
  watchWorkers,
} from './harness.mjs'

/*
 * Saving the work and bringing it back. Everything here reloads the page inside one browser context,
 * so IndexedDB really persists between loads, and looks at the database itself where a check needs
 * the truth about what was saved. Storage failures are simulated by replacing what the page sees.
 */
const t = reporter('Work persistence')
const work = mkdtempSync(join(tmpdir(), 'sheetfit-persist-'))

const spec = (i, width = 1600, prefix = 'p') => ({
  width,
  height: Math.round(width * 0.75) + (i % 5) * 100,
  name: `${prefix}-${String(i + 1).padStart(3, '0')}.jpg`,
})
const specs = (n, width, prefix) => Array.from({ length: n }, (_, i) => spec(i, width, prefix))
const rows = (page) => page.locator('[data-image-row]').count()
const waitForRows = (page, n, timeout = 60000) =>
  page.waitForFunction(
    (n) =>
      document.querySelectorAll('[data-image-row]').length === n &&
      document.querySelector('ul[aria-label=Images]')?.getAttribute('aria-busy') === 'false',
    n,
    { timeout },
  )
const names = (page) =>
  page
    .locator('[data-image-row]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
/** Packing runs for a layout that has pieces: the empty page's own run, before anything is added, is not one. */
const runs = (page) =>
  page.evaluate(() => window.__packing.sent.filter((m) => m.type === 'run' && m.pieces > 0).length)
const notice = (page) =>
  page
    .locator('section[aria-label=Images] > p[role=status]')
    .allInnerTexts()
    .then((a) => a.join(' '))
const toasts = (page) =>
  page
    .locator('[data-sonner-toast]')
    .allInnerTexts()
    .then((a) => a.join(' | '))

/** Reads or changes the saved database directly. */
const db = (page, op, ...args) =>
  page.evaluate(
    async ({ op, args }) => {
      const conn = await new Promise((resolve, reject) => {
        const r = indexedDB.open('sheetfit-work')
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      const done = (tx) =>
        new Promise(
          (resolve, reject) => ((tx.oncomplete = resolve), (tx.onerror = () => reject(tx.error))),
        )
      const get = (store, key) =>
        new Promise((resolve) => {
          const r = conn.transaction(store).objectStore(store).get(key)
          r.onsuccess = () => resolve(r.result)
        })
      let result
      if (op === 'counts') {
        const tx = conn.transaction(['images', 'meta'])
        const [ids, meta] = await Promise.all([
          new Promise((resolve) => {
            const r = tx.objectStore('images').getAllKeys()
            r.onsuccess = () => resolve(r.result)
          }),
          new Promise((resolve) => {
            const r = tx.objectStore('meta').get('work')
            r.onsuccess = () => resolve(r.result)
          }),
        ])
        result = {
          ids,
          listed: meta?.items?.map((i) => i.id) ?? null,
          schema: meta?.schema ?? null,
        }
      } else {
        const [id] = args
        // Read first, in transactions of their own; a transaction left waiting would commit and close.
        const record = op === 'truncate' || op === 'garble' ? await get('images', id) : null
        const meta = op === 'newer' ? await get('meta', 'work') : null
        const tx = conn.transaction(['images', 'meta'], 'readwrite')
        if (op === 'delete') tx.objectStore('images').delete(id)
        if (op === 'truncate')
          tx.objectStore('images').put({
            ...record,
            file: record.file.slice(0, Math.floor(record.file.size / 2)),
          })
        if (op === 'garble')
          tx.objectStore('images').put({
            ...record,
            thumbnail: new Blob(['not an image at all'], { type: 'image/webp' }),
          })
        if (op === 'newer') tx.objectStore('meta').put({ ...meta, schema: 2 }, 'work')
        await done(tx)
      }
      conn.close()
      return result
    },
    { op, args },
  )

const store = (page) =>
  page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/index.ts')
    const s = useAppStore.getState()
    const hash = async (blob) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return {
      selected: s.selectedImageId,
      images: await Promise.all(
        s.images.map(async (i) => ({
          id: i.id,
          name: i.name,
          copies: i.copies,
          percent: i.percent,
          width: i.width,
          height: i.height,
          type: i.file.type,
          size: i.file.size,
          sha: await hash(i.file),
          url: i.url.slice(0, 5),
          thumb: i.thumbUrl.slice(0, 5),
        })),
      ),
    }
  })

async function main() {
  // ---- 1. 54 photos and a 50-megapixel one survive a reload, byte for byte.
  {
    const app = await open({ dev: true, init: watchWorkers() + ';' + watchRenders() })
    const { page } = app
    await prepareGenerated(
      page,
      [...specs(54), { width: 8000, height: 6250, name: 'huge-50mp.jpg', quality: 0.4 }],
      'all',
    )
    await addPrepared(page, 'all')
    await waitForRows(page, 55)
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/index.ts')
      const s = useAppStore.getState()
      s.setCopies(s.images[0].id, 7)
      s.setPercent(s.images[3].id, 140)
      s.moveImage(s.images[10].id, 2)
      s.selectImage(s.images[1].id)
    })
    await waitForSettled(page)
    await page.waitForTimeout(1500)
    const before = await store(page)
    const saved = await db(page, 'counts')
    t.check(
      'every photo is saved, and the list names exactly them',
      saved.ids.length === 55 &&
        JSON.stringify([...saved.ids].sort()) === JSON.stringify([...saved.listed].sort()),
      `${saved.ids.length} saved`,
    )

    const started = Date.now()
    await page.reload({ waitUntil: 'commit' })
    await page.waitForSelector('ul[aria-label=Images]', { timeout: 30000 })
    const sawRestoring = await page.evaluate(() => /Restoring/.test(document.body.innerText))
    await waitForRows(page, 55)
    const took = Date.now() - started
    await waitForSettled(page)
    const after = await store(page)
    console.log(
      `  restore: 55 photos back after ${took} ms; ${await runs(page)} packing run(s), ${await page.evaluate(() => window.__renders.commits)} React commits`,
    )
    t.check('the restore says it is restoring while it works', sawRestoring || took < 400)
    t.check(
      'same photos, same order, same copies and sizes',
      JSON.stringify(
        after.images.map((i) => [i.id, i.name, i.copies, i.percent, i.width, i.height]),
      ) ===
        JSON.stringify(
          before.images.map((i) => [i.id, i.name, i.copies, i.percent, i.width, i.height]),
        ),
    )
    t.check(
      'the original bytes are identical (SHA-256), the 50 MP photo included',
      after.images.every(
        (img, i) => img.sha === before.images[i].sha && img.size === before.images[i].size,
      ),
    )
    t.check(
      'they are the same kind of file (type kept)',
      after.images.every((i) => i.type === 'image/jpeg'),
    )
    t.check(
      'new object URLs were made for each',
      after.images.every((i) => i.url === 'blob:' && i.thumb === 'blob:') &&
        new Set(after.images.map((i) => i.sha)).size > 1,
    )
    t.check(
      'exactly one packing run for the whole restore',
      (await runs(page)) === 1,
      `${await runs(page)}`,
    )
    t.check(
      'selection is session state: nothing is selected after a reload',
      after.selected === null,
    )
    t.check(
      'thumbnails show',
      await page
        .locator('[data-image-row] img')
        .evaluateAll((els) => els.slice(0, 10).every((e) => e.complete && e.naturalWidth > 0)),
    )
    t.check(
      'nothing is left loading and no notice is showing',
      (await notice(page)) === '' &&
        (await page.locator('ul[aria-label=Images]').getAttribute('aria-busy')) === 'false',
    )

    // The export after a restore is the export of the original files.
    await page.click('[aria-label="Download PDF"]')
    await page.getByText('Your PDF is ready').waitFor({ timeout: 180000 })
    const [file] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.getByRole('dialog').getByRole('button', { name: 'Download PDF' }).click(),
    ])
    const path = join(work, 'restored.pdf')
    await file.saveAs(path)
    t.check(
      'exporting after a restore works',
      /Pages:\s+\d+/.test(execFileSync('pdfinfo', [path], { encoding: 'utf8' })),
    )
    await app.close()
  }

  // ---- 2. A missing, cut-off or damaged saved photo never breaks the rest.
  {
    const app = await open({ dev: true, init: watchWorkers() })
    const { page } = app
    await addFiles(
      page,
      ['photo.jpg', 'opaque.png', 'gray.jpg', 'orient-1.jpg', 'orient-2.jpg'].filter(Boolean),
    )
    await page.waitForTimeout(500)
    const n = await rows(page)
    await waitForRows(page, n)
    await page.waitForTimeout(1200)
    const ids = (await db(page, 'counts')).ids
    await db(page, 'delete', ids[1])
    await db(page, 'truncate', ids[2])
    await db(page, 'garble', ids[3])
    await page.reload()
    await waitForRows(page, n - 3)
    await page.waitForTimeout(400)
    const text = await toasts(page)
    t.check(
      'the two good photos are restored',
      (await rows(page)) === n - 3,
      `${await rows(page)} of ${n}`,
    )
    t.check(
      'a toast says how many could not be restored',
      /Could not restore 3 photos/.test(text),
      text.slice(0, 120),
    )
    t.check(
      'and names each with its reason',
      /gone/.test(text) && /incomplete/.test(text) && /damaged/.test(text),
    )
    t.check('one packing run for the rest', (await runs(page)) === 1)
    await page.waitForTimeout(1200)
    const cleaned = await db(page, 'counts')
    t.check(
      'the leftovers are cleared away on the first save',
      cleaned.ids.length === n - 3 && cleaned.listed.length === n - 3,
      JSON.stringify(cleaned.ids.length),
    )
    await addFiles(page, ['photo.jpg'])
    await waitForRows(page, n - 2)
    t.check('the app carries on: photos can still be added', (await rows(page)) === n - 2)
    await app.close()
  }

  // ---- 3. Storage that is not there, blocked, or full: the app works in memory and says so.
  for (const [label, init] of [
    [
      'no IndexedDB at all',
      `Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })`,
    ],
    [
      'IndexedDB that refuses to open (private mode)',
      `indexedDB.open = () => { throw new DOMException('denied', 'SecurityError') }`,
    ],
  ]) {
    const app = await open({ init })
    const { page } = app
    await addFiles(page, ['photo.jpg', 'opaque.png'])
    await waitForRows(page, 2)
    await waitForSettled(page)
    t.check(
      `${label}: the app works and says plainly that work is not saved`,
      /can.t save your work on this device/.test(await notice(page)) &&
        /Nothing is uploaded/.test(await notice(page)),
      await notice(page),
    )
    await page.click('[aria-label="Download PDF"]')
    await page.getByText('Your PDF is ready').waitFor({ timeout: 60000 })
    t.check(`${label}: exporting still works`, true)
    await app.close()
  }
  {
    const app = await open({
      dev: true,
      init:
        watchWorkers() +
        `;(() => { const put = IDBObjectStore.prototype.put; window.__full = false; IDBObjectStore.prototype.put = function (...a) { if (window.__full) throw new DOMException('quota', 'QuotaExceededError'); return put.apply(this, a) } })()`,
    })
    const { page } = app
    await addFiles(page, ['photo.jpg', 'opaque.png', 'gray.jpg'])
    await waitForRows(page, 3)
    await page.waitForTimeout(1000)
    await page.evaluate(() => (window.__full = true))
    await addFiles(page, ['orient-1.jpg', 'orient-2.jpg'])
    await waitForRows(page, 5)
    await page.waitForTimeout(800)
    t.check(
      'a full device: the new photos are listed, the notice says there is no room',
      /no room left/.test(await notice(page)),
      await notice(page),
    )
    t.check('and what was saved before is untouched', (await db(page, 'counts')).ids.length === 3)
    await page.evaluate(() => (window.__full = false))
    await page
      .locator('[data-image-row]')
      .first()
      .getByRole('button', { name: 'More copies' })
      .click()
    await page.waitForTimeout(1200)
    t.check(
      'when room is back the next change saves everything and the notice goes',
      (await db(page, 'counts')).ids.length === 5 && (await notice(page)) === '',
    )
    await page.reload()
    await waitForRows(page, 5)
    t.check('and after a reload all five are back', (await rows(page)) === 5)
    await app.close()
  }

  // ---- 4. Two tabs: one owns the saved work, the other works in memory.
  {
    const app = await open({ dev: true })
    const { page: a, context } = app
    await addFiles(a, ['photo.jpg', 'opaque.png'])
    await waitForRows(a, 2)
    await a.waitForTimeout(1000)
    const b = await context.newPage()
    await b.goto(app.url)
    await b.waitForTimeout(1500)
    t.check(
      'a second tab is told the work is open in another tab',
      /open in another tab/.test(await notice(b)),
      await notice(b),
    )
    t.check('and does not load the saved work', (await rows(b)) === 0)
    await addFiles(b, ['gray.jpg'])
    await waitForRows(b, 1)
    await b.getByRole('button', { name: 'More', exact: true }).click()
    await b.getByRole('menuitem', { name: /Clear all/ }).click()
    await b
      .getByRole('alertdialog')
      .getByRole('button', { name: /Clear all|Remove|Yes/ })
      .last()
      .click()
    await b.waitForTimeout(800)
    t.check(
      'nothing the second tab does reaches the saved work',
      (await db(a, 'counts')).ids.length === 2,
    )
    await b.close()
    await a.reload()
    await waitForRows(a, 2)
    t.check('the first tab still has its work after a reload', (await rows(a)) === 2)
    const c = await context.newPage()
    await c.goto(app.url)
    await c.waitForTimeout(1200)
    t.check(
      'a third tab, while the first is open, is a second tab too',
      /open in another tab/.test(await notice(c)),
    )
    await a.close()
    await c.waitForTimeout(800)
    await c.reload()
    await waitForRows(c, 2)
    t.check(
      'once the owner closes, a reload takes over the saved work',
      (await rows(c)) === 2 && (await notice(c)) === '',
    )
    await app.close()
  }

  // ---- 5. Clear all clears the saved work; Undo of a removal restores its record.
  {
    const app = await open({ dev: true, init: watchWorkers() })
    const { page } = app
    await addFiles(page, ['photo.jpg', 'opaque.png', 'gray.jpg'])
    await waitForRows(page, 3)
    await page.waitForTimeout(1000)
    await page
      .locator('[data-image-row]')
      .nth(1)
      .getByRole('button', { name: /Remove/ })
      .click()
    await page.waitForTimeout(800)
    t.check('removing a photo removes its saved copy', (await db(page, 'counts')).ids.length === 2)
    await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo' }).first().click()
    await page.waitForTimeout(1200)
    const undone = await db(page, 'counts')
    t.check(
      'Undo saves it again, in its old place',
      undone.ids.length === 3 && undone.listed[1] !== undefined,
    )
    await page.reload()
    await waitForRows(page, 3)
    t.check(
      'and a reload brings back all three in order',
      JSON.stringify(await names(page)) === JSON.stringify(['photo.jpg', 'opaque.png', 'gray.jpg']),
      (await names(page)).join(),
    )

    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: /Clear all/ }).click()
    const dialog = page.getByRole('alertdialog')
    t.check(
      'Clear all says it also removes the copy kept on this device',
      /copy kept on this device/.test(await dialog.innerText()),
    )
    await dialog
      .getByRole('button', { name: /Clear all|Remove|Yes/ })
      .last()
      .click()
    await page.waitForTimeout(1000)
    const cleared = await db(page, 'counts')
    t.check(
      'Clear all empties the database: no photos, no list',
      cleared.ids.length === 0 && cleared.listed === null,
      JSON.stringify(cleared),
    )
    await page.reload()
    await page.waitForTimeout(1200)
    t.check(
      'after a reload there is nothing to restore and no flash of "Restoring"',
      (await rows(page)) === 0 &&
        !/Restoring/.test(await page.evaluate(() => document.body.innerText)),
    )
    await app.close()
  }

  // ---- 6. Presets, options and work are independent.
  {
    const app = await open({ dev: true })
    const { page } = app
    await addFiles(page, ['photo.jpg', 'opaque.png'])
    await waitForRows(page, 2)
    await page.waitForTimeout(1000)
    const before = (await store(page)).images.map((i) => [i.id, i.sha])
    await page.evaluate(async () => {
      const { saveCurrentSettings, applyPreset, deleteSavedPreset } =
        await import('/src/features/presets/actions.ts')
      const { presetBook } = await import('/src/store/presets.ts')
      const { useAppStore } = await import('/src/store/index.ts')
      saveCurrentSettings('Labels')
      useAppStore.getState().setOption('margin', 12)
      applyPreset(presetBook.store.getState().presets[0].id)
      useAppStore.getState().resetOptions()
      for (const p of [...presetBook.store.getState().presets]) deleteSavedPreset(p.id)
    })
    await page.waitForTimeout(800)
    await page.reload()
    await waitForRows(page, 2)
    t.check(
      'saving, applying and deleting presets, editing options and resetting them never touch the saved work',
      JSON.stringify((await store(page)).images.map((i) => [i.id, i.sha])) ===
        JSON.stringify(before),
    )
    await app.close()
  }

  // ---- 7. Work saved by a newer version is left alone.
  {
    const app = await open({ dev: true })
    const { page } = app
    await addFiles(page, ['photo.jpg', 'opaque.png'])
    await waitForRows(page, 2)
    await page.waitForTimeout(1000)
    await db(page, 'newer')
    await page.reload()
    await page.waitForTimeout(1200)
    t.check(
      'it is not restored, and the notice says a newer version made it',
      (await rows(page)) === 0 && /newer version/.test(await notice(page)),
      await notice(page),
    )
    await addFiles(page, ['gray.jpg'])
    await waitForRows(page, 1)
    await page.waitForTimeout(1200)
    const left = await db(page, 'counts')
    t.check(
      'and nothing is written over it',
      left.schema === 2 && left.ids.length === 2,
      JSON.stringify(left),
    )
    await app.close()
  }

  // ---- 8. A returning person whose saved work has been cleared is told.
  {
    const app = await open({ init: `localStorage.setItem('sheetfit:work-hint', '9')` })
    const { page } = app
    await page.waitForTimeout(1500)
    t.check(
      'the browser cleared it: a toast says so',
      /saved work is gone/.test(await toasts(page)),
      await toasts(page),
    )
    await app.close()
  }

  // ---- 9. How much is written: a slider drag costs few writes and never rewrites a photo.
  {
    const counter = `;(() => { window.__puts = { images: 0, meta: 0 }; const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { if (this.name in window.__puts) window.__puts[this.name]++; return put.apply(this, a) } })()`
    const app = await open({ init: counter })
    const { page } = app
    await addFiles(page, ['photo.jpg', 'opaque.png', 'gray.jpg'])
    await waitForRows(page, 3)
    await page.waitForTimeout(1500)
    const start = await page.evaluate(() => ({ ...window.__puts }))
    const slider = page.locator('[data-image-row]').first().getByRole('slider').first()
    await slider.focus()
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(1500)
    const end = await page.evaluate(() => ({ ...window.__puts }))
    const d = { images: end.images - start.images, meta: end.meta - start.meta }
    console.log(`  60 size changes: ${d.meta} list write(s), ${d.images} photo write(s)`)
    t.check('60 size changes rewrite no photo', d.images === 0)
    t.check(
      'and far fewer than 60 lists (writes are one at a time and coalesced)',
      d.meta < 60,
      `${d.meta}`,
    )
    t.check(
      'the list that was last written has the last size',
      await page.evaluate(async () => {
        const c = await new Promise((r) => {
          const q = indexedDB.open('sheetfit-work')
          q.onsuccess = () => r(q.result)
        })
        const m = await new Promise((r) => {
          const q = c.transaction('meta').objectStore('meta').get('work')
          q.onsuccess = () => r(q.result)
        })
        c.close()
        return m.items[0].percent > 100
      }),
    )
    await app.close()
  }

  // ---- 10. Persistent storage is asked for once, after something is saved, and a refusal is fine.
  for (const [label, init] of [
    [
      'granted',
      `navigator.storage.persist = () => { window.__persist = (window.__persist ?? 0) + 1; return Promise.resolve(true) }`,
    ],
    [
      'refused',
      `navigator.storage.persist = () => { window.__persist = (window.__persist ?? 0) + 1; return Promise.resolve(false) }`,
    ],
    [
      'missing',
      `Object.defineProperty(navigator.storage, 'persist', { value: undefined, configurable: true })`,
    ],
  ]) {
    const app = await open({ init })
    const { page } = app
    await page.waitForTimeout(500)
    const early = await page.evaluate(() => window.__persist ?? 0)
    await addFiles(page, ['photo.jpg'])
    await waitForRows(page, 1)
    await addFiles(page, ['opaque.png'])
    await waitForRows(page, 2)
    await page.waitForTimeout(1200)
    const calls = await page.evaluate(() => window.__persist ?? 0)
    t.check(
      `persistent storage (${label}): not asked for before anything is saved, and at most once after`,
      early === 0 && (label === 'missing' ? calls === 0 : calls === 1),
      `${early} then ${calls}`,
    )
    t.check(
      `persistent storage (${label}): no error, no notice`,
      app.log.errors.length === 0 && (await notice(page)) === '',
      app.log.errors.join('; '),
    )
    await app.close()
  }

  // ---- 11. Photos added while the saved work is still being restored go after it, nothing lost.
  {
    const app = await open({ init: watchWorkers() })
    const { page } = app
    await prepareGenerated(page, specs(40, 1600, 'old'), 'old')
    await addPrepared(page, 'old')
    await waitForRows(page, 40)
    await page.waitForTimeout(2000)
    await page.reload()
    await page.waitForSelector('input[type=file]', { state: 'attached' })
    await prepareGenerated(page, specs(3, 1200, 'new'), 'new')
    await addPrepared(page, 'new')
    await waitForRows(page, 43)
    const order = await names(page)
    t.check('nothing lost: 40 restored and 3 new', order.length === 43)
    t.check(
      'the restored photos come first, then the new ones',
      order.slice(0, 40).every((n) => n.startsWith('old-')) &&
        order.slice(40).every((n) => n.startsWith('new-')),
      order.slice(38, 43).join(),
    )
    t.check(
      'at most two packing runs, one per batch',
      (await runs(page)) <= 2,
      `${await runs(page)}`,
    )
    await app.close()
  }

  t.done()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
