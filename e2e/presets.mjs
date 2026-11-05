import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  addGenerated,
  open,
  reporter,
  waitForImages,
  waitForSettled,
  watchWorkers,
} from './harness.mjs'

/*
 * The presets feature in real Chrome: every operation, the modified indicator, export and import
 * with real files, persistence, independence from the persisted print options, safety while the
 * packer and the exporter run, two tabs, storage that fails, and the keyboard. It runs on the dev
 * server so the checks can read the stores. Run `npm run build` first for the PDF check, which
 * needs `pdfinfo` from poppler.
 */
const test = reporter('Presets')
const PRESETS_KEY = 'sheetfit:presets'
const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version
const scratch = mkdtempSync(join(tmpdir(), 'sheetfit-presets-'))

const optionsJson = (options = {}) =>
  JSON.stringify({ state: { options, panelLayout: {} }, version: 1 })

// --- helpers -------------------------------------------------------------------------------

const menu = (page) => page.locator('[role=menu][data-state=open]').first()
const toast = (page) => page.locator('[data-sonner-toast]')
const sleep = (page, ms = 250) => page.waitForTimeout(ms)

async function openMenu(page) {
  if (!(await menu(page).count())) {
    await page.waitForFunction(() => !document.querySelector('[role=menu]')) // one still closing
    await page.click('#presets-button')
  }
  await menu(page).waitFor()
  await sleep(page, 120)
}
async function closeMenu(page) {
  if (await menu(page).count()) await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role=menu]'))
}
async function menuItem(page, name, role = 'menuitem') {
  await openMenu(page)
  return page.getByRole(role, { name, exact: true })
}
async function save(page, name) {
  await (await menuItem(page, 'Save current settings…')).click()
  const field = page.getByLabel('Name', { exact: true })
  await field.fill(name)
  await field.press('Enter')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
}
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
async function apply(page, name) {
  await openMenu(page)
  // The active preset's name carries “Modified” when it is.
  await page
    .getByRole('menuitemradio', { name: new RegExp(`^${escapeRe(name)}( Modified)?$`) })
    .click()
  await sleep(page, 150)
}
async function managed(page, name, action) {
  await (await menuItem(page, 'Manage presets')).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
  await sleep(page, 150)
}
/** Moves focus down the open menu to the item whose text contains `text`. */
async function focusItem(page, text) {
  await sleep(page, 250)
  for (let i = 0; i < 12; i++) {
    const here = await page.evaluate(() => document.activeElement?.textContent ?? '')
    if (here.includes(text)) return
    await page.keyboard.press('ArrowDown')
    await sleep(page, 100)
  }
  throw new Error(`no menu item containing “${text}” was reached`)
}
const undo = async (page) => {
  await toast(page).getByRole('button', { name: 'Undo' }).click()
  await sleep(page, 200)
}

const stored = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), PRESETS_KEY)
const storedNames = async (page) => ((await stored(page))?.presets ?? []).map((p) => p.name)
const label = (page) => page.locator('#presets-button').getAttribute('aria-label')
const options = (page) =>
  page.evaluate(async () => (await import('/src/store/index.ts')).useAppStore.getState().options)
const setOptions = (page, changes) =>
  page.evaluate(
    async (c) => (await import('/src/store/index.ts')).useAppStore.getState().applyOptions(c),
    changes,
  )
const images = (page) =>
  page.evaluate(async () =>
    (await import('/src/store/index.ts')).useAppStore
      .getState()
      .images.map(({ id, name, copies, percent }) => ({ id, name, copies, percent })),
  )
const keys = (object, list) => Object.fromEntries(list.map((key) => [key, object[key]]))
const SETTINGS = [
  'sheetSize',
  'customWidth',
  'customHeight',
  'orientation',
  'baseMode',
  'baseLength',
  'baseDpi',
  'margin',
  'gap',
  'allowRotation',
  'ordering',
  'cutGuides',
]
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const PHOTOS = [
  { width: 600, height: 400 },
  { width: 400, height: 600 },
  { width: 500, height: 500 },
]
async function withPhotos(page, count = 3) {
  await addGenerated(
    page,
    PHOTOS.slice(0, count).map((p, i) => ({ ...p, name: `p${i}.jpg` })),
  )
  await waitForImages(page, count)
  await page.waitForFunction(
    async (n) => (await import('/src/store/index.ts')).useAppStore.getState().images.length === n,
    count,
  )
  await sleep(page, 500)
}
const clean = (app, name) =>
  test.check(`${name}: no page errors`, app.log.errors.length === 0, app.log.errors.join('; '))

