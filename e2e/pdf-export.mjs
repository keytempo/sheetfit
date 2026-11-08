import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addFiles,
  addGenerated,
  fixture,
  open,
  reporter,
  setAllCopies,
  waitForImages,
  waitForSettled,
} from './harness.mjs'

/*
 * Exports real PDFs from the production build and checks them with tools that share no code with
 * the exporter: qpdf, pdfinfo, pdfimages and pdftoppm (poppler), and ImageMagick. Needs them on PATH.
 */
const test = reporter('PDF export in a real browser, checked with independent tools')
const work = mkdtempSync(join(tmpdir(), 'sheetfit-pdf-'))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: options.raw ? 'buffer' : 'utf8', maxBuffer: 1 << 29 })
const have = (command) => spawnSync('which', [command]).status === 0
for (const tool of ['qpdf', 'pdfinfo', 'pdfimages', 'pdftoppm', 'convert']) {
  if (!have(tool)) throw new Error(`${tool} is needed for this check`)
}

const VALID = [
  ...Array.from({ length: 8 }, (_, i) => `orient-${i + 1}.jpg`),
  'photo.jpg',
  'progressive.jpg',
  'gray.jpg',
  'cmyk.jpg',
  'icc-p3.jpg',
  'opaque.png',
  'photo.png',
  'gray-rgb.png',
  'gray.png',
  'palette.png',
  'interlaced.png',
  'opaque-rgba.png',
  'alpha.png',
  'alpha.webp',
  'photo.webp',
  'lossless.webp',
  'photo.gif',
  'photo.avif',
  'photo.bmp',
]
const JPEGS = VALID.filter((name) => name.endsWith('.jpg'))
const optionsJson = (options) =>
  JSON.stringify({
    state: {
      options: { showMargins: false, showSheetNumbers: false, ordering: 'strict', ...options },
      panelLayout: {},
    },
    version: 1,
  })

/**
 * Presses Download PDF in the header, waits for the dialog to say the PDF is ready, and then presses
 * Download PDF in the dialog, which is the only thing that saves the file. Returns what the dialog said.
 */
async function download(page, name) {
  await page.click('[aria-label="Download PDF"]')
  await page.getByText('Your PDF is ready').waitFor({ timeout: 120000 })
  const text = await page.locator('[role=dialog]').innerText()
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('[role=dialog]').getByRole('button', { name: 'Download PDF' }).click(),
  ])
  const path = join(work, name)
  await file.saveAs(path)
  return { path, bytes: readFileSync(path), filename: file.suggestedFilename(), dialog: text }
}

/** Colour samples at the four quarter points of every piece's footprint, from a raster. */
function sample(raw, width, boxes) {
  return boxes.flatMap((box) =>
    [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ].map(([u, v]) => {
      const x = Math.round(box.left + u * box.width)
      const y = Math.round(box.top + v * box.height)
      const at = (y * width + x) * 3
      return [raw[at], raw[at + 1], raw[at + 2]]
    }),
  )
}

