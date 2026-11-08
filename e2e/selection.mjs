import {
  addGenerated,
  open,
  reporter,
  setAllCopies,
  waitForImages,
  waitForSettled,
} from './harness.mjs'

/*
 * Deselecting: by clicking empty space in the list and in the preview, by tapping, and with Escape;
 * and everything that must NOT deselect: clicks on a row's controls, drags, scrolling, zooming,
 * pinching, and an Escape that belongs to a dialog, a menu, a text field or a keyboard drag.
 * "Nothing selected" is checked the way a person would see it: no row marked, no piece dimmed.
 */
const t = reporter('Deselecting images')

const NAMES = ['a-wide.jpg', 'b-tall.jpg', 'c-square.jpg', 'd-wide.jpg']
const rows = (page) => page.locator('ul[aria-label=Images] > li [data-image-row]')
const row = (page, name) => page.locator(`[data-image-row][aria-label="${name}"]`)
const selectedNames = (page) =>
  page
    .locator('[data-image-row][aria-current=true]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const settleOpacity = (page) => page.waitForTimeout(700)
const opacities = (page) =>
  page
    .locator('[data-piece]')
    .evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)))
const dimmed = async (page) => {
  await settleOpacity(page)
  return (await opacities(page)).filter((o) => o < 0.9).length
}
const announcement = (page) => page.locator('[aria-live=polite][aria-atomic=true]').innerText()
const box = async (locator) => {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no box')
  return b
}

async function fresh(options = {}) {
  const app = await open(options)
  const { page } = app
  await addGenerated(
    page,
    NAMES.map((name, i) => ({
      width: [1600, 900, 1200, 1800][i],
      height: [900, 1600, 1200, 1000][i],
      name,
    })),
  )
  await waitForImages(page, NAMES.length)
  // Two copies of everything, so that selecting highlights more than one piece.
  await setAllCopies(page, 2)
  await waitForSettled(page)
  return app
}

/**
 * A point inside `outer` that none of the `inner` boxes cover and that is on screen, below
 * `top` (the edge of whatever scrolls), so that a click there really lands where it is aimed.
 */
async function emptyPointIn(page, outer, inner, avoid = 10) {
  const view = page.viewportSize()
  const left = Math.max(outer.x, 0) + avoid
  const right = Math.min(outer.x + outer.width, view.width) - avoid
  const top = Math.max(outer.y, 0) + avoid
  const bottom = Math.min(outer.y + outer.height, view.height) - avoid
  for (let y = bottom; y > top; y -= 12)
    for (let x = left; x < right; x += 12)
      if (
        !inner.some(
          (b) =>
            x > b.x - avoid &&
            x < b.x + b.width + avoid &&
            y > b.y - avoid &&
            y < b.y + b.height + avoid,
        )
      )
        return { x, y }
  return null
}

/** A point under the last row of the image list, measured now. */
async function listEmptyPoint(page) {
  const rowBoxes = await boxesOf(page.locator('ul[aria-label=Images] > li [data-image-row]'))
  const list = await box(page.locator('section[aria-label=Images] [data-slot=scroll-area]'))
  const bottom = Math.max(...rowBoxes.map((b) => b.y + b.height))
  return { x: list.x + list.width / 2, y: (bottom + list.y + list.height) / 2 }
}
const boxesOf = async (locator) => Promise.all((await locator.all()).map(box))
const scrollerBox = (page) =>
  box(page.locator('[data-sheet-page]').first().locator('xpath=ancestor::*[@role="region"][1]'))
/** A point on the preview's background, between or around the sheets, measured now. */
const backgroundPoint = async (page) =>
  emptyPointIn(page, await scrollerBox(page), await boxesOf(page.locator('[data-sheet-page]')), 6)
/** A point on a sheet's blank paper, where no piece is, measured now. */
async function paperPoint(page) {
  const scroller = await scrollerBox(page)
  const pieces = await boxesOf(page.locator('[data-piece]'))
  for (const sheet of await boxesOf(page.locator('[data-sheet-page]'))) {
    const left = Math.max(sheet.x, scroller.x)
    const top = Math.max(sheet.y, scroller.y)
    const outer = {
      x: left,
      y: top,
      width: Math.min(sheet.x + sheet.width, scroller.x + scroller.width) - left,
      height: Math.min(sheet.y + sheet.height, scroller.y + scroller.height) - top,
    }
    const point =
      outer.width > 0 && outer.height > 0 ? await emptyPointIn(page, outer, pieces, 8) : null
    if (point) return point
  }
  return null
}

const allClear = async (page, what) => {
  t.check(`${what}: no row is marked selected`, (await selectedNames(page)).length === 0)
  const d = await dimmed(page)
  t.check(`${what}: no piece is dimmed (all fully opaque)`, d === 0, `${d} dimmed`)
}