// --- 1. The operations ------------------------------------------------------------------------
{
  const app = await open({
    dev: true,
    storage: optionsJson({ unit: 'in', showMargins: false, showSheetNumbers: false }),
    init: watchWorkers(),
  })
  const { page } = app
  await withPhotos(page)
  const photosBefore = await images(page)

  test.check(
    'the control is in the header, named Presets while there are none',
    (await label(page)) === 'Presets',
  )
  await openMenu(page)
  test.check(
    'the empty menu says so and offers to save; Export all is disabled',
    (await menu(page).innerText()).includes('No presets yet') &&
      (await page
        .getByRole('menuitem', { name: 'Export all presets' })
        .getAttribute('aria-disabled')) === 'true',
  )
  await closeMenu(page)

  // Save
  await (await menuItem(page, 'Save current settings…')).click()
  const field = page.getByLabel('Name', { exact: true })
  test.check(
    'Save opens a dialog with the name field focused',
    await field.evaluate((el) => el === document.activeElement),
  )
  const saveDialogText = await page.locator('[role=dialog]').innerText()
  test.check(
    'the dialog says what is and is not kept',
    /units/.test(saveDialogText) &&
      /copies/.test(saveDialogText) &&
      /per-image sizes/.test(saveDialogText),
  )
  await field.press('Enter')
  test.check(
    'an empty name is refused next to the field',
    (await page.getByRole('alert').innerText()) === 'Enter a name.',
  )
  await field.fill('x'.repeat(41))
  await field.press('Enter')
  test.check(
    'a name over 40 characters is refused, not cut',
    /40 characters or fewer/.test(await page.getByRole('alert').innerText()),
  )
  await field.fill('  Passport   photos  ')
  await field.press('Enter')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
  await sleep(page)
  test.check(
    'saving closes the dialog and returns focus to the control',
    await page.evaluate(() => document.activeElement?.id === 'presets-button'),
  )
  test.check(
    'a toast says Saved, with the cleaned name',
    (await toast(page).first().innerText()).includes('Saved “Passport photos”'),
  )
  test.check('the control now names the preset', (await label(page)) === 'Presets: Passport photos')
  const doc = await stored(page)
  test.check(
    'it is stored under its own key as version 1 with exactly the twelve settings',
    doc.version === 1 &&
      doc.presets.length === 1 &&
      sameJson(Object.keys(doc.presets[0].settings).sort(), [...SETTINGS].sort()) &&
      doc.activeId === doc.presets[0].id,
  )
  test.check(
    'units and the preview switches are not in the preset',
    !('unit' in doc.presets[0].settings) && !('showMargins' in doc.presets[0].settings),
  )

  await (await menuItem(page, 'Save current settings…')).click()
  await page.getByLabel('Name', { exact: true }).fill('passport PHOTOS')
  await page.getByLabel('Name', { exact: true }).press('Enter')
  test.check(
    'the same name in another case is refused',
    /already exists/.test(await page.getByRole('alert').innerText()),
  )
  await page.keyboard.press('Escape')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })

  // A second preset with different settings, then apply and the one-run rule.
  await setOptions(page, { sheetSize: 'a3', margin: 12, cutGuides: true })
  await save(page, 'Big sheet')
  test.check(
    'saving makes the new preset the active one',
    (await label(page)) === 'Presets: Big sheet',
  )
  await setOptions(page, { sheetSize: 'a6', orientation: 'landscape', unit: 'cm' })
  await sleep(page, 400)
  const runsBefore = await page.evaluate(
    () => window.__packing.sent.filter((m) => m.type === 'run').length,
  )
  const unitBefore = (await options(page)).unit
  await apply(page, 'Passport photos')
  await sleep(page, 400)
  const applied = await options(page)
  const passport = doc.presets[0].settings
  test.check(
    'applying puts the preset’s settings into the options',
    sameJson(keys(applied, SETTINGS), passport),
  )
  test.check(
    'it leaves units and the preview switches alone',
    applied.unit === unitBefore &&
      applied.showMargins === false &&
      applied.showSheetNumbers === false,
  )
  test.check(
    'it does not touch the images, copies or sizes',
    sameJson(await images(page), photosBefore),
    JSON.stringify([photosBefore, await images(page)]),
  )
  const runsAfter = await page.evaluate(
    () => window.__packing.sent.filter((m) => m.type === 'run').length,
  )
  test.check(
    'exactly one packing run starts',
    runsAfter - runsBefore === 1,
    `${runsAfter - runsBefore}`,
  )
  test.check(
    'a toast says Applied, with an Undo',
    (await toast(page).first().innerText()).includes('Applied “Passport photos”') &&
      (await toast(page).getByRole('button', { name: 'Undo' }).count()) === 1,
  )
  test.check(
    'the menu marks the applied preset and it is not modified',
    (await label(page)) === 'Presets: Passport photos',
  )

  // Undo of an apply
  await undo(page)
  const restored = await options(page)
  test.check(
    'Undo brings the previous settings back in one step',
    restored.sheetSize === 'a6' && restored.orientation === 'landscape',
  )
  test.check(
    'and the control no longer claims a preset that does not match',
    (await label(page)) === 'Presets: Big sheet Modified' || (await label(page)) === 'Presets',
    await label(page),
  )

  // Modified, Update, Revert
  await apply(page, 'Passport photos')
  await page.click('#print-options-button')
  await sleep(page, 500)
  const marginField = page.getByRole('textbox', { name: /margin/i }).first()
  await marginField.fill('0.2')
  await marginField.press('Enter')
  await page.keyboard.press('Escape')
  await sleep(page, 400)
  const edited = (await options(page)).margin
  test.check(
    'the edit is a real change (0.2 cm is 2 mm)',
    Math.abs(edited - 2) < 1e-6 && edited !== passport.margin,
    `${edited}`,
  )
  test.check(
    'changing a setting by hand marks the preset modified',
    (await label(page)) === 'Presets: Passport photos Modified',
  )
  await openMenu(page)
  const menuText = await menu(page).innerText()
  test.check(
    'the menu shows Modified, with Update and Revert for that preset',
    /Modified/.test(menuText) &&
      /Update “Passport photos”/.test(menuText) &&
      /Revert to “Passport photos”/.test(menuText),
  )
  await page.getByRole('menuitem', { name: 'Revert to “Passport photos”' }).click()
  await sleep(page, 300)
  test.check(
    'Revert restores the preset’s settings and clears Modified',
    (await options(page)).margin === passport.margin &&
      (await label(page)) === 'Presets: Passport photos',
  )
  await undo(page)
  test.check(
    'Undo of a revert brings the edit back',
    (await options(page)).margin === edited && (await label(page)).endsWith('Modified'),
  )
  await (await menuItem(page, 'Update “Passport photos”')).click()
  await sleep(page, 200)
  test.check(
    'Update overwrites the preset with the current settings',
    (await stored(page)).presets[0].settings.margin === edited &&
      (await label(page)) === 'Presets: Passport photos',
  )
  await undo(page)
  test.check(
    'Undo of an update restores the old settings in the preset',
    (await stored(page)).presets[0].settings.margin === passport.margin,
  )
  await apply(page, 'Passport photos')

  // Rename, duplicate
  const before = await options(page)
  await managed(page, 'Passport photos', 'Rename…')
  const renameField = page.getByLabel('Name', { exact: true })
  test.check(
    'Rename opens with the current name',
    (await renameField.inputValue()) === 'Passport photos',
  )
  await renameField.fill('Big sheet')
  await renameField.press('Enter')
  test.check(
    'renaming to a name that is taken is refused',
    /already exists/.test(await page.getByRole('alert').innerText()),
  )
  await renameField.fill('Passports')
  await renameField.press('Enter')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
  test.check(
    'rename works and keeps the settings and the active mark',
    sameJson(await storedNames(page), ['Passports', 'Big sheet']) &&
      (await label(page)) === 'Presets: Passports',
  )
  await managed(page, 'Passports', 'Duplicate')
  test.check(
    'Duplicate puts “name copy” right after the original with equal settings',
    sameJson(await storedNames(page), ['Passports', 'Passports copy', 'Big sheet']),
  )
  await managed(page, 'Passports', 'Duplicate')
  test.check('a second duplicate is numbered', (await storedNames(page))[1] === 'Passports copy 2')

  // Delete with Undo
  const idsBefore = (await stored(page)).presets.map((p) => p.id)
  await managed(page, 'Passports copy 2', 'Delete')
  test.check(
    'Delete removes at once and offers Undo',
    (await storedNames(page)).length === 3 &&
      (await toast(page).getByRole('button', { name: 'Undo' }).count()) === 1,
  )
  await undo(page)
  const idsAfter = (await stored(page)).presets.map((p) => p.id)
  test.check('Undo puts it back in the same place with the same id', sameJson(idsAfter, idsBefore))
  await managed(page, 'Passports', 'Delete')
  test.check(
    'deleting the active preset clears the stored active mark; settings equal to its copy then belong to the copy',
    (await stored(page)).activeId === null &&
      (await label(page)).startsWith('Presets: Passports copy'),
    await label(page),
  )
  await undo(page)
  test.check(
    'Undo of that makes it the active preset again',
    (await label(page)) === 'Presets: Passports',
  )
  test.check(
    'renaming, duplicating and deleting never changed the current options',
    sameJson(await options(page), before),
  )
  test.check(
    'nor the images',
    sameJson(await images(page), photosBefore),
    JSON.stringify([photosBefore, await images(page)]),
  )
  clean(app, 'operations')
  await app.close()
}

// --- 2. Export and import with real files ----------------------------------------------------------
const settingsOf = (changes = {}) => ({
  sheetSize: 'a4',
  customWidth: 210,
  customHeight: 297,
  orientation: 'portrait',
  baseMode: 'native',
  baseLength: 50,
  baseDpi: 300,
  margin: 5,
  gap: 0,
  allowRotation: true,
  ordering: 'optimize',
  cutGuides: false,
  ...changes,
})
const exportFile = (presets, extra = {}) =>
  JSON.stringify({ format: 'sheetfit-presets', version: 1, appVersion: '0.0.1', presets, ...extra })
const seed = (doc) =>
  `(() => { if (!localStorage.getItem('${PRESETS_KEY}')) localStorage.setItem('${PRESETS_KEY}', ${JSON.stringify(
    typeof doc === 'string' ? doc : JSON.stringify(doc),
  )}) })()`
const seeded = (...presets) => ({
  version: 1,
  presets: presets.map(([name, changes = {}], i) => ({
    id: `s${i}`,
    name,
    settings: settingsOf(changes),
  })),
  activeId: null,
})

async function importFile(page, path, { confirm = false } = {}) {
  await (await menuItem(page, 'Import presets…')).click()
  const dialog = page.locator('[role=dialog]')
  await dialog.waitFor()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: /Choose (a|another) file/ }).click(),
  ])
  await chooser.setFiles(path)
  await sleep(page, 250)
  const text = await dialog.innerText()
  if (confirm) {
    await dialog.getByRole('button', { name: /^Add / }).click()
    await dialog.waitFor({ state: 'detached' })
    await sleep(page, 200)
  }
  return text
}
const cancelDialog = async (page) => {
  await page.keyboard.press('Escape')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
}
const file = (name, content) => {
  const path = join(scratch, name)
  writeFileSync(path, content)
  return path
}

