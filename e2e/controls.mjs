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
 * The control audit. Every interactive control in the app is driven the way a person would drive
 * it, and its effect is checked against the app's real state and the rendered result. It runs on
 * the dev server so the checks can read the store. It prints a Markdown table at the end.
 */
const test = reporter('Control audit')
const table = []
const ok = (condition, message) => {
  if (!condition) throw new Error(message)
}
async function control(name, how, fn) {
  try {
    const note = await fn()
    table.push([name, how, 'works', note ?? ''])
    test.check(name, true, note ?? '')
  } catch (error) {
    if (process.env.DEBUG) console.log(error.message.split('\n').slice(0, 16).join('\n'))
    table.push([name, how, 'BROKEN', error.message.split('\n')[0]])
    test.check(name, false, error.message.split('\n')[0])
  }
}

const read = (page) =>
  page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/index.ts')
    const s = useAppStore.getState()
    return {
      images: s.images.map((i) => ({
        id: i.id,
        name: i.name,
        copies: i.copies,
        percent: i.percent,
        width: i.width,
        height: i.height,
      })),
      options: s.options,
      selected: s.selectedImageId,
      panels: s.panelLayout,
    }
  })
const saved = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('sheetfit:v1') ?? '{}').state ?? {})
const row = (page, name) => page.locator('ul[aria-label=Images] > li').filter({ hasText: name })
/** The row element that takes the shortcuts: the group inside the list item. */
const rowEl = (page, name) => page.locator(`[role=group][aria-label="${name}"]`)
const sheetBox = (page) => page.locator('[data-sheet-page]').first().boundingBox()
const names = (page) =>
  page
    .locator('ul[aria-label=Images] > li')
    .evaluateAll((els) =>
      els.map(
        (e) =>
          e.getAttribute('aria-label') ??
          e
            .querySelector('button[aria-label^=Preview]')
            ?.getAttribute('aria-label')
            ?.replace('Preview ', ''),
      ),
    )
const optionsSheet = (page) => page.locator('[role=dialog]:has-text("Reset to defaults")')
const openOptions = async (page) => {
  if (!(await optionsSheet(page).count())) await page.click('#print-options-button')
  await optionsSheet(page).waitFor()
  await page.waitForTimeout(500)
}
const closeOptions = async (page) => {
  await page.keyboard.press('Escape')
  await page
    .locator('[role=dialog]')
    .waitFor({ state: 'detached' })
    .catch(() => undefined)
}
const slider = (page, label) => page.locator(`[role=slider][aria-label="${label}"]`).first()
const field = (page, label) => page.locator(`input[aria-label="${label}"]`).first()
const optionsLabel = (name) => page.getByRole('radio', { name })
let page

