import {
  addGenerated,
  open,
  reporter,
  setAllCopies,
  startFrameLog,
  stopFrameLog,
  waitForImages,
  waitForSettled,
} from './harness.mjs'

/*
 * Drives the production build with 100, 500 and 2000 pieces: a slider drag, a burst of option
 * changes and a "cancel storm" (many changes without waiting for the packer). It reports main-thread
 * long tasks (50 ms or more) and animation frame gaps, and checks that the page ends in a settled,
 * consistent state with no errors.
 */
const SIZES = process.argv[2] ? [Number(process.argv[2])] : [100, 500, 2000]
const PHOTOS = [
  [3000, 2000],
  [2000, 3000],
  [2400, 2400],
  [4000, 1800],
  [1500, 2250],
  [3000, 2400],
  [1800, 1800],
  [2800, 1900],
]

const test = reporter('Responsiveness under real packing')
const table = []

for (const pieces of SIZES) {
  const app = await open()
  const { page } = app
  await addGenerated(
    page,
    PHOTOS.map(([width, height], i) => ({
      width: width / 4,
      height: height / 4,
      name: `photo-${i}.jpg`,
    })),
  )
  await waitForImages(page, PHOTOS.length)
  await page.waitForTimeout(1200)

  await startFrameLog(page)
  await setAllCopies(page, Math.round(pieces / PHOTOS.length))
  await waitForSettled(page)
  table.push({ pieces, scenario: 'set copies, first result', ...(await stopFrameLog(page)) })

  // Drag the first image's size slider.
  const slider = page.locator('[role=slider]').first()
  await slider.focus()
  await startFrameLog(page)
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
  await waitForSettled(page)
  table.push({ pieces, scenario: 'slider drag, 30 steps', ...(await stopFrameLog(page)) })

  // A burst of option changes: margin slider and the rotation switch.
  await page.click('#print-options-button')
  await page.waitForTimeout(500)
  const margin = page.locator('[role=dialog] [role=slider]').first()
  await margin.focus()
  await startFrameLog(page)
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < 6; i++) await page.locator('[role=dialog] [role=switch]').first().click()
  await waitForSettled(page)
  table.push({ pieces, scenario: 'options burst', ...(await stopFrameLog(page)) })

  // Cancel storm: change inputs far faster than the packer can finish, never waiting for it.
  await margin.focus()
  await startFrameLog(page)
  for (let i = 0; i < 40; i++) await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight')
  await waitForSettled(page)
  table.push({ pieces, scenario: 'cancel storm, 40 changes', ...(await stopFrameLog(page)) })

  test.check(
    `${pieces} pieces: no page errors`,
    app.log.errors.length === 0,
    app.log.errors.join('; '),
  )
  if (!process.env.SHEETFIT_NO_STATUS) {
    test.check(
      `${pieces} pieces: settles to Optimal, Best found or Time limit reached`,
      (await page
        .locator('[role=status]')
        .filter({ hasText: /Optimal|Best found|Time limit reached/ })
        .count()) > 0,
    )
  }
  await app.close()
}

console.table(table)
test.done()