{
  const app = await open({
    dev: true,
    init: seed(
      seeded(['Passports', { margin: 8 }], ['Labels', { sheetSize: 'a5', cutGuides: true }]),
    ),
  })
  const { page } = app
  await sleep(page, 500)
  const idsBefore = (await stored(page)).presets.map((p) => p.id)

  // Export all
  await openMenu(page)
  const [all] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Export all presets' }).click(),
  ])
  const allPath = join(scratch, 'all.json')
  await all.saveAs(allPath)
  const exported = JSON.parse(readFileSync(allPath, 'utf8'))
  test.check(
    'Export all downloads sheetfit-presets.json',
    all.suggestedFilename() === 'sheetfit-presets.json',
  )
  test.check(
    'the file has the marker, the schema version, the app version and a date',
    exported.format === 'sheetfit-presets' &&
      exported.version === 1 &&
      exported.appVersion === APP_VERSION &&
      !Number.isNaN(Date.parse(exported.exportedAt)),
    `${exported.format} v${exported.version} app ${exported.appVersion}`,
  )
  test.check(
    'it holds each preset’s name and settings and no ids',
    exported.presets.length === 2 &&
      exported.presets.every(
        (p) =>
          sameJson(Object.keys(p), ['name', 'settings']) &&
          sameJson(Object.keys(p.settings).sort(), [...SETTINGS].sort()),
      ),
  )
  test.check(
    'a toast says how many were exported',
    (await toast(page).first().innerText()).includes('Exported 2 presets'),
  )

  // Export one
  await (await menuItem(page, 'Manage presets')).click()
  await page.getByRole('menuitem', { name: 'Labels', exact: true }).click()
  const [one] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Export', exact: true }).click(),
  ])
  test.check(
    'Export on one preset downloads a file named after it',
    one.suggestedFilename() === 'sheetfit-preset-labels.json',
    one.suggestedFilename(),
  )
  const onePath = join(scratch, 'one.json')
  await one.saveAs(onePath)
  test.check(
    'and the file holds only that preset',
    JSON.parse(readFileSync(onePath, 'utf8'))
      .presets.map((p) => p.name)
      .join() === 'Labels',
  )

  // Import the same file again: names clash, nothing is replaced.
  const optionsBefore = await options(page)
  const preview = await importFile(page, allPath)
  test.check(
    'the preview says what will be added, before anything is',
    /2 presets will be added/.test(preview) &&
      /Passports 2/.test(preview) &&
      /Labels 2/.test(preview),
    preview.replace(/\n/g, ' | '),
  )
  test.check(
    'it explains the renames and says nothing is replaced',
    /Renamed/.test(preview) && /not changed or replaced/.test(preview),
  )
  test.check('nothing has changed yet', sameJson(await storedNames(page), ['Passports', 'Labels']))
  await cancelDialog(page)
  test.check('Cancel adds nothing', sameJson(await storedNames(page), ['Passports', 'Labels']))
  await importFile(page, allPath, { confirm: true })
  const after = await stored(page)
  test.check(
    'confirming adds them with new names and new ids',
    sameJson(
      after.presets.map((p) => p.name),
      ['Passports', 'Labels', 'Passports 2', 'Labels 2'],
    ) && new Set(after.presets.map((p) => p.id)).size === 4,
  )
  test.check(
    'the existing presets are untouched',
    sameJson(
      after.presets.slice(0, 2).map((p) => p.id),
      idsBefore,
    ),
  )
  test.check(
    'a toast says how many were added',
    (await toast(page).first().innerText()).includes('Added 2 presets'),
  )
  test.check(
    'importing did not change the current options or the active preset',
    sameJson(await options(page), optionsBefore) && (await label(page)).startsWith('Presets'),
  )
  test.check(
    'imported settings equal the exported ones',
    sameJson(after.presets[2].settings, after.presets[0].settings),
  )

  // Bad files
  const cases = [
    ['not JSON', file('bad.json', '{nope'), /not JSON/],
    [
      'a JSON file that is not presets',
      file('other.json', JSON.stringify({ hello: 1 })),
      /not a Sheetfit presets file/,
    ],
    [
      'a list of presets without the marker',
      file('list.json', JSON.stringify([{ name: 'x', settings: settingsOf() }])),
      /not a Sheetfit presets file/,
    ],
    [
      'a newer version',
      file('newer.json', JSON.stringify({ format: 'sheetfit-presets', version: 2, presets: [] })),
      /newer version/,
    ],
    ['no presets', file('empty.json', exportFile([])), /no presets/],
    [
      'a file that is far too big',
      file(
        'huge.json',
        exportFile([{ name: 'a', settings: settingsOf() }], { pad: 'x'.repeat(700 * 1024) }),
      ),
      /too big/,
    ],
  ]
  for (const [what, path, expected] of cases) {
    const text = await importFile(page, path)
    test.check(
      `${what} is refused with a plain reason and nothing is added`,
      expected.test(text) && !/^Add /m.test(text) && (await storedNames(page)).length === 4,
      text.replace(/\n/g, ' | ').slice(0, 140),
    )
    await cancelDialog(page)
  }

  // A mixed file: good, clamped, hostile and malformed entries.
  const mixed = file(
    'mixed.json',
    exportFile([
      { name: 'Good', settings: settingsOf({ sheetSize: 'a3' }) },
      { name: 'Out of range', settings: settingsOf({ margin: 9999, gap: -4, baseDpi: 'fast' }) },
      { name: '<img src=x onerror=alert(1)>', settings: settingsOf() },
      { name: '__proto__', settings: { margin: 5, __proto__: { polluted: 1 } } },
      { name: 'Long '.repeat(300), settings: settingsOf() },
      { settings: settingsOf() },
      { name: 'No settings' },
      7,
      null,
      { name: 'Only unknown fields', settings: { evil: 'x' } },
    ]),
  )
  const mixedPreview = await importFile(page, mixed)
  test.check(
    'a mixed file previews the good entries and says what is skipped and why',
    /5 presets will be added/.test(mixedPreview) &&
      /5 will be skipped/.test(mixedPreview) &&
      /has no name/.test(mixedPreview) &&
      /has no settings/.test(mixedPreview) &&
      /not a preset/.test(mixedPreview),
    mixedPreview.replace(/\n/g, ' | ').slice(0, 300),
  )
  test.check(
    'it flags the values that were brought inside their limits',
    /adjusted/.test(mixedPreview),
  )
  await page.locator('[role=dialog]').getByRole('button', { name: /^Add / }).click()
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
  await sleep(page, 200)
  const mixedStored = (await stored(page)).presets.slice(4)
  const clamped = mixedStored.find((p) => p.name === 'Out of range')
  test.check(
    'in the store the out-of-range values are clamped and nothing invalid got in',
    clamped.settings.margin === 50 &&
      clamped.settings.gap === 0 &&
      clamped.settings.baseDpi === 300,
  )
  test.check(
    'a hostile name is kept as plain text and shown as text, never run',
    mixedStored.some((p) => p.name === '<img src=x onerror=alert(1)>') &&
      (await page.locator('img[src="x"]').count()) === 0,
  )
  test.check(
    'long names are cut to 40 characters',
    mixedStored.every((p) => [...p.name].length <= 40),
  )
  test.check(
    'the prototype was not polluted',
    await page.evaluate(() => ({}).polluted === undefined),
  )
  test.check(
    'no alert or error came from the file',
    app.log.errors.length === 0,
    app.log.errors.join('; '),
  )
  await app.close()
}

// --- 3. Persistence, independence from the persisted options, Reset ---------------------------------
const rawOf = (page, key) => page.evaluate((k) => localStorage.getItem(k), key)
{
  const app = await open({ dev: true, init: watchWorkers() })
  const { page } = app
  await withPhotos(page)
  await setOptions(page, { sheetSize: 'a3', margin: 11 })
  await save(page, 'Persisted')
  await setOptions(page, { sheetSize: 'a5', gap: 2 })
  await sleep(page, 300)
  const optionsRaw = await rawOf(page, 'sheetfit:v1')
  const presetsRaw = await rawOf(page, PRESETS_KEY)
  test.check(
    'the persisted print options and the presets live under different keys',
    'sheetfit:v1' !== PRESETS_KEY && presetsRaw !== null && optionsRaw !== null,
  )
  test.check('the persisted options do not contain presets', !/Persisted/.test(optionsRaw))

  // Presets changes never write the options, and option changes never write the presets.
  await managed(page, 'Persisted', 'Duplicate')
  await managed(page, 'Persisted copy', 'Rename…')
  await page.getByLabel('Name', { exact: true }).fill('Second')
  await page.getByLabel('Name', { exact: true }).press('Enter')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
  await managed(page, 'Second', 'Delete')
  test.check(
    'saving, renaming, duplicating and deleting presets leave the stored options byte for byte alone',
    (await rawOf(page, 'sheetfit:v1')) === optionsRaw,
  )
  const presetsNow = await rawOf(page, PRESETS_KEY)
  await setOptions(page, { margin: 3, gap: 1, ordering: 'strict', unit: 'in', showMargins: false })
  await sleep(page, 300)
  test.check(
    'changing the print options leaves the stored presets byte for byte alone',
    (await rawOf(page, PRESETS_KEY)) === presetsNow,
  )
  await setOptions(page, {
    sheetSize: 'a5',
    gap: 2,
    margin: 5,
    ordering: 'optimize',
    unit: 'mm',
    showMargins: true,
  })

  // Applying goes through the normal options path and is persisted by it.
  await apply(page, 'Persisted')
  await sleep(page, 300)
  const persistedOptions = JSON.parse(await rawOf(page, 'sheetfit:v1')).state.options
  test.check(
    'applying a preset is saved as the last-used options like any other change',
    persistedOptions.sheetSize === 'a3' && persistedOptions.margin === 11,
  )

  // Reload: both come back.
  await page.reload()
  await sleep(page, 700)
  test.check(
    'after a reload the preset, the active mark and the options are all back',
    (await label(page)) === 'Presets: Persisted' && (await options(page)).sheetSize === 'a3',
  )

  // Independence, direction 1: the options key is lost or corrupted.
  await page.evaluate(() => localStorage.setItem('sheetfit:v1', '{oops'))
  await page.reload()
  await sleep(page, 600)
  test.check(
    'with the options storage corrupted the app starts on defaults and the presets are intact',
    (await options(page)).sheetSize === 'a4' && (await storedNames(page)).includes('Persisted'),
  )
  test.check(
    'and the preset is then correctly shown as modified, not wrongly as applied',
    (await label(page)) === 'Presets: Persisted Modified',
  )
  // Direction 2: the presets key is lost.
  await apply(page, 'Persisted')
  await sleep(page, 300)
  await page.evaluate((k) => localStorage.removeItem(k), PRESETS_KEY)
  await page.reload()
  await sleep(page, 600)
  test.check(
    'with the presets storage gone the options are intact and the list is empty',
    (await options(page)).sheetSize === 'a3' &&
      (await label(page)) === 'Presets' &&
      (await storedNames(page)).length === 0,
  )
  await page.evaluate((k) => localStorage.setItem(k, '{broken'), PRESETS_KEY)
  await page.reload()
  await sleep(page, 600)
  test.check(
    'with the presets storage corrupted the options are intact too',
    (await options(page)).sheetSize === 'a3',
  )
  clean(app, 'persistence')
  await app.close()
}