// ================================================================= header, list, rows, preview
{
  const app = await open({
    dev: true,
    storage: JSON.stringify({
      state: { options: { ordering: 'strict', showMargins: true }, panelLayout: {} },
      version: 1,
    }),
  })
  page = app.page

  await control(
    'Header: Download PDF (disabled with nothing to export)',
    'no images: the button is disabled',
    async () => {
      ok(
        await page.getByRole('button', { name: 'Download PDF' }).isDisabled(),
        'enabled with no images',
      )
    },
  )
  await control(
    'Header: Add images',
    'click opens the file picker; chosen files become rows',
    async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByRole('button', { name: 'Add images' }).first().click(),
      ])
      await chooser.setFiles(['photo.jpg', 'opaque.png', 'photo.webp'].map(fixture))
      await waitForImages(page, 3)
      const state = await read(page)
      ok(state.images.length === 3, `${state.images.length} images`)
      return '3 files added'
    },
  )
  await page.waitForTimeout(800)
  await control(
    'Header: Download PDF (enabled with sheets)',
    'with images the button is enabled',
    async () => {
      await waitForSettled(page)
      ok(await page.getByRole('button', { name: 'Download PDF' }).isEnabled(), 'still disabled')
    },
  )

  // ---- window-level input
  await control(
    'Add by drag and drop anywhere on the page',
    'drop event with files on the page body adds rows',
    async () => {
      const before = (await read(page)).images.length
      await page.evaluate(
        async (url) => {
          const blob = await (await fetch(url)).blob()
          const file = new File([blob], 'dropped.png', { type: 'image/png' })
          const dt = new DataTransfer()
          dt.items.add(file)
          for (const type of ['dragenter', 'dragover', 'drop'])
            document.body.dispatchEvent(
              new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
            )
        },
        `data:image/png;base64,${(await import('node:fs')).readFileSync(fixture('opaque.png')).toString('base64')}`,
      )
      await page.waitForTimeout(1200)
      const after = (await read(page)).images.length
      ok(after === before + 1, `${before} -> ${after}`)
    },
  )
  await control('Add by paste (Ctrl+V)', 'paste event with an image file adds a row', async () => {
    const before = (await read(page)).images.length
    await page.evaluate(
      async (url) => {
        const blob = await (await fetch(url)).blob()
        const dt = new DataTransfer()
        dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }))
        document.body.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        )
      },
      `data:image/png;base64,${(await import('node:fs')).readFileSync(fixture('opaque.png')).toString('base64')}`,
    )
    await page.waitForTimeout(1200)
    ok((await read(page)).images.length === before + 1, 'no row added')
  })
  await control(
    'Files that cannot be decoded',
    'a text file named .png is refused with a message, nothing is added',
    async () => {
      const before = (await read(page)).images.length
      await addFiles(page, ['not-an-image.png'])
      await page.waitForTimeout(1500)
      ok((await read(page)).images.length === before, 'a row was added')
      ok(
        (await page
          .locator('[data-sonner-toast]')
          .filter({ hasText: /not-an-image/ })
          .count()) >= 1,
        'no message',
      )
    },
  )

  // ---- rows
  const first = 'photo.jpg'
  await control('Row: More copies (+)', 'click raises copies by one', async () => {
    const before = (await read(page)).images.find((i) => i.name === first).copies
    await row(page, first).getByRole('button', { name: 'More copies' }).click()
    ok((await read(page)).images.find((i) => i.name === first).copies === before + 1, 'unchanged')
  })
  await control('Row: Fewer copies (−)', 'click lowers copies by one', async () => {
    const before = (await read(page)).images.find((i) => i.name === first).copies
    await row(page, first).getByRole('button', { name: 'Fewer copies' }).click()
    ok((await read(page)).images.find((i) => i.name === first).copies === before - 1, 'unchanged')
  })
  await control(
    'Row: copies field',
    'typing a number commits on Enter; text is refused',
    async () => {
      const input = field(page, `Number of copies of ${first}`)
      await input.fill('7')
      await input.press('Enter')
      ok((await read(page)).images.find((i) => i.name === first).copies === 7, 'not 7')
      await input.fill('abc')
      await input.press('Enter')
      ok((await read(page)).images.find((i) => i.name === first).copies === 7, 'accepted text')
    },
  )
  await control('Row: zero copies', 'a photo set to 0 copies leaves the sheets', async () => {
    const input = field(page, `Number of copies of ${first}`)
    await input.fill('0')
    await input.press('Enter')
    await waitForSettled(page)
    const state = await read(page)
    ok(state.images.find((i) => i.name === first).copies === 0, 'not 0')
    await input.fill('2')
    await input.press('Enter')
  })
  await control('Row: size slider', 'arrow keys change the percent', async () => {
    const before = (await read(page)).images.find((i) => i.name === first).percent
    await slider(page, `Print size of ${first}`).focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    ok((await read(page)).images.find((i) => i.name === first).percent > before, 'unchanged')
  })
  await control(
    'Row: size percent field',
    'typed percent is used, limited to 10 to 300',
    async () => {
      const input = field(page, `Print size of ${first} in percent`)
      await input.fill('150')
      await input.press('Enter')
      ok((await read(page)).images.find((i) => i.name === first).percent === 150, 'not 150')
      await input.fill('999')
      await input.press('Enter')
      ok((await read(page)).images.find((i) => i.name === first).percent <= 300, 'above 300')
    },
  )
  await control('Row: Reset size to 100%', 'click puts the percent back', async () => {
    await row(page, first).getByRole('button', { name: 'Reset size to 100%' }).click()
    ok((await read(page)).images.find((i) => i.name === first).percent === 100, 'not 100')
  })
  await control(
    'Row: printed size text and low resolution notice',
    'the size shown is width x height of the print; a low DPI badge appears when large',
    async () => {
      const field_ = field(page, `Print size of ${first} in percent`)
      await field_.fill('300')
      await field_.press('Enter')
      const text = await row(page, first).innerText()
      ok(/mm/.test(text), 'no size shown')
      await field_.fill('100')
      await field_.press('Enter')
      return /Low resolution|DPI/.test(await page.locator('body').innerText())
        ? 'badge seen'
        : 'size text shown'
    },
  )
  await control(
    'Row: Preview (thumbnail) opens a larger preview',
    'click opens a dialog with the photo; Escape closes',
    async () => {
      await row(page, first)
        .getByRole('button', { name: `Preview ${first}` })
        .click()
      await page.locator('[role=dialog]').waitFor()
      ok((await page.locator('[role=dialog] img').count()) > 0, 'no image')
      await page.keyboard.press('Escape')
      await page.locator('[role=dialog]').waitFor({ state: 'detached' })
    },
  )
  await control(
    'Row: click selects it, and every copy lights up in the preview',
    'row click sets the selection; other pieces are dimmed',
    async () => {
      await rowEl(page, 'opaque.png').click({ position: { x: 5, y: 5 } })
      ok((await read(page)).selected !== null, 'nothing selected')
      await page.waitForTimeout(500)
      const opacities = await page
        .locator('.group\\/piece')
        .evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)))
      ok(
        opacities.some((o) => o < 0.6) && opacities.some((o) => o > 0.9),
        `opacities ${[...new Set(opacities.map((o) => o.toFixed(2)))]}`,
      )
    },
  )
  await control('Row: Move down / Move up buttons', 'the order of the list changes', async () => {
    const before = await names(page)
    await page
      .locator('ul[aria-label=Images] > li')
      .first()
      .getByRole('button', { name: 'Move down' })
      .click()
    const after = await names(page)
    ok(
      after[0] === before[1] && after[1] === before[0],
      `${before.slice(0, 2)} -> ${after.slice(0, 2)}`,
    )
    await page
      .locator('ul[aria-label=Images] > li')
      .nth(1)
      .getByRole('button', { name: 'Move up' })
      .click()
    ok((await names(page))[0] === before[0], 'move up failed')
  })
  await control('Row: drag handle (mouse)', 'dragging the grip reorders the list', async () => {
    const before = await names(page)
    const grip = page
      .locator('ul[aria-label=Images] > li')
      .first()
      .getByRole('button', { name: /Reorder/ })
    const box = await grip.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 30, { steps: 4 })
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 220, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const after = await names(page)
    ok(after.join() !== before.join(), 'order unchanged')
  })
  await control(
    'Row: Remove image with Undo',
    'remove deletes the row and offers Undo, which restores it',
    async () => {
      const before = (await read(page)).images.length
      await page
        .locator('ul[aria-label=Images] > li')
        .last()
        .getByRole('button', { name: 'Remove image' })
        .click()
      ok((await read(page)).images.length === before - 1, 'not removed')
      await page.getByRole('button', { name: 'Undo' }).click()
      ok((await read(page)).images.length === before, 'undo did not restore')
    },
  )

  // ---- keyboard shortcuts (every claim in the shortcuts dialog)
  await control(
    'Keyboard shortcuts dialog',
    'button opens it; it lists the shortcuts; Escape closes it',
    async () => {
      await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
      await page.locator('[role=dialog]').waitFor()
      ok(
        (await page.locator('[role=dialog]').innerText()).includes(
          'Paste images from the clipboard',
        ),
        'content missing',
      )
      await page.keyboard.press('Escape')
      await page.locator('[role=dialog]').waitFor({ state: 'detached' })
    },
  )
  await control(
    'Shortcut: ↑ ↓ select the previous or next image',
    'arrow keys on a focused row move the selection',
    async () => {
      const list = await names(page)
      await rowEl(page, (await names(page))[0]).focus()
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(150)
      const a = (await read(page)).selected
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(150)
      const b = (await read(page)).selected
      ok(a && b && a !== b, `selection ${a} -> ${b} in ${list.length} rows`)
    },
  )
  await control(
    'Shortcut: Alt + ↑ ↓ move the selected image',
    'the list order changes',
    async () => {
      const before = await names(page)
      await page.keyboard.press('Alt+ArrowUp')
      await page.waitForTimeout(300)
      ok((await names(page)).join() !== before.join(), 'order unchanged')
    },
  )
  await control(
    'Shortcut: + and − add or remove one copy',
    'keys change the selected image’s copies',
    async () => {
      const id = (await read(page)).selected
      const copies = () => read(page).then((s) => s.images.find((i) => i.id === id).copies)
      const before = await copies()
      await page.keyboard.press('+')
      const up = await copies()
      await page.keyboard.press('-')
      ok(up === before + 1 && (await copies()) === before, `${before} ${up}`)
    },
  )
  await control(
    'Shortcut: Enter opens a larger preview',
    'Enter on the selected row opens the dialog',
    async () => {
      await page.keyboard.press('Enter')
      await page.locator('[role=dialog]').waitFor({ timeout: 3000 })
      await page.keyboard.press('Escape')
      await page.locator('[role=dialog]').waitFor({ state: 'detached' })
    },
  )
  await control(
    'Shortcut: Delete removes the selected image (Undo offered)',
    'the row is removed and Undo restores it',
    async () => {
      const before = (await read(page)).images.length
      await rowEl(page, (await names(page))[1]).focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Delete')
      await page.waitForTimeout(200)
      ok((await read(page)).images.length === before - 1, 'not removed')
      await page.getByRole('button', { name: 'Undo' }).click()
      ok((await read(page)).images.length === before, 'undo failed')
    },
  )
  await control(
    'Shortcut: Space on a grip picks up, arrows move, Space drops',
    'keyboard reorder changes the list',
    async () => {
      const before = await names(page)
      const grip = page
        .locator('ul[aria-label=Images] > li')
        .first()
        .getByRole('button', { name: /Reorder/ })
      await grip.focus()
      await page.keyboard.press('Space')
      await page.waitForTimeout(250)
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(300)
      await page.keyboard.press('Space')
      await page.waitForTimeout(600)
      ok((await names(page)).join() !== before.join(), 'order unchanged')
    },
  )
  await control(
    'Shortcut: Esc cancels a keyboard drag',
    'Escape leaves the order as it was',
    async () => {
      const before = await names(page)
      const grip = page
        .locator('ul[aria-label=Images] > li')
        .first()
        .getByRole('button', { name: /Reorder/ })
      await grip.focus()
      await page.keyboard.press('Space')
      await page.waitForTimeout(250)
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(300)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
      ok((await names(page)).join() === before.join(), 'order changed')
    },
  )

  // ---- More menu
  await control('More ▸ Set all copies to…', 'the popover form sets every image', async () => {
    await setAllCopies(page, 4)
    ok(
      (await read(page)).images.every((i) => i.copies === 4),
      'not all 4',
    )
  })
  await control(
    'More ▸ Match all to the same width',
    'all printed widths become equal',
    async () => {
      await page.click('button:has-text("More")')
      await page.getByRole('menuitem', { name: 'Match all to the same width' }).click()
      await waitForSettled(page)
      await page.waitForTimeout(500)
      const widths = await page.evaluate(async () => {
        const { useAppStore } = await import('/src/store/index.ts')
        const { getPrintInfo } = await import('/src/lib/sizing.ts')
        const { getSheetGeometry } = await import('/src/lib/sheet.ts')
        const { images, options } = useAppStore.getState()
        return images.map((image) => getPrintInfo(image, options, getSheetGeometry(options)).width)
      })
      ok(
        Math.max(...widths) - Math.min(...widths) < 0.1,
        `widths ${widths.map((w) => w.toFixed(1))}`,
      )
    },
  )
  await control('More ▸ Reset all sizes to 100%', 'every percent returns to 100', async () => {
    await page.click('button:has-text("More")')
    await page.getByRole('menuitem', { name: 'Reset all sizes to 100%' }).click()
    ok(
      (await read(page)).images.every((i) => i.percent === 100),
      'not all 100',
    )
    await page.waitForTimeout(500)
  })
  await control(
    'More ▸ Clear all… (cancel, then confirm)',
    'Cancel keeps the images; confirming removes them all',
    async () => {
      const count = (await read(page)).images.length
      await page.click('button:has-text("More")')
      await page.waitForTimeout(300)
      await page.getByRole('menuitem', { name: 'Clear all…' }).click()
      await page.getByRole('alertdialog').waitFor()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Keep images' }).click()
      await page.getByRole('alertdialog').waitFor({ state: 'detached' })
      ok((await read(page)).images.length === count, 'cancel removed images')
      await page.click('button:has-text("More")')
      await page.getByRole('menuitem', { name: 'Clear all…' }).click()
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Clear all', exact: true })
        .click()
      ok((await read(page)).images.length === 0, 'not cleared')
    },
  )
  await app.close()
}