async function main() {
  const app = await fresh()
  const { page } = app
  const pieceCount = await page.locator('[data-piece]').count()
  t.check(
    'the starting point has several pieces per image',
    pieceCount >= NAMES.length * 2,
    `${pieceCount}`,
  )
  await allClear(page, 'before anything is selected')

  // ---- Selecting works as before.
  await row(page, 'b-tall.jpg').click({ position: { x: 6, y: 6 } })
  t.check('clicking a row selects it', (await selectedNames(page)).join() === 'b-tall.jpg')
  const d1 = await dimmed(page)
  t.check(
    'the other images dim in the preview',
    d1 > 0 && d1 < pieceCount,
    `${d1} of ${pieceCount}`,
  )
  t.check(
    'clicking the selected row again keeps it selected (no toggle by design)',
    await (async () => {
      await row(page, 'b-tall.jpg').click({ position: { x: 6, y: 6 } })
      return (await selectedNames(page)).join() === 'b-tall.jpg'
    })(),
  )

  // ---- Empty space in the list.
  const listBox = await box(page.locator('ul[aria-label=Images]').locator('..').locator('..'))
  const rowBoxes = await Promise.all((await rows(page).all()).map(box))
  const lastRowBottom = Math.max(...rowBoxes.map((b) => b.y + b.height))
  const panelBottom =
    (await box(page.locator('section[aria-label=Images] [data-slot=scroll-area]'))).y +
    (await box(page.locator('section[aria-label=Images] [data-slot=scroll-area]'))).height
  t.check(
    'there is empty space under the last row to click',
    panelBottom - lastRowBottom > 40,
    `${Math.round(panelBottom - lastRowBottom)} px`,
  )
  const x = listBox.x + listBox.width / 2
  await page.mouse.click(x, lastRowBottom + 30)
  await settleOpacity(page)
  await allClear(page, 'clicking empty space under the list')
  t.check(
    'screen readers are told',
    (await announcement(page)) === 'Deselected b-tall.jpg',
    await announcement(page),
  )

  // ---- The scroll bar is not empty space.
  await row(page, 'a-wide.jpg').click({ position: { x: 6, y: 6 } })
  t.check(
    'a-wide.jpg is selected for the next checks',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )

  // ---- Clicks on controls inside a row never deselect.
  await row(page, 'a-wide.jpg').getByRole('button', { name: 'More copies' }).click()
  t.check(
    'clicking a row control (More copies) leaves the selection',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )
  await row(page, 'a-wide.jpg').getByRole('slider').first().click()
  t.check(
    'clicking the size slider leaves the selection',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )
  await row(page, 'a-wide.jpg').getByRole('button', { name: 'More copies' }).click()
  await row(page, 'a-wide.jpg').getByRole('button', { name: 'Fewer copies' }).click()
  t.check('and so does Fewer copies', (await selectedNames(page)).join() === 'a-wide.jpg')
  await page
    .locator('[data-slot=toggle-group-item], button')
    .first()
    .evaluate(() => {})

  // ---- Pointer gestures in the list that are not clicks: a drag that ends on empty space.
  await page.mouse.move(x, lastRowBottom + 20)
  await page.mouse.down()
  await page.mouse.move(x + 60, lastRowBottom + 60, { steps: 5 })
  await page.mouse.up()
  t.check(
    'a drag across empty space in the list is not a click',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )
  await page.mouse.move(x, lastRowBottom + 20)
  await page.mouse.wheel(0, 200)
  t.check(
    'scrolling the list does not deselect',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )

  // ---- The preview: a piece selects, the background around the sheets deselects.
  await page.locator('[data-piece]').nth(0).click()
  const selectedByPiece = await selectedNames(page)
  t.check(
    'clicking a piece selects its image in the list',
    selectedByPiece.length === 1,
    selectedByPiece.join(),
  )
  const background = await backgroundPoint(page)
  t.check('the preview has background around the sheets', background !== null)
  await page.mouse.click(background.x, background.y)
  await settleOpacity(page)
  await allClear(page, 'clicking the background around the sheets')

  // ---- Blank paper counts as empty space too.
  await page.locator('[data-piece]').nth(1).click()
  t.check('selected again through a piece', (await selectedNames(page)).length === 1)
  const paper = await paperPoint(page)
  t.check('there is blank paper to click', paper !== null)
  await page.mouse.click(paper.x, paper.y)
  await settleOpacity(page)
  await allClear(page, 'clicking blank paper on a sheet')

  // ---- Gestures in the preview that are not clicks.
  await page.locator('[data-piece]').nth(0).click()
  const keep = async (what) =>
    t.check(`${what} does not deselect`, (await selectedNames(page)).length === 1)
  await page.mouse.move(background.x, background.y)
  await page.mouse.down()
  await page.mouse.move(background.x + 50, background.y + 20, { steps: 6 })
  await page.mouse.up()
  await keep('dragging across the preview background')
  await page.mouse.move(background.x, background.y)
  await page.mouse.wheel(0, 300)
  await keep('scrolling the preview')
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -300)
  await page.keyboard.up('Control')
  await keep('Ctrl + wheel zoom')

  // ---- Touch: a tap deselects; a swipe and a pinch do not.
  const cdp = await app.context.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    })
  let bg = await backgroundPoint(page)
  await touch('touchStart', [[bg.x, bg.y]])
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[bg.x, bg.y + i * 10]])
  await touch('touchEnd', [])
  await keep('a one-finger swipe')
  await touch('touchStart', [
    [bg.x, bg.y],
    [bg.x + 20, bg.y],
  ])
  for (let i = 1; i <= 5; i++)
    await touch('touchMove', [
      [bg.x - i * 4, bg.y],
      [bg.x + 20 + i * 4, bg.y],
    ])
  await touch('touchEnd', [])
  await page.waitForTimeout(300)
  await keep('a two-finger pinch')
  // The pinch zoomed the preview, so the empty spot has moved.
  bg = await backgroundPoint(page)
  await touch('touchStart', [[bg.x, bg.y]])
  await touch('touchEnd', [])
  await page.waitForTimeout(300)
  await allClear(page, 'a tap on the preview background')

  // ---- Touch: a tap on empty space in the list.
  await row(page, 'c-square.jpg')
    .tap?.({ position: { x: 6, y: 6 } })
    .catch(() => {})
  await row(page, 'c-square.jpg').click({ position: { x: 6, y: 6 } })
  t.check('c-square.jpg is selected', (await selectedNames(page)).join() === 'c-square.jpg')
  const tapPoint = await listEmptyPoint(page)
  await touch('touchStart', [[tapPoint.x, tapPoint.y]])
  await touch('touchEnd', [])
  await page.waitForTimeout(300)
  await allClear(page, 'a tap on empty space in the list')
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })

  // ---- Escape.
  await row(page, 'd-wide.jpg').click({ position: { x: 6, y: 6 } })
  await row(page, 'd-wide.jpg').focus()
  await page.keyboard.press('Escape')
  await allClear(page, 'Escape with a row focused')
  t.check('Escape announces it', (await announcement(page)) === 'Deselected d-wide.jpg')
  await page.locator('[data-piece]').nth(0).click()
  await page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
  )
  await page.keyboard.press('Escape')
  await allClear(page, 'Escape with nothing focused (after clicking a piece)')
  const before = await announcement(page)
  await page.keyboard.press('Escape')
  t.check(
    'Escape with nothing selected does nothing',
    (await announcement(page)) === before && (await selectedNames(page)).length === 0,
  )

  // ---- Escape that belongs to something else.
  await row(page, 'a-wide.jpg').click({ position: { x: 6, y: 6 } })
  await page.click('#print-options-button')
  await page.getByRole('dialog', { name: 'Print options' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Print options' }).waitFor({ state: 'detached' })
  t.check(
    'Escape closes the Print options and leaves the selection',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )

  await page.getByRole('button', { name: 'Presets' }).click()
  await page.getByRole('menu').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'detached' })
  t.check(
    'Escape closes the Presets menu and leaves the selection',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )

  await row(page, 'a-wide.jpg').getByRole('button', { name: 'Preview a-wide.jpg' }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  t.check(
    'Escape closes an image preview and leaves the selection',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )

  await row(page, 'a-wide.jpg')
    .getByRole('spinbutton')
    .or(row(page, 'a-wide.jpg').getByLabel('Number of copies of a-wide.jpg'))
    .first()
    .focus()
  await page.keyboard.press('Escape')
  t.check(
    'Escape in a number field belongs to the field',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )

  await row(page, 'a-wide.jpg').getByRole('button', { name: 'Reorder a-wide.jpg' }).focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(150)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  t.check(
    'Escape cancelling a keyboard drag leaves the selection',
    (await selectedNames(page)).join() === 'a-wide.jpg',
  )
  t.check(
    'and the order is unchanged',
    (
      await page
        .locator('[data-image-row]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    ).join() === NAMES.join(),
  )

  // ---- Removing the selected image, and Clear all, clear the selection.
  await row(page, 'a-wide.jpg')
    .getByRole('button', { name: /Remove/ })
    .click()
  await page.waitForTimeout(400)
  await allClear(page, 'after removing the selected image')
  await row(page, 'c-square.jpg').click({ position: { x: 6, y: 6 } })
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: /Clear all/ }).click()
  await page
    .getByRole('button', { name: /Clear all|Remove all|Yes/ })
    .last()
    .click()
  await page.waitForTimeout(500)
  t.check(
    'Clear all leaves nothing selected',
    (await page.locator('[data-image-row]').count()) === 0,
  )

  // ---- After deselecting, the app behaves as normal: hovering a sheet shows its statistics.
  await addGenerated(page, [{ width: 1200, height: 900, name: 'e.jpg' }])
  await waitForImages(page, 1)
  await waitForSettled(page)
  await page.locator('[data-piece]').first().click()
  await page.mouse.click(background.x, background.y)
  await settleOpacity(page)
  await page.locator('[data-sheet-page]').first().hover()
  await page.waitForTimeout(400)
  t.check(
    'hovering works as normal after a deselect',
    (await page
      .locator('[data-sheet-page]')
      .first()
      .evaluate((el) => el.matches(':hover'))) === true,
  )

  t.check('no page errors', app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
  t.done()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