{
  const app = await open({
    dev: true,
    init: seed(
      seeded(['Passports', { margin: 8, sheetSize: 'a5' }], ['Labels', { cutGuides: true }]),
    ),
  })
  const { page } = app
  await sleep(page, 500)
  await withPhotos(page)
  await apply(page, 'Passports')
  const presetsBefore = await rawOf(page, PRESETS_KEY)
  await page.click('#print-options-button')
  await sleep(page, 500)
  await page.getByRole('button', { name: 'Reset to defaults' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reset to defaults' }).click()
  await sleep(page, 400)
  const reset = await options(page)
  test.check(
    'Reset to defaults still resets every print option',
    reset.sheetSize === 'a4' && reset.margin === 5 && reset.unit === 'mm',
  )
  test.check(
    'and does not delete or change any preset',
    (await rawOf(page, PRESETS_KEY)) === presetsBefore && (await storedNames(page)).length === 2,
  )
  test.check(
    'the preset applied before is now shown as modified',
    (await label(page)) === 'Presets: Passports Modified',
  )
  await page.keyboard.press('Escape')
  await sleep(page, 300)
  clean(app, 'reset')
  await app.close()
}

// --- 4. What storage may hold ----------------------------------------------------------------------
{
  // Corrupted text.
  let app = await open({ dev: true, init: seed('{definitely not json') })
  await sleep(app.page, 900)
  test.check(
    'unreadable saved text is reported in a toast and the list starts empty',
    /couldn’t be read/.test((await toast(app.page).allInnerTexts()).join(' ')) &&
      (await label(app.page)) === 'Presets',
  )
  await openMenu(app.page)
  test.check('the menu repeats it', /couldn’t be read/.test(await menu(app.page).innerText()))
  await closeMenu(app.page)
  await save(app.page, 'Fresh')
  test.check(
    'saving then replaces the unreadable text with a valid list',
    sameJson(await storedNames(app.page), ['Fresh']),
  )
  clean(app, 'corrupt text')
  await app.close()

  // Some entries bad.
  const mixedDoc = {
    version: 1,
    presets: [
      { id: 'a', name: 'Fine', settings: settingsOf() },
      { id: 'b', name: 'Out of range', settings: settingsOf({ margin: 5000 }) },
      12,
      { name: '', settings: settingsOf() },
      { name: 'Same', settings: settingsOf() },
      { name: 'same', settings: settingsOf({ gap: 1 }) },
    ],
    activeId: 'a',
  }
  app = await open({ dev: true, init: seed(mixedDoc) })
  await sleep(app.page, 900)
  const text = (await toast(app.page).allInnerTexts()).join(' ')
  test.check(
    'the valid presets are kept and the toast says what was skipped and adjusted',
    /2 saved presets couldn’t be used/.test(text) &&
      /1 preset had values outside their limits/.test(text),
    text,
  )
  test.check(
    'the stored active preset is restored',
    (await label(app.page)).startsWith('Presets: Fine'),
  )
  await openMenu(app.page)
  const items = await app.page.getByRole('menuitemradio').allInnerTexts()
  test.check(
    'the menu lists the good ones with unique names',
    sameJson(
      items.map((i) => i.split('\n')[0]),
      ['Fine', 'Out of range', 'Same', 'same 2'],
    ),
    items.join('|'),
  )
  await app.page.getByRole('menuitemradio', { name: 'Out of range' }).click()
  await sleep(app.page, 300)
  test.check(
    'a stored out-of-range value reaches the options only after being clamped',
    (await options(app.page)).margin === 50,
  )
  await apply(app.page, 'Fine')
  clean(app, 'mixed doc')
  await app.close()

  // A thousand presets.
  const thousand = {
    version: 1,
    presets: Array.from({ length: 1000 }, (_, i) => ({
      id: `p${i}`,
      name: `Preset ${i}`,
      settings: settingsOf({ margin: i % 50 }),
    })),
    activeId: null,
  }
  app = await open({ dev: true, init: seed(thousand) })
  await sleep(app.page, 900)
  await openMenu(app.page)
  test.check(
    'a thousand stored presets load as 50 with a notice, and the menu scrolls inside the window',
    (await app.page.getByRole('menuitemradio').count()) === 50 &&
      /950 saved presets/.test((await toast(app.page).allInnerTexts()).join(' ')),
  )
  const box = await menu(app.page).boundingBox()
  test.check(
    'the menu stays inside the viewport',
    box.y >= 0 && box.y + box.height <= 900,
    JSON.stringify(box),
  )
  await closeMenu(app.page)
  await app.close()

  // A newer version: usable, never written.
  const future = JSON.stringify({
    version: 2,
    presets: [
      {
        id: 'f',
        name: 'From the future',
        settings: settingsOf({ sheetSize: 'a3' }),
        brandNew: true,
      },
    ],
    extra: 1,
  })
  app = await open({ dev: true, init: seed(future) })
  const { page } = app
  await sleep(page, 900)
  await openMenu(page)
  const futureMenu = await menu(page).innerText()
  test.check(
    'presets from a newer version are listed with a plain explanation',
    /newer version of Sheetfit/.test(futureMenu) && /From the future/.test(futureMenu),
  )
  test.check(
    'saving and importing are disabled for them',
    (await page
      .getByRole('menuitem', { name: 'Save current settings…' })
      .getAttribute('aria-disabled')) === 'true' &&
      (await page
        .getByRole('menuitem', { name: 'Import presets…' })
        .getAttribute('aria-disabled')) === 'true',
  )
  await page.getByRole('menuitemradio', { name: 'From the future' }).click()
  await sleep(page, 400)
  test.check('applying still works', (await options(page)).sheetSize === 'a3')
  await (await menuItem(page, 'Manage presets')).click()
  await page.getByRole('menuitem', { name: 'From the future', exact: true }).click()
  test.check(
    'rename, duplicate and delete are disabled; export is not',
    (await page
      .getByRole('menuitem', { name: 'Delete', exact: true })
      .getAttribute('aria-disabled')) === 'true' &&
      (await page
        .getByRole('menuitem', { name: 'Rename…', exact: true })
        .getAttribute('aria-disabled')) === 'true' &&
      (await page
        .getByRole('menuitem', { name: 'Export', exact: true })
        .getAttribute('aria-disabled')) === null,
  )
  await closeMenu(page)
  test.check(
    'the newer version’s data is left exactly as it was',
    (await rawOf(page, PRESETS_KEY)) === future,
  )
  clean(app, 'newer version')
  await app.close()
}

// --- 5. Storage that fails ---------------------------------------------------------------------------
const nonStorageErrors = (app) =>
  app.log.errors.filter((e) => !/zustand persist|Unable to update item|Unable to get item/i.test(e))
{
  // Full: the browser refuses writes to the presets key.
  const full = `(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (window.__full && key === '${PRESETS_KEY}') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })()`
  const app = await open({ dev: true, init: full })
  const { page } = app
  await sleep(page, 500)
  await save(page, 'Saved before')
  await page.evaluate(() => (window.__full = true))
  await setOptions(page, { sheetSize: 'a3' })
  await save(page, 'Only in memory')
  const said = (await toast(page).first().innerText()).replace(/\n/g, ' ')
  test.check(
    'when storage is full the save still works and the toast says it will not last',
    /Saved “Only in memory”/.test(said) &&
      /storage is full/.test(said) &&
      /until you close or reload the tab/.test(said),
    said,
  )
  await openMenu(page)
  const fullMenu = await menu(page).innerText()
  test.check(
    'the menu lists the in-memory preset and says why it may be lost',
    /Only in memory/.test(fullMenu) && /storage is full/.test(fullMenu),
  )
  test.check(
    'and tells the person to export to keep a copy',
    /Export them to keep a copy/.test(fullMenu),
  )
  await closeMenu(page)
  test.check(
    'nothing about it reached storage',
    !(await storedNames(page)).includes('Only in memory'),
  )
  await setOptions(page, { sheetSize: 'a5' })
  await apply(page, 'Only in memory')
  test.check('applying an in-memory preset works', (await options(page)).sheetSize === 'a3')
  await page.evaluate(() => (window.__full = false))
  await save(page, 'After recovery')
  test.check(
    'once storage accepts writes again everything is saved, including what was only in memory',
    sameJson(await storedNames(page), ['Saved before', 'Only in memory', 'After recovery']),
  )
  await openMenu(page)
  test.check('and the warning goes away', !/storage is full/.test(await menu(page).innerText()))
  await closeMenu(page)
  test.check(
    'quota errors never surfaced as page errors',
    nonStorageErrors(app).length === 0,
    nonStorageErrors(app).join('; '),
  )
  await app.close()
}
{
  // Disabled: touching localStorage throws, as in some privacy modes.
  const disabled = `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError') } })`
  const app = await open({ dev: true, init: disabled })
  const { page } = app
  await sleep(page, 700)
  test.check(
    'the app loads and works with no storage at all',
    (await page.locator('#presets-button').count()) === 1 &&
      (await page.locator('#print-options-button').count()) === 1,
  )
  await openMenu(page)
  test.check(
    'the menu says presets will not be kept',
    /can’t save presets/.test(await menu(page).innerText()),
  )
  await closeMenu(page)
  await setOptions(page, { sheetSize: 'a3' })
  await save(page, 'Temporary')
  const text = (await toast(page).first().innerText()).replace(/\n/g, ' ')
  test.check(
    'a save still works for this tab and the toast says it lasts only until the tab closes',
    /Saved “Temporary”/.test(text) && /until you close or reload the tab/.test(text),
    text,
  )
  await setOptions(page, { sheetSize: 'a5' })
  await apply(page, 'Temporary')
  test.check(
    'apply, rename, duplicate and delete all work in memory',
    (await options(page)).sheetSize === 'a3',
  )
  await managed(page, 'Temporary', 'Duplicate')
  await openMenu(page)
  test.check('the duplicate is there', (await page.getByRole('menuitemradio').count()) === 2)
  await closeMenu(page)
  test.check(
    'no uncaught errors',
    app.log.errors.filter((e) => e.startsWith('pageerror')).length === 0,
    app.log.errors.join('; ').slice(0, 300),
  )
  await app.close()
}

// --- 6. Two tabs -----------------------------------------------------------------------------------
{
  const app = await open({ dev: true, init: watchWorkers() })
  const a = app.page
  const b = await app.context.newPage()
  const errorsB = []
  b.on('pageerror', (error) => errorsB.push(error.message))
  await b.addInitScript(watchWorkers())
  await b.goto(app.url)
  await sleep(a, 700)
  await setOptions(a, { sheetSize: 'a3', margin: 14 })
  await save(a, 'From A')
  await b.waitForFunction(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.presets?.length === 1,
    PRESETS_KEY,
  )
  await sleep(b, 300)
  await openMenu(b)
  test.check(
    'a preset saved in one tab appears in the other without a reload',
    (await b.getByRole('menuitemradio', { name: 'From A' }).count()) === 1,
  )
  test.check(
    'and the other tab is told in the live region',
    /updated in another tab/.test(
      await b.evaluate(() =>
        [...document.querySelectorAll('[role=status]')].map((e) => e.textContent).join(' '),
      ),
    ),
  )
  await closeMenu(b)
  const bOptions = await options(b)
  const liveText = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('[role=status]')].map((e) => e.textContent).join(' '),
    )
  await b.evaluate(async () =>
    (await import('/src/store/index.ts')).useAppStore.getState().announce('marker'),
  )
  await sleep(b, 200)
  await setOptions(a, { sheetSize: 'a5', margin: 3 })
  await apply(a, 'From A')
  await sleep(a, 300)
  test.check(
    'applying a preset in one tab writes the same key but does not announce a change in the other',
    /marker/.test(await liveText(b)),
    await liveText(b),
  )
  test.check(
    'applying in one tab does not change the other tab’s options or active preset',
    sameJson(await options(b), bOptions) && (await label(b)) === 'Presets',
  )
  await save(b, 'From B')
  await sleep(a, 400)
  await openMenu(a)
  test.check(
    'a save in the second tab shows up in the first',
    (await a.getByRole('menuitemradio').count()) === 2,
  )
  await closeMenu(a)

  // The first tab has From A active. The second deletes it.
  const aOptions = await options(a)
  await managed(b, 'From A', 'Delete')
  await sleep(a, 500)
  test.check(
    'deleting the active preset in another tab drops it from this tab, which keeps its options',
    (await label(a)).startsWith('Presets') &&
      !(await label(a)).includes('From A') &&
      sameJson(await options(a), aOptions) &&
      (await storedNames(a)).join() === 'From B',
  )

  // Saves made one after the other, as a person makes them, from alternating tabs: none is lost.
  for (let round = 0; round < 8; round++) {
    await save(round % 2 === 0 ? a : b, `Turn ${round}`)
    await sleep(a, 150)
  }
  const turns = (await storedNames(a)).filter((name) => name.startsWith('Turn '))
  test.check(
    'eight saves from alternating tabs, one after the other, are all kept',
    turns.length === 8,
    turns.join(),
  )

  // Writes that land within a few milliseconds of each other from two tabs are a known limit of
  // localStorage across processes: one of them can be lost. What must hold is that both tabs and
  // the storage end on the same valid list, and that at least one of the two is kept.
  let diverged = 0
  let both = 0
  for (let round = 0; round < 5; round++) {
    await Promise.all([save(a, `Race A${round}`), save(b, `Race B${round}`)])
    await sleep(a, 400)
    const listOf = (page) =>
      page.evaluate(async () =>
        (await import('/src/store/presets.ts')).presetBook.store
          .getState()
          .presets.map((p) => p.id + ':' + p.name),
      )
    const [inA, inB] = [await listOf(a), await listOf(b)]
    const onDisk = ((await stored(a))?.presets ?? []).map((p) => p.id + ':' + p.name)
    const raced = (list) => list.filter((entry) => entry.includes('Race '))
    if (!sameJson(inA, inB) || !sameJson(inA, onDisk)) diverged++
    if (
      raced(onDisk).some((e) => e.endsWith(`Race A${round}`)) &&
      raced(onDisk).some((e) => e.endsWith(`Race B${round}`))
    )
      both++
    if (new Set(onDisk.map((e) => e.split(':')[0])).size !== onDisk.length) diverged++
  }
  test.check(
    'saves from two tabs within milliseconds still leave both tabs and the storage on one valid list',
    diverged === 0,
    `${diverged} rounds diverged (${both} of 5 kept both saves)`,
  )
  test.check(
    'no page errors in either tab',
    app.log.errors.length === 0 && errorsB.length === 0,
    `${app.log.errors.join('; ')} ${errorsB.join('; ')}`,
  )
  await app.close()
}