// ---------------------------------------------------------------------------------------------
// 1. Every supported kind of file, two copies of each.
{
  const app = await open({ storage: optionsJson({}) })
  const { page } = app
  await addFiles(page, [...VALID, 'not-an-image.png', 'corrupt.jpg'])
  await waitForImages(page, VALID.length)
  await page.waitForTimeout(1500)
  test.check(
    'both undecodable files were refused with a message',
    (await page.locator('[data-sonner-toast]').count()) >= 2,
  )
  await setAllCopies(page, 2)
  await waitForSettled(page)
  await page.waitForTimeout(400)

  const sheetCount = await page.locator('[data-sheet-page]').count()
  const geometry = await page.evaluate(() =>
    [...document.querySelectorAll('[data-sheet-page]')].map((sheet) => {
      const r = sheet.getBoundingClientRect()
      return {
        width: r.width,
        height: r.height,
        pieces: [...sheet.querySelectorAll('.group\\/piece')].map((el) => ({
          left: (parseFloat(el.style.left) / 100) * r.width,
          top: (parseFloat(el.style.top) / 100) * r.height,
          width: (parseFloat(el.style.width) / 100) * r.width,
          height: (parseFloat(el.style.height) / 100) * r.height,
        })),
      }
    }),
  )
  const pieceCount = geometry.reduce((sum, sheet) => sum + sheet.pieces.length, 0)
  // The sheets are photographed before the dialog opens, so nothing covers them.
  for (let s = 0; s < sheetCount; s++) {
    await page
      .locator('[data-sheet-page]')
      .nth(s)
      .screenshot({ path: join(work, `preview-${s}.png`) })
  }

  const first = await download(page, 'all.pdf')
  test.check(
    `the download has the real name (${first.filename}) and the dialog shows its real size`,
    /^sheetfit-\d{4}-\d{2}-\d{2}\.pdf$/.test(first.filename) &&
      first.dialog.includes(first.filename),
  )
  const shown = /([\d.]+) (B|KB|MB)/.exec(first.dialog)
  const shownBytes = shown ? Number(shown[1]) * { B: 1, KB: 1024, MB: 1024 ** 2 }[shown[2]] : 0
  test.check(
    'the size the dialog shows matches the file on disk',
    Math.abs(shownBytes - first.bytes.length) / first.bytes.length < 0.02,
    `${shown?.[0]} vs ${first.bytes.length} bytes`,
  )

  const check = spawnSync('qpdf', ['--check', first.path], { encoding: 'utf8' })
  test.check(
    'qpdf --check finds no syntax or stream errors',
    check.status === 0 && /No syntax or stream encoding errors/.test(check.stdout + check.stderr),
    (check.stdout + check.stderr).trim().split('\n').slice(-2).join(' / '),
  )
  const info = run('pdfinfo', [first.path])
  test.check(
    `pdfinfo: ${sheetCount} pages, A4 in points, PDF 1.7`,
    new RegExp(`Pages:\\s+${sheetCount}\\b`).test(info) &&
      /Page size:\s+595\.276 x 841\.89 pts/.test(info) &&
      /PDF version:\s+1\.7/.test(info),
    info
      .split('\n')
      .filter((l) => /Pages|Page size|PDF version/.test(l))
      .join('; '),
  )

  // Images: one per unique file, JPEGs byte for byte.
  const list = run('pdfimages', ['-list', first.path]).split('\n').slice(2).filter(Boolean)
  const plain = list.filter((row) => !/\smask\s|\ssmask\s/.test(row))
  const ids = new Set(list.map((row) => row.trim().split(/\s+/)[10]))
  test.check(
    `${VALID.length} different files are in the PDF exactly ${VALID.length} times, not once per copy (${pieceCount} pieces)`,
    ids.size >= VALID.length &&
      new Set(plain.map((r) => r.trim().split(/\s+/)[10])).size === VALID.length,
    `${ids.size} image objects`,
  )
  const extracted = join(work, 'extracted')
  run('mkdir', ['-p', extracted])
  run('pdfimages', ['-all', first.path, join(extracted, 'img')])
  const jpegShas = new Set(
    readdirSync(extracted)
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => sha(readFileSync(join(extracted, f)))),
  )
  const missing = JPEGS.filter((name) => !jpegShas.has(sha(readFileSync(fixture(name)))))
  test.check(
    `all ${JPEGS.length} JPEG streams are byte-identical to their source files (gray, RGB, CMYK, ICC, progressive, 8 orientations)`,
    missing.length === 0,
    missing.join(', '),
  )
  const dctKinds = run('pdfimages', ['-list', first.path])
    .split('\n')
    .filter((l) => /jpeg/.test(l)).length
  test.check(
    'JPEG sources are stored with the DCT filter and nothing re-encoded',
    dctKinds >= JPEGS.length,
  )

  const raw = (path) => run('convert', [path, 'rgb:-'], { raw: true })

  // Lossless Flate images decode to exactly the source pixels, checked against ImageMagick's own decoder.
  const rasters = readdirSync(extracted).filter((f) => /\.(png|pbm|pgm|ppm)$/.test(f))
  test.check(
    'lossless images were extracted as PNG/PNM by an independent reader',
    rasters.length >= 5,
    `${rasters.length} files`,
  )
  const sourceRaw = (name) =>
    run('convert', [fixture(name), '-alpha', 'off', 'rgb:-'], { raw: true })
  const pdfShas = new Set()
  for (const f of readdirSync(extracted)) {
    if (!/\.(png|pbm|pgm|ppm)$/.test(f)) continue
    pdfShas.add(
      sha(
        run(
          'convert',
          [join(extracted, f), '-alpha', 'off', '-depth', '8', '-colorspace', 'sRGB', 'rgb:-'],
          { raw: true },
        ),
      ),
    )
  }
  for (const name of [
    'opaque.png',
    'photo.png',
    'gray-rgb.png',
    'gray.png',
    'opaque-rgba.png',
    'palette.png',
    'interlaced.png',
    'lossless.webp',
    'photo.bmp',
    'alpha.png',
  ]) {
    test.check(
      `${name}: the pixels in the PDF equal the source file's pixels`,
      pdfShas.has(
        sha(
          run(
            'convert',
            [fixture(name), '-alpha', 'off', '-depth', '8', '-colorspace', 'sRGB', 'rgb:-'],
            { raw: true },
          ),
        ),
      ),
    )
  }
  void sourceRaw

  // The PDF looks like the preview: same pieces, same places, same rotations, same orientation.
  let compared = 0
  let off = 0
  let worst = 0
  for (let s = 0; s < sheetCount; s++) {
    const g = geometry[s]
    const width = Math.round(g.width)
    const height = Math.round(g.height)
    const shot = join(work, `preview-${s}.png`)
    const ppm = join(work, `pdf-${s}`)
    run('pdftoppm', [
      '-png',
      '-f',
      String(s + 1),
      '-l',
      String(s + 1),
      '-scale-to-x',
      String(width),
      '-scale-to-y',
      String(height),
      '-singlefile',
      first.path,
      ppm,
    ])
    const a = sample(
      run('convert', [shot, '-resize', `${width}x${height}!`, 'rgb:-'], { raw: true }),
      width,
      g.pieces,
    )
    const b = sample(run('convert', [`${ppm}.png`, 'rgb:-'], { raw: true }), width, g.pieces)
    for (const [i, c] of a.entries()) {
      const d = Math.max(...c.map((v, k) => Math.abs(v - b[i][k])))
      worst = Math.max(worst, d)
      compared += 1
      if (d > 70) {
        off += 1
        const piece = g.pieces[Math.floor(i / 4)]
        console.log(
          `  differs: sheet ${s + 1} piece ${Math.floor(i / 4)} (${Math.round(piece.width)}x${Math.round(piece.height)} px) quarter ${i % 4}: preview ${c} pdf ${b[i]}`,
        )
      }
    }
  }
  test.check(
    `the PDF raster matches the preview at ${compared} sample points over ${pieceCount} pieces`,
    off / compared < 0.02,
    `${off} points differ by more than 70/255, worst ${worst}`,
  )

  // Determinism: the same export again gives the same bytes.
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForTimeout(400)
  const second = await download(page, 'all-again.pdf')
  test.check(
    'exporting the same sheets twice gives byte-identical files',
    sha(first.bytes) === sha(second.bytes),
    `${first.bytes.length} vs ${second.bytes.length}`,
  )
  await page.getByRole('button', { name: 'Done' }).click()

  test.check(
    'only same-origin requests (the page and its own blob: URLs)',
    app.log.requests.every(
      (u) => u.startsWith(app.url) || u.startsWith('blob:') || u.startsWith('data:'),
    ),
    app.log.requests
      .filter((u) => !u.startsWith(app.url) && !u.startsWith('blob:') && !u.startsWith('data:'))
      .join(' '),
  )
  test.check('no page errors', app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
}