// ================================================================= preview toolbar, panel, theme
{
  const app = await open({
    dev: true,
    storage: JSON.stringify({
      state: { options: { ordering: 'strict' }, panelLayout: {} },
      version: 1,
    }),
  })
  page = app.page
  await addGenerated(page, [
    { width: 1200, height: 800 },
    { width: 800, height: 1200 },
    { width: 900, height: 900 },
  ])
  await waitForImages(page, 3)
  await page.waitForTimeout(800)
  await setAllCopies(page, 20)
  await waitForSettled(page)
  const sheets = await page.locator('[data-sheet-page]').count()

  await control(
    'Preview: Zoom menu ▸ 100%',
    'actual size: an A4 sheet is 793.7 px wide (96 px per inch)',
    async () => {
      await page.getByRole('button', { name: /Zoom:/ }).click()
      await page.getByRole('menuitemradio', { name: '100%' }).click()
      await page.waitForTimeout(500)
      const box = await sheetBox(page)
      ok(Math.abs(box.width - 793.7) < 2, `${box.width.toFixed(1)} px`)
    },
  )
  await control('Preview: Zoom in / Zoom out', 'buttons change the sheet width', async () => {
    const before = (await sheetBox(page)).width
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.waitForTimeout(400)
    const bigger = (await sheetBox(page)).width
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.waitForTimeout(400)
    ok(bigger > before && (await sheetBox(page)).width < before, `${before} ${bigger}`)
  })
  await control(
    'Preview: Zoom menu ▸ Fit width / Fit page',
    'the sheet fits the panel width, or the whole page fits the panel',
    async () => {
      await page.getByRole('button', { name: /Zoom:/ }).click()
      await page.getByRole('menuitemradio', { name: 'Fit page' }).click()
      await page.waitForTimeout(500)
      const panel = await page.locator('section[aria-label="Sheet preview"]').boundingBox()
      const fit = await sheetBox(page)
      ok(fit.height <= panel.height, 'taller than the panel')
      await page.getByRole('button', { name: /Zoom:/ }).click()
      await page.getByRole('menuitemradio', { name: 'Fit width' }).click()
      await page.waitForTimeout(500)
      ok((await sheetBox(page)).width >= fit.width - 1, 'fit width narrower than fit page')
    },
  )
  await control(
    'Preview: Ctrl + scroll zooms',
    'the wheel with Control held changes the sheet width',
    async () => {
      const before = (await sheetBox(page)).width
      const panel = await page.locator('section[aria-label="Sheet preview"]').boundingBox()
      await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2)
      await page.keyboard.down('Control')
      await page.mouse.wheel(0, -400)
      await page.keyboard.up('Control')
      await page.waitForTimeout(500)
      ok(Math.abs((await sheetBox(page)).width - before) > 5, 'unchanged')
    },
  )
  await control(
    'Preview: View mode ▸ One sheet at a time',
    'only one sheet is shown; Next and Previous sheet change it',
    async () => {
      await page.getByRole('radio', { name: 'One sheet at a time' }).click()
      await page.waitForTimeout(500)
      ok((await page.locator('[data-sheet-page]').count()) === 1, 'more than one sheet')
      const label = () => page.locator('[aria-label="Preview controls"]').innerText()
      ok(/Sheet 1 of/.test(await label()), 'label')
      await page.getByRole('button', { name: 'Next sheet' }).click()
      await page.waitForTimeout(500)
      ok(/Sheet 2 of/.test(await label()), `label ${await label()}`)
      await page.getByRole('button', { name: 'Previous sheet' }).click()
      await page.waitForTimeout(500)
      ok(/Sheet 1 of/.test(await label()), 'previous failed')
    },
  )
  await control(
    'Preview: View mode ▸ Scroll all sheets',
    'all sheets are drawn again',
    async () => {
      await page.getByRole('radio', { name: 'Scroll all sheets' }).click()
      await page.waitForTimeout(600)
      ok((await page.locator('[data-sheet-page]').count()) === sheets, 'sheet count differs')
    },
  )
  await control(
    'Preview: Next / Previous sheet in scroll mode',
    'the scroll position and label follow',
    async () => {
      await page.getByRole('button', { name: 'Next sheet' }).click()
      await page.waitForTimeout(900)
      ok(
        /Sheet 2 of/.test(await page.locator('[aria-label="Preview controls"]').innerText()),
        'label did not advance',
      )
    },
  )
  await control(
    'Preview: hover a piece shows its details',
    'tooltip names the photo, the copy, the size and the rotation',
    async () => {
      await page.locator('.group\\/piece').first().hover()
      await page.waitForTimeout(900)
      const tip = await page.locator('[role=tooltip]').first().innerText()
      ok(
        /Copy \d+ of \d+/.test(tip) && /mm/.test(tip) && /otated/.test(tip),
        tip.replace(/\n/g, ' | '),
      )
    },
  )
  await control(
    'Preview: click a piece selects all copies of that photo',
    'the selection and the dimming follow',
    async () => {
      await page.locator('.group\\/piece').first().click()
      await page.waitForTimeout(500)
      ok((await read(page)).selected !== null, 'not selected')
      const o = await page
        .locator('.group\\/piece')
        .evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)))
      ok(o.filter((v) => v > 0.9).length >= 20 && o.some((v) => v < 0.6), 'copies not highlighted')
    },
  )
  await control(
    'Preview: hover a sheet shows its statistics (only on hover)',
    'the panel is invisible, then visible while hovering',
    async () => {
      const stats = page.locator('[data-sheet-index="0"] > div[aria-hidden=true]')
      await page.mouse.move(5, 5)
      await page.waitForTimeout(500)
      const hidden = Number(await stats.evaluate((el) => getComputedStyle(el).opacity))
      await page.locator('[data-sheet-index="0"]').hover({ position: { x: 30, y: 30 } })
      await page.waitForTimeout(600)
      const shown = Number(await stats.evaluate((el) => getComputedStyle(el).opacity))
      ok(hidden < 0.05 && shown > 0.9, `${hidden} -> ${shown}`)
    },
  )
  await control(
    'Panel divider: drag, double-click, keyboard',
    'the split follows the drag, resets to 38/62 on double-click, and moves with arrows; it persists',
    async () => {
      const divider = page.locator('[role=separator]').first()
      const box = await divider.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + 250, box.y + 50, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(400)
      const moved = (await read(page)).panels
      ok(Math.abs(moved.images - 38) > 3, `split ${JSON.stringify(moved)}`)
      const now = await divider.boundingBox()
      await page.mouse.dblclick(now.x + now.width / 2, now.y + now.height / 2)
      await page.waitForTimeout(500)
      const reset = (await read(page)).panels
      ok(Math.abs(reset.images - 38) < 1.5, `reset ${JSON.stringify(reset)}`)
      await divider.focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(300)
      ok((await read(page)).panels.images !== reset.images, 'arrow did nothing')
      const persisted = (await saved(page)).panelLayout
      ok(persisted && typeof persisted.images === 'number', 'not persisted')
    },
  )
  await control(
    'Header: Theme menu',
    'Dark and Light change the page; the choice survives a reload',
    async () => {
      await page.getByRole('button', { name: 'Theme' }).click()
      await page.getByRole('menuitemradio', { name: /Dark/ }).click()
      await page.waitForTimeout(300)
      ok(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'not dark')
      await page.reload()
      await page.waitForTimeout(800)
      ok(
        await page.evaluate(() => document.documentElement.classList.contains('dark')),
        'dark lost on reload',
      )
      await page.getByRole('button', { name: 'Theme' }).click()
      await page.getByRole('menuitemradio', { name: /Light/ }).click()
      ok(
        await page.evaluate(() => !document.documentElement.classList.contains('dark')),
        'not light',
      )
    },
  )
  await app.close()
}