// --- 7. Safe while the packer and the exporter run ---------------------------------------------------
const finalLayout = (page) =>
  page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/index.ts')
    const { buildLayoutInput } = await import('/src/lib/layout-input.ts')
    const { toLayoutResult } = await import('/src/packing/result.ts')
    const { validateLayout } = await import('/src/packing/testing/validate.ts')
    const { images, options } = useAppStore.getState()
    const input = buildLayoutInput(images, options)
    const messages = window.__packing.received.filter((m) => m.layout)
    const newest = Math.max(...messages.map((m) => m.id))
    const layout = toLayoutResult(input, messages.filter((m) => m.id === newest).at(-1).layout)
    const runs = window.__packing.sent.filter((m) => m.type === 'run')
    return {
      errors: validateLayout(input, layout),
      sheetWidth: layout.sheetWidth,
      sheetHeight: layout.sheetHeight,
      sheets: layout.sheets.length,
      domSheets: document.querySelectorAll('[data-sheet-page]').length,
      pieces: input.pieces.length,
      domPieces: document.querySelectorAll('[data-sheet-page] .group\\/piece').length,
      newest,
      lastRun: Math.max(...runs.map((m) => m.id)),
      runs: runs.length,
    }
  })
/** The final layout once the preview has finished swapping pieces in and out. */
async function settledLayout(page) {
  let found = await finalLayout(page)
  for (
    let i = 0;
    i < 40 && (found.domPieces !== found.pieces || found.domSheets !== found.sheets);
    i++
  ) {
    await page.waitForTimeout(250)
    found = await finalLayout(page)
  }
  return found
}
/** Waits until no new packing message has been sent for a moment. */
async function quiet(page, ms = 500) {
  let last = -1
  for (;;) {
    const sent = await page.evaluate(() => window.__packing.sent.length)
    if (sent === last) return
    last = sent
    await page.waitForTimeout(ms)
  }
}
/** Delivers the packer's final message late, so a search stays "Optimizing…" for a while. */
const holdDone = (ms) => `(() => {
  const Base = window.Worker
  window.Worker = class extends Base {
    constructor(url, options) {
      super(url, options)
      if (!String(url).includes('packing.worker')) return
      const add = this.addEventListener.bind(this)
      this.addEventListener = (type, listener, ...rest) =>
        type === 'message' && rest[0] !== true
          ? add(type, (event) => (event.data?.type === 'done' ? setTimeout(() => listener(event), ${ms}) : listener(event)), ...rest)
          : add(type, listener, ...rest)
    }
  }
})()`
const slowExport = (ms) => `(() => {
  const Base = window.Worker
  window.Worker = class extends Base {
    constructor(url, options) {
      super(url, options)
      if (!String(url).includes('export.worker')) return
      const add = this.addEventListener.bind(this)
      this.addEventListener = (type, listener, ...rest) =>
        type === 'message' ? add(type, (event) => setTimeout(() => listener(event), ${ms}), ...rest) : add(type, listener, ...rest)
    }
  }
})()`
const SHAPES = [
  ['Portrait A4', { sheetSize: 'a4', orientation: 'portrait', gap: 0, margin: 5 }],
  ['Letter landscape', { sheetSize: 'letter', orientation: 'landscape', gap: 2, margin: 8 }],
  ['Custom tall', { sheetSize: 'custom', customWidth: 100, customHeight: 150, margin: 3, gap: 1 }],
  ['A3 strict', { sheetSize: 'a3', ordering: 'strict', cutGuides: true, margin: 10 }],
]
const shapeSeed = () => seed(seeded(...SHAPES))
{
  const app = await open({
    dev: true,
    init: shapeSeed() + ';' + watchWorkers() + ';' + holdDone(1500),
  })
  const { page } = app
  await sleep(page, 500)
  await addGenerated(
    page,
    Array.from({ length: 6 }, (_, i) => ({
      width: 500 + i * 60,
      height: 400 + ((i * 130) % 300),
      name: `s${i}.jpg`,
    })),
  )
  await waitForImages(page, 6)
  await sleep(page, 500)
  await page.click('button:has-text("More")')
  await page.click('[role=menuitem]:has-text("Set all copies")')
  const field = page.locator('[aria-label="Number of copies for every image"]')
  await field.fill('60')
  await field.press('Enter')
  // The snapshot is taken with the menu already open, a moment before the click that applies.
  await openMenu(page)
  const before = await page.evaluate(() => {
    const last = window.__packing.sent.filter((m) => m.type === 'run').at(-1).id
    return {
      runs: last,
      searching: /Optimizing/.test(document.body.innerText),
      sheets: document.querySelectorAll('[data-sheet-page]').length,
    }
  })
  test.check(
    'the packer is still searching when the preset is applied',
    before.searching,
    JSON.stringify(before),
  )
  await page.getByRole('menuitemradio', { name: /^Letter landscape( Modified)?$/ }).click()
  const during = await page.evaluate(() => ({
    sheets: document.querySelectorAll('[data-sheet-page]').length,
  }))
  test.check(
    'the previous layout stays on screen until the new one arrives',
    during.sheets === before.sheets && during.sheets > 0,
    `${during.sheets} sheets`,
  )
  await page.waitForFunction(
    (id) => window.__packing.sent.some((m) => m.type === 'run' && m.id > id),
    before.runs,
  )
  await quiet(page, 700)
  const sent = await page.evaluate(() => window.__packing.sent.slice())
  const newRuns = sent.filter((m) => m.type === 'run' && m.id > before.runs).length
  test.check('exactly one new packing run started', newRuns === 1, `${newRuns} runs`)
  test.check(
    'the run that was still searching was cancelled',
    sent.some((m) => m.type === 'cancel' && m.id === before.runs),
    JSON.stringify({ before, tail: sent.slice(-3) }),
  )
  await waitForSettled(page)
  await sleep(page, 500)
  const settled = await settledLayout(page)
  test.check(
    'the layout that ends up on screen is valid and belongs to the preset’s settings',
    settled.errors.length === 0 &&
      Math.abs(settled.sheetWidth - 279.4) < 1e-6 &&
      Math.abs(settled.sheetHeight - 215.9) < 1e-6 &&
      settled.domSheets === settled.sheets &&
      settled.domPieces === settled.pieces,
    `${settled.sheetWidth}x${settled.sheetHeight}, ${settled.domPieces}/${settled.pieces} pieces`,
  )

  // A storm: forty applies in one tick, cycling through the shapes.
  const runsBefore = (await finalLayout(page)).runs
  await page.evaluate(async () => {
    const { applyPreset } = await import('/src/features/presets/actions.ts')
    const { presetBook } = await import('/src/store/presets.ts')
    const ids = presetBook.store.getState().presets.map((p) => p.id)
    for (let i = 0; i < 40; i++) applyPreset(ids[i % ids.length])
  })
  await waitForSettled(page)
  await sleep(page, 900)
  const storm = await settledLayout(page)
  test.check(
    'after forty rapid applies the screen shows the layout for the final settings',
    storm.errors.length === 0 &&
      Math.abs(storm.sheetWidth - 297) < 1e-6 &&
      storm.domSheets === storm.sheets &&
      storm.domPieces === storm.pieces,
    `${storm.sheetWidth}x${storm.sheetHeight}`,
  )
  test.check(
    'no more than one run per change started, and the screen follows the newest run',
    storm.runs - runsBefore <= 40 && storm.newest === storm.lastRun,
    `${storm.runs - runsBefore} runs, newest ${storm.newest}/${storm.lastRun}`,
  )
  test.check(
    'the label and the options agree on the final preset',
    (await label(page)) === 'Presets: A3 strict' && (await options(page)).sheetSize === 'a3',
  )

  // The same through the menu, from the keyboard.
  await page.locator('#presets-button').focus()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter')
    await page.getByRole('menu').first().waitFor()
    await page.keyboard.press('ArrowDown')
    for (let k = 0; k < i % 4; k++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !document.querySelector('[role=menu]'))
    // Radix hands focus back one timer tick after the menu is gone.
    await page.waitForFunction(() => document.activeElement?.id === 'presets-button')
  }
  test.check('after each apply from the keyboard focus is back on the control', true)
  await waitForSettled(page)
  await sleep(page, 900)
  const keyed = await settledLayout(page)
  test.check(
    'six applies through the menu in quick succession also end on a valid layout for the final settings',
    keyed.errors.length === 0 && keyed.domPieces === keyed.pieces && keyed.newest === keyed.lastRun,
  )
  test.check('no page errors', app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
}