// ---------------------------------------------------------------------------------------------
// 1b. A wide-gamut WebP is stored as the sRGB picture the preview shows, not as raw P3 numbers.
{
  const app = await open({ storage: optionsJson({}) })
  const { page } = app
  await addFiles(page, ['p3.webp'])
  await waitForImages(page, 1)
  await page.waitForTimeout(700)
  const file = await download(page, 'p3.pdf')
  const dir = join(work, 'p3')
  run('mkdir', ['-p', dir])
  run('pdfimages', ['-png', file.path, join(dir, 'img')])
  const raw = run('convert', [join(dir, readdirSync(dir)[0]), 'rgb:-'], { raw: true })
  const at = (x, y) => [...raw.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)]
  const wanted = [
    [255, 0, 0],
    [0, 255, 0],
    [200, 100, 50],
    [10, 20, 30],
  ]
  const got = [at(16, 16), at(48, 16), at(16, 48), at(48, 48)]
  const worst = Math.max(...got.flatMap((c, i) => c.map((v, k) => Math.abs(v - wanted[i][k]))))
  test.check(
    'a Display P3 WebP is stored as its sRGB colours, the colours the preview shows',
    worst <= 3,
    `got ${got.map((c) => c.join(',')).join(' | ')}`,
  )
  await app.close()
}