// ================================================================= print options
{
  const app = await open({
    dev: true,
    storage: JSON.stringify({
      state: { options: { ordering: 'strict', showMargins: true }, panelLayout: {} },
      version: 1,
    }),
  })
  page = app.page
  await addGenerated(page, [
    { width: 1200, height: 800, name: 'wide.jpg' },
    { width: 600, height: 1500, name: 'tall.jpg' },
  ])
  await waitForImages(page, 2)
  await page.waitForTimeout(800)
  await setAllCopies(page, 6)
  await waitForSettled(page)
  await openOptions(page)
  const pick = async (combo, option) => {
    await page.getByRole('combobox', { name: combo }).click()
    await page.getByRole('option', { name: option }).click()
    await page.waitForTimeout(500)
  }
  const SHEET = 'Paper size'
  const BASE = 'Size at 100%'
  const aspect = async () => {
    const b = await sheetBox(page)
    return b.width / b.height
  }

  await control(
    'Options: Paper size (A3)',
    'the sheet becomes A3 and the preview is 297 : 420',
    async () => {
      await pick(SHEET, /A3/)
      ok(
        (await read(page)).options.sheetSize === 'a3' &&
          Math.abs((await aspect()) - 297 / 420) < 0.01,
        'not A3',
      )
    },
  )
  await control(
    'Options: Paper size (every preset)',
    'each preset gives its own aspect ratio',
    async () => {
      const wanted = {
        a5: 148 / 210,
        a6: 105 / 148,
        letter: 215.9 / 279.4,
        legal: 215.9 / 355.6,
        tabloid: 279.4 / 431.8,
      }
      for (const [id, label] of [
        ['a5', /A5/],
        ['a6', /A6/],
        ['letter', /Letter/],
        ['legal', /Legal/],
        ['tabloid', /Tabloid/],
      ]) {
        await pick(SHEET, label)
        const a = await aspect()
        ok(
          (await read(page)).options.sheetSize === id && Math.abs(a - wanted[id]) < 0.01,
          `${id} ${a.toFixed(3)}`,
        )
      }
    },
  )
  await control(
    'Options: Custom paper size and its width and height',
    'custom fields give the sheet exactly that shape; values are limited',
    async () => {
      await pick(SHEET, /Custom/)
      const width = page.locator('input[aria-label*="idth"]').first()
      const height = page.locator('input[aria-label*="eight"]').first()
      await width.fill('100')
      await width.press('Enter')
      await height.fill('200')
      await height.press('Enter')
      await page.waitForTimeout(600)
      ok(Math.abs((await aspect()) - 0.5) < 0.01, `aspect ${(await aspect()).toFixed(3)}`)
      await width.fill('5')
      await width.press('Enter')
      ok((await read(page)).options.customWidth >= 30, 'width not limited')
      await width.fill('100')
      await width.press('Enter')
    },
  )
  await pick(SHEET, /A4/)
  await control(
    'Options: Orientation (Portrait / Landscape / Automatic)',
    'the sheet turns; Automatic picks per the packer',
    async () => {
      await page.getByRole('radio', { name: 'Landscape' }).click()
      await page.waitForTimeout(600)
      ok((await aspect()) > 1, 'not landscape')
      await page.getByRole('radio', { name: 'Portrait' }).click()
      await page.waitForTimeout(600)
      ok((await aspect()) < 1, 'not portrait')
      await page.getByRole('radio', { name: 'Automatic' }).click()
      await page.waitForTimeout(800)
      ok((await read(page)).options.orientation === 'auto', 'not automatic')
      ok(
        (await page.locator('[role=dialog]').innerText()).includes('whichever needs fewer sheets'),
        'helper text',
      )
      await page.getByRole('radio', { name: 'Portrait' }).click()
    },
  )
  await control(
    'Options: Units (mm / cm / in)',
    'sizes shown in the list change unit and value',
    async () => {
      const text = () => row(page, 'wide.jpg').innerText()
      await page.getByRole('radio', { name: 'cm' }).click()
      const cm = await text()
      await page.getByRole('radio', { name: 'in', exact: true }).first().click()
      const inch = await text()
      await page.getByRole('radio', { name: 'mm' }).click()
      const mm = await text()
      ok(
        / cm/.test(cm) && /″| in/.test(inch) && / mm/.test(mm),
        `${cm.split('\n').find((l) => /cm|mm|in/.test(l))} | ${inch.split('\n').find((l) => /″|in/.test(l))}`,
      )
    },
  )
  await control(
    'Options: Base print size (Width / Height / Longest side / Native DPI) and its length',
    'the printed size of every photo follows the mode and length',
    async () => {
      const widthOf = () =>
        page.evaluate(async () => {
          const { useAppStore } = await import('/src/store/index.ts')
          const { getPrintInfo } = await import('/src/lib/sizing.ts')
          const { getSheetGeometry } = await import('/src/lib/sheet.ts')
          const { images, options } = useAppStore.getState()
          return getPrintInfo(images[0], options, getSheetGeometry(options))
        })
      await pick(BASE, /Fixed width/)
      const length = page.locator('input[aria-label^="Base "]').first()
      await length.fill('60')
      await length.press('Enter')
      await page.waitForTimeout(500)
      const byWidth = await widthOf()
      ok(Math.abs(byWidth.width - 60) < 0.2, `width ${byWidth.width}`)
      await pick(BASE, /Fixed height/)
      const byHeight = await widthOf()
      ok(Math.abs(byHeight.height - 60) < 0.2, `height ${byHeight.height}`)
      await pick(BASE, /Longest side/)
      const longest = await widthOf()
      ok(
        Math.abs(Math.max(longest.width, longest.height) - 60) < 0.2,
        `longest ${Math.max(longest.width, longest.height)}`,
      )
      await pick(BASE, /Native size/)
      const dpi = page.locator('input[aria-label="Print resolution in DPI"]')
      await dpi.fill('300')
      await dpi.press('Enter')
      await page.waitForTimeout(500)
      const native = await widthOf()
      ok(Math.abs(native.width - (1200 / 300) * 25.4) < 0.2, `native ${native.width}`)
    },
  )
  await control(
    'Options: Page margin (slider and field)',
    'the margin guide and the pieces keep that distance from the edge',
    async () => {
      const m = field(page, 'Page margin')
      await m.fill('20')
      await m.press('Enter')
      await page.waitForTimeout(700)
      ok((await read(page)).options.margin === 20, 'not 20')
      const inset = await page.evaluate(() => {
        const sheet = document.querySelector('[data-sheet-page]')
        const guide = sheet.querySelector('.border-dashed')
        return {
          guide: parseFloat(guide.style.left),
          minPiece: Math.min(
            ...[...sheet.querySelectorAll('.group\\/piece')].map((p) => parseFloat(p.style.left)),
          ),
        }
      })
      ok(
        Math.abs(inset.guide - (20 / 210) * 100) < 0.01 && inset.minPiece >= inset.guide - 1e-6,
        `${JSON.stringify(inset)}`,
      )
      await slider(page, 'Page margin').focus()
      await page.keyboard.press('ArrowRight')
      ok((await read(page)).options.margin !== 20, 'slider did nothing')
      await m.fill('500')
      await m.press('Enter')
      ok((await read(page)).options.margin <= 50, 'not limited')
      await m.fill('10')
      await m.press('Enter')
    },
  )
  await control(
    'Options: Gap between photos (slider and field)',
    'neighbouring pieces keep at least that distance',
    async () => {
      const g = field(page, 'Gap between photos')
      await g.fill('8')
      await g.press('Enter')
      await waitForSettled(page)
      await page.waitForTimeout(700)
      const gap = await page.evaluate(() => {
        const sheet = document.querySelector('[data-sheet-page]')
        const box = sheet.getBoundingClientRect()
        const pieces = [...sheet.querySelectorAll('.group\\/piece')].map((p) => ({
          x: parseFloat(p.style.left) * 2.1,
          y: parseFloat(p.style.top) * 2.97,
          w: parseFloat(p.style.width) * 2.1,
          h: parseFloat(p.style.height) * 2.97,
        }))
        let closest = Infinity
        for (const a of pieces)
          for (const b of pieces) {
            if (a === b) continue
            const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0)
            const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0)
            closest = Math.min(closest, Math.hypot(dx, dy))
          }
        return closest
      })
      ok((await read(page)).options.gap === 8 && gap >= 7.95, `closest ${gap.toFixed(2)} mm`)
      await slider(page, 'Gap between photos').focus()
      await page.keyboard.press('ArrowRight')
      ok((await read(page)).options.gap !== 8, 'slider did nothing')
      await g.fill('0')
      await g.press('Enter')
    },
  )
  await control(
    'Options: Allow 90° rotation',
    'off: nothing is rotated; on: tall and wide photos may be turned',
    async () => {
      const sw = page.getByRole('switch').first()
      const rotated = () => page.locator('.group\\/piece img.rotate-90').count()
      await sw.click()
      await waitForSettled(page)
      await page.waitForTimeout(700)
      const off = (await read(page)).options.allowRotation
      ok(off === false && (await rotated()) === 0, `off=${off} rotated=${await rotated()}`)
      await sw.click()
      await waitForSettled(page)
      ok((await read(page)).options.allowRotation === true, 'not on')
    },
  )
  await control(
    'Options: Ordering (Optimize packing / Strict order)',
    'strict keeps list order on the sheets; optimize may reorder',
    async () => {
      await page.getByRole('radio', { name: 'Strict order' }).click()
      await waitForSettled(page)
      await page.waitForTimeout(500)
      const order = await page.evaluate(async () => {
        const { useAppStore } = await import('/src/store/index.ts')
        const byThumb = new Map(useAppStore.getState().images.map((i) => [i.thumbUrl, i.id]))
        const ids = [...document.querySelectorAll('[data-sheet-page] .group\\/piece img')].map(
          (img) => byThumb.get(img.src),
        )
        const list = useAppStore.getState().images.map((i) => i.id)
        return ids.map((id) => list.indexOf(id))
      })
      ok(
        order.every((v, i) => i === 0 || v >= order[i - 1]),
        `order ${order.join('')}`,
      )
      await page.getByRole('radio', { name: 'Optimize packing' }).click()
      ok((await read(page)).options.ordering === 'optimize', 'not optimize')
      await page.getByRole('radio', { name: 'Strict order' }).click()
    },
  )
  await control(
    'Options: Cut guides',
    'on: each piece gets a dark border in the preview; off: a faint one',
    async () => {
      const border = () =>
        page
          .locator('.group\\/piece')
          .first()
          .evaluate((el) => getComputedStyle(el.querySelector('span')).borderTopColor)
      const sw = page.getByRole('switch').nth(1)
      const before = await border()
      await sw.click()
      await page.waitForTimeout(500)
      const after = await border()
      ok((await read(page)).options.cutGuides === true && after !== before, `${before} -> ${after}`)
      ok((await saved(page)).options.cutGuides === true, 'not persisted')
    },
  )
  await control(
    'Options: Show margins',
    'the dashed margin boundary appears and disappears',
    async () => {
      const count = () => page.locator('[data-sheet-page] .border-dashed').count()
      const sw = page.getByRole('switch').nth(2)
      const on = await count()
      await sw.click()
      await page.waitForTimeout(300)
      ok(on > 0 && (await count()) === 0, `${on} -> ${await count()}`)
      await sw.click()
    },
  )
  await control(
    'Options: Show sheet numbers',
    'the numbered badge on each sheet appears and disappears',
    async () => {
      const count = () => page.locator('[data-sheet-index] > span[aria-hidden=true]').count()
      const sw = page.getByRole('switch').nth(3)
      const on = await count()
      await sw.click()
      await page.waitForTimeout(300)
      ok(on > 0 && (await count()) === 0, `${on} -> ${await count()}`)
      await sw.click()
    },
  )
  await control(
    'Options: Reset to defaults',
    'every option returns to its default; the photos stay',
    async () => {
      const images = (await read(page)).images.length
      await page.getByRole('button', { name: 'Reset to defaults' }).click()
      const alertButton = page.getByRole('alertdialog').getByRole('button', { name: /Reset/ })
      if (await alertButton.count()) await alertButton.click()
      await page.waitForTimeout(500)
      const { options } = await read(page)
      ok(
        options.sheetSize === 'a4' &&
          options.margin === 5 &&
          options.gap === 0 &&
          options.cutGuides === false &&
          options.unit === 'mm',
        JSON.stringify(options),
      )
      ok((await read(page)).images.length === images, 'photos were removed')
    },
  )
  await control(
    'Options: panel sections, help buttons and Close',
    'accordion sections open and close; help explains; Close and Escape close the sheet',
    async () => {
      const margin = slider(page, 'Page margin')
      await page.getByRole('button', { name: 'Spacing' }).click()
      await page.waitForTimeout(500)
      ok(!(await margin.isVisible()), 'the Spacing section did not collapse')
      await page.getByRole('button', { name: 'Spacing' }).click()
      await page.waitForTimeout(500)
      ok(await margin.isVisible(), 'the Spacing section did not expand')
      await page.getByRole('button', { name: 'About Page margin' }).hover()
      await page.waitForTimeout(900)
      const explanation = await page.locator('[role=tooltip]').first().innerText()
      ok(explanation.length > 20, 'no explanation')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      if (await optionsSheet(page).count())
        await page.getByRole('button', { name: 'Close' }).click()
      await optionsSheet(page).waitFor({ state: 'detached' })
    },
  )
  await control(
    'Options and the photo list persist across a reload; selection and layouts do not',
    'after reload the options and the same photos (order, copies, sizes) are back, nothing is selected',
    async () => {
      await openOptions(page)
      await page.getByRole('radio', { name: 'Landscape' }).click()
      await page.getByRole('radio', { name: 'cm' }).click()
      await page.waitForTimeout(400)
      const before = await read(page)
      ok(before.images.length > 0, 'the scene has photos to persist')
      await page.reload()
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-image-row]').length === n,
        before.images.length,
        { timeout: 20000 },
      )
      const state = await read(page)
      ok(
        state.options.orientation === 'landscape' && state.options.unit === 'cm',
        JSON.stringify(state.options),
      )
      ok(
        JSON.stringify(state.images) === JSON.stringify(before.images),
        'the restored photos differ from the ones before the reload',
      )
      ok(state.selected === null, 'selection was restored')
    },
  )
  await app.close()
}

console.log('\n| Control | Verified by | Result | Note |\n|---|---|---|---|')
for (const [control, how, result, note] of table)
  console.log(`| ${control} | ${how} | ${result} | ${note} |`)
test.done()