{
  // During an export. The export dialog is modal, so a person cannot reach the menu behind it; this
  // drives the same action directly to prove the export works from the settings it started with.
  const app = await open({ dev: true, init: shapeSeed() + ';' + slowExport(1800) })
  const { page } = app
  await sleep(page, 500)
  await withPhotos(page)
  await setOptions(page, { sheetSize: 'a4', orientation: 'portrait' })
  await sleep(page, 700)
  await page.click('button[aria-label="Download PDF"]')
  await page.getByRole('dialog').waitFor()
  await sleep(page, 300)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(async () => {
      const { applyPreset } = await import('/src/features/presets/actions.ts')
      const { presetBook } = await import('/src/store/presets.ts')
      const letter = presetBook.store.getState().presets.find((p) => p.name === 'Letter landscape')
      applyPreset(letter.id)
    }),
  ])
  const pdfPath = join(scratch, 'during-export.pdf')
  await download.saveAs(pdfPath)
  const pageSize = (path) =>
    /Page size:\s+([\d.]+) x ([\d.]+)/
      .exec(execFileSync('pdfinfo', [path], { encoding: 'utf8' }))
      .slice(1)
      .map(Number)
  const [w, h] = pageSize(pdfPath)
  test.check(
    'an export that was running keeps the settings it started with (A4 portrait)',
    Math.abs(w - 595.276) < 1 && Math.abs(h - 841.89) < 1,
    `${w} x ${h} pt`,
  )
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await waitForSettled(page).catch(() => {})
  await sleep(page, 600)
  test.check(
    'and the preview now follows the applied preset',
    (await options(page)).sheetSize === 'letter' &&
      (await label(page)) === 'Presets: Letter landscape',
  )
  await page.click('button[aria-label="Download PDF"]')
  const [second] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('dialog').waitFor(),
  ])
  const secondPath = join(scratch, 'after-export.pdf')
  await second.saveAs(secondPath)
  const [w2, h2] = pageSize(secondPath)
  test.check(
    'the next export uses the new preset (Letter landscape)',
    Math.abs(w2 - 792) < 1 && Math.abs(h2 - 612) < 1,
    `${w2} x ${h2} pt`,
  )
  test.check('no page errors', app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
}