// ---------------------------------------------------------------------------------------------
// 2. Orientation, placement and cut guides, looked at pixel by pixel at high resolution.
{
  const app = await open({ storage: optionsJson({ cutGuides: true, gap: 4, orientation: 'auto' }) })
  const { page } = app
  await addFiles(page, ['orient-6.jpg', 'orient-3.jpg', 'opaque.png'])
  await waitForImages(page, 3)
  await page.waitForTimeout(800)
  await setAllCopies(page, 2)
  await waitForSettled(page)
  const guided = await download(page, 'guides.pdf')
  const qdf = join(work, 'guides.qdf')
  run('qpdf', ['--qdf', '--object-streams=disable', guided.path, qdf])
  const content = readFileSync(qdf, 'latin1')
  const rects = (content.match(/ re\n/g) ?? []).length
  test.check(
    'cut guides: one hairline rectangle is drawn per piece',
    rects === 6 && /0\.25 w/.test(content),
    `${rects} rectangles`,
  )
  test.check(
    'nothing but images and guides is on the page (no text, no fonts)',
    !/\/Font|BT\n/.test(content),
  )
  await page.getByRole('button', { name: 'Done' }).click()
  await app.close()
}

// ---------------------------------------------------------------------------------------------
// 3. Twenty copies cost about one; a table against a naive writer that repeats the image.
{
  const rows = []
  for (const [label, type, size] of [
    ['JPEG photo (2400 x 1600)', 'image/jpeg', [2400, 1600]],
    ['PNG photo (1200 x 800)', 'image/png', [1200, 800]],
  ]) {
    // A small print size, so that all twenty copies fit on one sheet and only the copies differ.
    const sizes = {}
    for (const copies of [1, 20]) {
      const app = await open({ storage: optionsJson({ baseMode: 'width', baseLength: 30 }) })
      const { page } = app
      await addGenerated(page, [
        {
          width: size[0],
          height: size[1],
          type,
          quality: 0.9,
          name: type === 'image/png' ? 'one.png' : 'one.jpg',
        },
      ])
      await waitForImages(page, 1)
      await page.waitForTimeout(800)
      await setAllCopies(page, copies)
      await waitForSettled(page)
      const file = await download(page, `${copies}-${type.slice(6)}.pdf`)
      sizes[copies] = file.bytes.length
      await app.close()
    }
    rows.push({
      file: label,
      '1 copy (bytes)': sizes[1],
      '20 copies (bytes)': sizes[20],
      'extra per copy (bytes)': Math.round((sizes[20] - sizes[1]) / 19),
      'naive 20 x one copy (bytes)': sizes[1] * 20,
      'saved vs naive': `${Math.round((1 - sizes[20] / (sizes[1] * 20)) * 100)}%`,
    })
    test.check(
      `${label}: twenty copies cost about one`,
      sizes[20] < sizes[1] * 1.05 + 2000,
      `${sizes[1]} -> ${sizes[20]}`,
    )
  }
  console.table(rows)
}