// --- 8. Keyboard only --------------------------------------------------------------------------------
{
  const app = await open({ dev: true })
  const { page } = app
  await sleep(page, 500)
  const active = () =>
    page.evaluate(
      () =>
        document.activeElement?.id ||
        document.activeElement?.getAttribute('aria-label') ||
        document.activeElement?.textContent?.trim().slice(0, 40),
    )
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  let reached = false
  for (let i = 0; i < 8 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = (await active()) === 'presets-button'
  }
  test.check('Tab reaches the presets control, before the other header actions', reached)
  await page.keyboard.press('Enter')
  await menu(page).waitFor()
  test.check(
    'Enter opens the menu and focus moves into it',
    await page.evaluate(() => document.activeElement?.closest('[role=menu]') !== null),
  )
  let escaped = 0
  for (const key of [...Array(8).fill('Tab'), ...Array(3).fill('Shift+Tab')]) {
    await page.keyboard.press(key)
    if (!(await page.evaluate(() => document.activeElement?.closest('[role=menu]') !== null)))
      escaped++
  }
  test.check(
    'Tab and Shift+Tab cannot move focus out of an open menu to the page behind it',
    escaped === 0 && (await menu(page).count()) === 1,
    `${escaped} presses left the menu`,
  )
  const style = await page.evaluate(
    () =>
      getComputedStyle(document.activeElement).outlineStyle +
      '|' +
      document.activeElement.hasAttribute('data-highlighted'),
  )
  test.check('the focused item is visibly highlighted', /true/.test(style))
  await focusItem(page, 'Save current settings')
  await page.keyboard.press('Enter')
  const field = page.getByLabel('Name', { exact: true })
  await field.waitFor()
  test.check(
    'choosing Save from the keyboard opens the dialog with the name field focused',
    await field.evaluate((el) => el === document.activeElement),
  )
  await page.keyboard.type('Keyboard preset')
  await page.keyboard.press('Enter')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
  await sleep(page, 200)
  test.check('saving returns focus to the presets control', (await active()) === 'presets-button')
  test.check('it was saved', (await storedNames(page)).includes('Keyboard preset'))
  await setOptions(page, { sheetSize: 'a3' })
  await page.keyboard.press('Enter')
  await menu(page).waitFor()
  const role = () => page.evaluate(() => document.activeElement?.getAttribute('role'))
  await sleep(page, 300)
  test.check('opening the menu puts focus on the first preset', (await role()) === 'menuitemradio')
  await page.keyboard.press('ArrowDown')
  await sleep(page, 200)
  test.check('ArrowDown moves on to the next item', (await role()) === 'menuitem')
  await page.keyboard.press('ArrowUp')
  await sleep(page, 200)
  test.check('and ArrowUp moves back', (await role()) === 'menuitemradio')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('[role=menu]'))
  await sleep(page, 300)
  test.check(
    'Enter applies the preset and focus comes back to the control',
    (await options(page)).sheetSize === 'a4' && (await active()) === 'presets-button',
  )
  // Into the submenus, out with the arrow keys and Escape.
  await page.keyboard.press('Enter')
  await menu(page).waitFor()
  await focusItem(page, 'Manage presets')
  await page.keyboard.press('ArrowRight')
  await sleep(page, 250)
  await page.keyboard.press('ArrowRight')
  await sleep(page, 250)
  const inSub = await page.evaluate(
    () =>
      document.activeElement
        ?.closest('[data-slot=dropdown-menu-sub-content]')
        ?.getAttribute('aria-labelledby') !== undefined,
  )
  test.check(
    'ArrowRight opens Manage presets and then the preset’s actions',
    inSub && (await page.evaluate(() => document.activeElement?.textContent)) === 'Rename…',
  )
  await page.keyboard.press('ArrowLeft')
  await sleep(page, 250)
  await page.keyboard.press('ArrowLeft')
  await sleep(page, 250)
  test.check(
    'ArrowLeft steps back out',
    (await page.evaluate(() => document.activeElement?.textContent?.includes('Manage presets'))) ===
      true,
  )
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role=menu]'))
  await sleep(page, 200)
  test.check(
    'Escape closes the menu and returns focus to the control',
    (await active()) === 'presets-button',
  )
  // Rename with keyboard only, and Escape from a dialog.
  await page.keyboard.press('Enter')
  await menu(page).waitFor()
  await focusItem(page, 'Manage presets')
  await page.keyboard.press('ArrowRight')
  await sleep(page, 250)
  await page.keyboard.press('ArrowRight')
  await sleep(page, 250)
  await page.keyboard.press('Enter')
  await field.waitFor()
  await page.keyboard.press('Escape')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
  await sleep(page, 200)
  test.check(
    'Escape cancels a dialog and focus returns to the control',
    (await active()) === 'presets-button' && (await storedNames(page)).join() === 'Keyboard preset',
  )
  test.check('no page errors', app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()
}

// --- 9. A phone ---------------------------------------------------------------------------------------
{
  const app = await open({
    dev: true,
    init: seed(seeded(['Passport photos', { margin: 8 }], ['A4 labels', { sheetSize: 'a5' }])),
  })
  const phone = await app.browser.newContext({
    viewport: { width: 390, height: 780 },
    hasTouch: true,
    isMobile: true,
    acceptDownloads: true,
  })
  await phone.addInitScript(
    seed(seeded(['Passport photos', { margin: 8 }], ['A4 labels', { sheetSize: 'a5' }])),
  )
  const page = await phone.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(app.url)
  await sleep(page, 800)
  const header = await page.evaluate(() => {
    const h = document.querySelector('header')
    const box = (el) => el.getBoundingClientRect()
    const trigger = box(document.getElementById('presets-button'))
    const nav = box(h.querySelector('nav'))
    return {
      fits: h.scrollWidth <= h.clientWidth,
      overlap: trigger.right > nav.left,
      triggerWidth: trigger.width,
      coarse: matchMedia('(pointer: coarse)').matches,
    }
  })
  test.check(
    'on a phone the presets control fits in the header beside the other actions',
    header.coarse && header.fits && !header.overlap,
  )
  test.check(
    'and it is a full-size touch target',
    header.triggerWidth >= 44,
    `${header.triggerWidth}px`,
  )
  await page.tap('#presets-button')
  await menu(page).waitFor()
  const rowHeights = async () => {
    await sleep(page, 600) // the menu scales in; measure it at full size
    return rowHeightsNow()
  }
  const rowHeightsNow = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[role=menu] [role=menuitem], [role=menu] [role=menuitemradio]',
        ),
      ].map((el) => el.getBoundingClientRect().height),
    )
  const items = await rowHeights()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role=menu]'))
  await page.getByRole('button', { name: /theme/i }).tap()
  await menu(page).waitFor()
  const themeRows = await rowHeights()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role=menu]'))
  test.check(
    'menu rows are as tall as the existing menus’ rows, which are sized for touch',
    items.length > 0 &&
      Math.min(...items) >= Math.min(...themeRows) - 0.5 &&
      Math.min(...items) >= 42,
    `presets ${items.map(Math.round)} / theme ${themeRows.map(Math.round)}`,
  )
  await page.tap('#presets-button')
  await menu(page).waitFor()
  const box = await menu(page).boundingBox()
  test.check(
    'the menu stays inside the phone screen',
    box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 780,
    JSON.stringify(box),
  )
  await page.getByRole('menuitemradio', { name: 'A4 labels' }).tap()
  await sleep(page, 500)
  test.check('tapping a preset applies it', (await options(page)).sheetSize === 'a5')
  test.check(
    'and its toast is visible on the phone',
    (await toast(page).first().isVisible()) &&
      /Applied “A4 labels”/.test(await toast(page).first().innerText()),
  )
  await page.tap('#presets-button')
  await menu(page).waitFor()
  await page.getByRole('menuitem', { name: 'Manage presets' }).tap()
  await page.getByRole('menuitem', { name: 'Passport photos', exact: true }).tap()
  test.check(
    'the submenus open by tap',
    (await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).count()) === 1,
  )
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).tap()
  const dialog = page.locator('[role=dialog]')
  await dialog.waitFor()
  await sleep(page, 300)
  const dbox = await dialog.boundingBox()
  test.check(
    'the name dialog fits the phone',
    dbox.x >= 0 && dbox.x + dbox.width <= 390 && dbox.y + dbox.height <= 780,
    JSON.stringify(dbox),
  )
  await page.getByLabel('Name', { exact: true }).fill('Passport 35x45')
  await page.getByRole('button', { name: 'Rename' }).tap()
  await dialog.waitFor({ state: 'detached' })
  test.check('renaming by tap works', (await storedNames(page)).includes('Passport 35x45'))
  test.check(
    'the page does not scroll sideways',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  )
  test.check('no page errors', errors.length === 0, errors.join('; '))
  await phone.close()
  await app.close()
}

// --- 9b. Dialog buttons, and an import with nothing to add -------------------------------------------
{
  const app = await open({ dev: true, init: seed(seeded(['Only', {}])) })
  const { page } = app
  await sleep(page, 600)
  const back = () => page.evaluate(() => document.activeElement?.id === 'presets-button')
  const closed = () => page.locator('[role=dialog]').waitFor({ state: 'detached' })

  await (await menuItem(page, 'Save current settings…')).click()
  await page.getByLabel('Name', { exact: true }).fill('Never saved')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await closed()
  await sleep(page, 200)
  test.check(
    'Cancel closes the save dialog without saving, and focus returns to the control',
    sameJson(await storedNames(page), ['Only']) && (await back()),
  )

  await managed(page, 'Only', 'Rename…')
  await page.getByLabel('Name', { exact: true }).fill('Renamed?')
  await page.getByRole('button', { name: 'Close' }).click()
  await closed()
  await sleep(page, 200)
  test.check(
    'the Close button closes the rename dialog without renaming, and focus returns to the control',
    sameJson(await storedNames(page), ['Only']) && (await back()),
  )

  await (await menuItem(page, 'Import presets…')).click()
  await page.locator('[role=dialog]').waitFor()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await closed()
  await sleep(page, 200)
  test.check('Cancel closes the import dialog and focus returns to the control', await back())

  const text = await importFile(
    page,
    file('nothing.json', exportFile([7, { name: 'No settings' }])),
  )
  test.check(
    'a file with nothing usable says there is nothing to add and offers no Add button',
    /nothing to add/i.test(text) &&
      /2 will be skipped/.test(text) &&
      (await page.getByRole('button', { name: /^Add / }).count()) === 0,
    text.replace(/\n/g, ' | ').slice(0, 200),
  )
  await cancelDialog(page)
  clean(app, 'dialog buttons')
  await app.close()
}

// --- 10. Accessibility and responsiveness, on the production build ------------------------------------
// Every other section runs on the dev server; this one audits what ships, so it needs `npm run build`.
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
)
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
/**
 * Runs axe (WCAG 2.2 AA). With a menu open, Radix hides the page behind it with aria-hidden and keeps
 * focus inside the menu instead of making the page inert, which axe's aria-hidden-focus rule cannot
 * see; the existing theme menu gives the same result. Pass `menu: true` for those states. A separate
 * check proves focus cannot leave an open menu.
 */