// ---------------------------------------------------------------------------------------------
// 4. A hundred different photos.
{
  const app = await open({ storage: optionsJson({}) })
  const { page } = app
  await addGenerated(
    page,
    Array.from({ length: 100 }, (_, i) => ({
      width: 640 + (i % 7) * 20,
      height: 420 + (i % 5) * 30,
      name: `p${String(i).padStart(3, '0')}.jpg`,
    })),
  )
  await waitForImages(page, 100, 120000)
  await page.waitForTimeout(2000)
  await waitForSettled(page)
  const started = Date.now()
  const file = await download(page, 'hundred.pdf')
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  const check = spawnSync('qpdf', ['--check', file.path], { encoding: 'utf8' })
  const list = run('pdfimages', ['-list', file.path]).split('\n').slice(2).filter(Boolean)
  const pages = Number(/Pages:\s+(\d+)/.exec(run('pdfinfo', [file.path]))[1])
  test.check(
    `100 photos: valid PDF, ${pages} pages, 100 images, written in ${seconds} s`,
    check.status === 0 && list.length === 100,
    `${list.length} images`,
  )
  await app.close()
}

// ---------------------------------------------------------------------------------------------
// 5. One 50 megapixel photo: progress is real, cancelling stops the work, completing works.
{
  const app = await open({ storage: optionsJson({}) })
  const { page } = app
  await addGenerated(page, [
    { width: 7071, height: 7071, type: 'image/png', name: 'huge-50mp.png' },
  ])
  await waitForImages(page, 1, 180000)
  await page.waitForTimeout(3000)
  const workersBefore = page.workers().length

  // Cancel in the middle of the work.
  await page.click('[aria-label="Download PDF"]')
  await page.getByText(/Embedding photo 1 of 1/).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  let downloaded = false
  page.once('download', () => (downloaded = true))
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(6000)
  test.check('Cancel stops the export: no file is downloaded', !downloaded)
  test.check(
    'and the export worker is gone',
    page.workers().length <= workersBefore,
    `${page.workers().length} workers`,
  )
  test.check('and the dialog is closed', (await page.locator('[role=dialog]').count()) === 0)

  // Now let it finish, watching the progress.
  const fractions = new Set()
  const labels = new Set()
  const watcher = setInterval(async () => {
    const value = await page
      .locator('[role=progressbar]')
      .first()
      .getAttribute('aria-valuenow')
      .catch(() => null)
    const label = await page
      .locator('[role=dialog] [aria-live=polite]')
      .first()
      .innerText()
      .catch(() => null)
    if (value) fractions.add(Math.round(Number(value)))
    if (label) labels.add(label)
  }, 250)
  const started = Date.now()
  const file = await download(page, 'huge.pdf')
  clearInterval(watcher)
  const check = spawnSync('qpdf', ['--check', file.path], { encoding: 'utf8' })
  test.check(
    `50 MP photo: a valid PDF (${(file.bytes.length / 1048576).toFixed(1)} MB) in ${((Date.now() - started) / 1000).toFixed(0)} s, tab alive`,
    check.status === 0 && file.bytes.length > 1000,
  )
  test.check(
    'progress moved in real steps while it worked',
    fractions.size >= 3 && labels.size >= 1,
    `values ${[...fractions].sort((a, b) => a - b).join(',')}; ${[...labels].join(' / ')}`,
  )
  test.check('no page errors', app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
}

// ---------------------------------------------------------------------------------------------
// 6. A failure shows a real message and Try again works.
{
  const app = await open({
    storage: optionsJson({}),
    init: `(() => {
      const Original = window.Worker
      let exports = 0
      window.Worker = class extends Original {
        constructor(url, options) {
          if (String(url).includes('export.worker') && exports++ === 0) {
            super('data:text/javascript,postMessage({type:"failed",message:"Could not read broken.jpg. The file may have been moved or deleted."})', options)
          } else super(url, options)
        }
      }
    })()`,
  })
  const { page } = app
  await addFiles(page, ['photo.jpg'])
  await waitForImages(page, 1)
  await page.waitForTimeout(600)
  await page.click('[aria-label="Download PDF"]')
  await page.getByText('The export didn’t finish').waitFor({ timeout: 10000 })
  test.check(
    'a failed export says what went wrong, in words',
    (await page.locator('[role=alert]').innerText()).includes('Could not read broken.jpg'),
  )
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.getByText('Your PDF is ready').waitFor({ timeout: 30000 })
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('[role=dialog]').getByRole('button', { name: 'Download PDF' }).click(),
  ])
  test.check(
    'Try again runs the export again and it succeeds',
    (await file.failure()) === null && (await page.getByText('Your PDF is ready').count()) >= 0,
  )
  await app.close()
}