async function audit(page, label, { menu: menuOpen = false } = {}) {
  await sleep(page, 450) // let a menu or dialog finish scaling in before it is sampled
  await page.evaluate(axeSource)
  const result = await page.evaluate(
    ({ tags, skip }) =>
      axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        rules: skip ? { 'aria-hidden-focus': { enabled: false } } : {},
      }),
    { tags: TAGS, skip: menuOpen },
  )
  const bad = result.violations.map(
    (v) =>
      `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')} ${v.nodes[0].failureSummary?.split('\n')[1] ?? ''}`,
  )
  test.check(`axe, ${label}: no WCAG 2.2 AA violations`, bad.length === 0, bad.join(' | '))
}
const THREE = seeded(
  ['Passport photos', { margin: 8 }],
  ['4×6 on A3', { sheetSize: 'a3' }],
  ['Labels', { sheetSize: 'a5', cutGuides: true }],
)
const quotaInit = `(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === '${PRESETS_KEY}' && window.__full) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, key, value) } })()`
const mixedFile = file(
  'a11y-mixed.json',
  exportFile([
    { name: 'Good', settings: settingsOf({ sheetSize: 'a3' }) },
    { name: 'Passport photos', settings: settingsOf({ margin: 9999 }) },
    { settings: settingsOf() },
    7,
  ]),
)
const notPresets = file('a11y-bad.json', JSON.stringify({ hello: 'world' }))

for (const scheme of ['light', 'dark']) {
  const tag = (state) => `${scheme}, ${state}`
  const app = await open({ colorScheme: scheme, init: seed(THREE) })
  const { page } = app
  await sleep(page, 800)
  await audit(page, tag('presets control, closed'))
  await openMenu(page)
  await audit(page, tag('menu open, no preset active'), { menu: true })
  await page.getByRole('menuitemradio', { name: 'Passport photos' }).click()
  await sleep(page, 400)
  await page.click('#print-options-button')
  await sleep(page, 700)
  const margin = page.getByRole('textbox', { name: /margin/i }).first()
  await margin.fill('12')
  await margin.press('Enter')
  await page.keyboard.press('Escape')
  await sleep(page, 500)
  await openMenu(page)
  test.check(
    `${scheme}: the menu says the active preset is modified`,
    /Modified/.test(await menu(page).innerText()),
  )
  await audit(page, tag('menu open, preset modified, with Update and Revert'), { menu: true })
  await page.getByRole('menuitem', { name: 'Manage presets' }).click()
  await audit(page, tag('Manage presets submenu'), { menu: true })
  await page.getByRole('menuitem', { name: 'Labels', exact: true }).click()
  await audit(page, tag('a preset’s actions submenu'), { menu: true })
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click()
  await page.locator('[role=dialog]').waitFor()
  await audit(page, tag('rename dialog'))
  await page.keyboard.press('Escape')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })

  await (await menuItem(page, 'Save current settings…')).click()
  await page.locator('[role=dialog]').waitFor()
  await audit(page, tag('save dialog'))
  await page.getByLabel('Name', { exact: true }).press('Enter')
  await page.getByRole('alert').waitFor()
  await audit(page, tag('save dialog, name refused'))
  await page.keyboard.press('Escape')
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })

  await managed(page, 'Labels', 'Delete')
  await toast(page).first().waitFor()
  await audit(page, tag('after Delete: the toast with Undo is showing'))
  await undo(page)

  await importFile(page, notPresets)
  test.check(
    `${scheme}: a refused file shows its reason`,
    /not a Sheetfit presets file/.test(await page.locator('[role=dialog]').innerText()),
  )
  await audit(page, tag('import dialog, file refused'))
  await page.getByRole('button', { name: 'Choose another file' }).click({ trial: true })
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose another file' }).click(),
  ])
  await chooser.setFiles(mixedFile)
  await sleep(page, 300)
  await audit(page, tag('import dialog, preview with skipped entries'))
  await cancelDialog(page)
  await (await menuItem(page, 'Import presets…')).click()
  await page.locator('[role=dialog]').waitFor()
  await audit(page, tag('import dialog, choose a file'))
  await cancelDialog(page)
  test.check(`${scheme}: no page errors`, app.log.errors.length === 0, app.log.errors.join('; '))
  await app.close()

  // Empty, full-storage, unreadable and newer-version states.
  let state = await open({ colorScheme: scheme })
  await sleep(state.page, 700)
  await openMenu(state.page)
  await audit(state.page, tag('menu open, empty state'), { menu: true })
  await state.close()

  state = await open({ colorScheme: scheme, init: quotaInit })
  await sleep(state.page, 700)
  await state.page.evaluate(() => (window.__full = true))
  await save(state.page, 'Kept in memory')
  await openMenu(state.page)
  await audit(state.page, tag('menu open, storage full'), { menu: true })
  await state.close()

  state = await open({ colorScheme: scheme, init: seed('{broken') })
  await sleep(state.page, 900)
  test.check(
    `${scheme}: unreadable data is announced at load`,
    /couldn’t be read/.test((await toast(state.page).allInnerTexts()).join(' ')),
  )
  await audit(state.page, tag('unreadable saved data, toast showing'))
  await openMenu(state.page)
  await audit(state.page, tag('menu open, unreadable saved data'), { menu: true })
  await state.close()

  state = await open({
    colorScheme: scheme,
    init: seed(
      JSON.stringify({
        version: 2,
        presets: [{ id: 'f', name: 'From the future', settings: settingsOf() }],
      }),
    ),
  })
  await sleep(state.page, 700)
  await openMenu(state.page)
  await audit(state.page, tag('menu open, presets from a newer version'), { menu: true })
  await state.close()
}

// A phone, light and dark: the control, the menu and the dialogs.
for (const scheme of ['light', 'dark']) {
  const app = await open({ colorScheme: scheme, init: seed(THREE) })
  const phone = await app.browser.newContext({
    viewport: { width: 390, height: 780 },
    hasTouch: true,
    isMobile: true,
    colorScheme: scheme,
    acceptDownloads: true,
  })
  await phone.addInitScript(seed(THREE))
  const page = await phone.newPage()
  await page.goto(app.url)
  await sleep(page, 800)
  await audit(page, `phone, ${scheme}, control closed`)
  await page.tap('#presets-button')
  await menu(page).waitFor()
  await audit(page, `phone, ${scheme}, menu open`, { menu: true })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role=menu]'))
  await page.tap('#presets-button')
  await menu(page).waitFor()
  await page.getByRole('menuitem', { name: 'Save current settings…' }).tap()
  await page.locator('[role=dialog]').waitFor()
  await audit(page, `phone, ${scheme}, save dialog`)
  await phone.close()
  await app.close()
}

// Widths: a 40-character name that is active and modified, the longest the control can show.
const LONG = 'W'.repeat(40)
const longDoc = { ...seeded([LONG, { margin: 8 }], ['Other', { sheetSize: 'a3' }]), activeId: 's0' }
for (const [width, height] of [
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [390, 844],
]) {
  const app = await open({ width, height, init: seed(longDoc) })
  const { page } = app
  await sleep(page, 800)
  const fit = await page.evaluate(() => {
    const header = document.querySelector('header')
    const trigger = document.getElementById('presets-button').getBoundingClientRect()
    const nav = header.querySelector('nav').getBoundingClientRect()
    return {
      pageX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headerX: header.scrollWidth - header.clientWidth,
      overlap: trigger.right > nav.left - 4,
      label: document.getElementById('presets-button').getAttribute('aria-label'),
    }
  })
  test.check(
    `${width} px wide, long active modified name: no horizontal overflow, nothing overlaps`,
    fit.pageX <= 0 && fit.headerX <= 0 && !fit.overlap,
    JSON.stringify(fit),
  )
  test.check(
    `${width} px wide: the control says which preset and that it is modified`,
    fit.label === `Presets: ${LONG} Modified`,
  )
  const download = await page.getByRole('button', { name: 'Download PDF' }).boundingBox()
  test.check(
    `${width} px wide: Download PDF is still on screen`,
    download && download.x >= 0 && download.x + download.width <= width,
  )
  await openMenu(page)
  await sleep(page, 400)
  const box = await menu(page).boundingBox()
  test.check(
    `${width} px wide: the open menu stays inside the window`,
    box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height,
    JSON.stringify(box),
  )
  await closeMenu(page)
  await app.close()
}

// Reduced motion.
{
  const app = await open({ init: seed(THREE) })
  await app.page.emulateMedia({ reducedMotion: 'reduce' })
  await sleep(app.page, 700)
  await openMenu(app.page)
  const duration = await menu(app.page).evaluate((el) => getComputedStyle(el).animationDuration)
  test.check(
    'reduced motion: the menu does not animate in',
    parseFloat(duration) < 0.001 || duration === '0.01ms',
    duration,
  )
  await app.close()
}

// Nothing leaves the page.
{
  const app = await open({ init: seed(THREE) })
  const requests = []
  app.page.on('request', (request) => requests.push(request.url()))
  await sleep(app.page, 500)
  await save(app.page, 'Network check')
  await openMenu(app.page)
  await app.page.getByRole('menuitem', { name: 'Export all presets' }).click()
  await sleep(app.page, 500)
  const foreign = requests.filter(
    (url) => !url.startsWith(app.url) && !url.startsWith('data:') && !url.startsWith('blob:'),
  )
  test.check(
    'presets make only same-origin requests: nothing is uploaded',
    foreign.length === 0,
    foreign.join(', '),
  )
  await app.close()
}

test.done()