// ---------------------------------------------------------------------------------------------
// 7. Copies that fit on no sheet: the notice, and a PDF of the placed ones with the omission said.
// The app's size limit keeps this from happening, so the packer's answers are rewritten in the page:
// the last piece moves from its sheet to the unplaceable list. Everything after that is the real app.
{
  const app = await open({
    storage: optionsJson({}),
    init: `(() => {
      const O = window.Worker
      window.Worker = class extends O {
        constructor(u, o) {
          super(u, o)
          if (!String(u).includes('packing.worker')) return
          const add = this.addEventListener.bind(this)
          this.addEventListener = (type, listener, ...rest) => {
            if (type !== 'message') return add(type, listener, ...rest)
            return add(type, (event) => {
              const data = event.data
              if (data && data.layout && data.layout.sheets.length) {
                const layout = { ...data.layout, sheets: data.layout.sheets.map((sheet) => [...sheet]), unplaceable: [...data.layout.unplaceable] }
                const last = layout.sheets.findLast((sheet) => sheet.length)
                layout.unplaceable.push({ index: last.pop().index, reason: 'too-large' })
                return listener({ data: { ...data, layout } })
              }
              return listener(event)
            }, ...rest)
          }
        }
      }
    })()`,
  })
  const { page } = app
  await addFiles(page, ['photo.jpg', 'opaque.png', 'gray.jpg'])
  await waitForImages(page, 3)
  await page.waitForTimeout(800)
  await setAllCopies(page, 2)
  await waitForSettled(page)
  await page.waitForTimeout(500)
  const badge = await page.locator('[role=status], .bg-card\\/85').allInnerTexts()
  test.check(
    'the notice says how many copies do not fit',
    badge.some((t) => /1 copy does not fit on the sheet/.test(t)),
    badge.join(' | '),
  )
  const drawn = await page.locator('.group\\/piece').count()
  test.check('the preview draws the placed copies only (6 minus 1)', drawn === 5, `${drawn} drawn`)
  const file = await download(page, 'omitted.pdf')
  test.check(
    'the dialog says one copy was left out of the PDF',
    /1 copy did not fit on the sheet and was left out of the PDF/.test(file.dialog),
    file.dialog.replace(/\n+/g, ' | '),
  )
  const qdf = join(work, 'omitted.qdf')
  run('qpdf', ['--qdf', '--object-streams=disable', file.path, qdf])
  const placements = (readFileSync(qdf, 'latin1').match(/\/Im\d+ Do/g) ?? []).length
  test.check(
    'and the PDF holds exactly the placed copies',
    placements === 5,
    `${placements} placements`,
  )
  await app.close()
}

console.log(`files in ${work}`)
test.done()
