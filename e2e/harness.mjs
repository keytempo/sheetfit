import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer as createViteServer } from 'vite'

const DIST = process.env.SHEETFIT_DIST ?? fileURLToPath(new URL('../dist/', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
}

/** Serves the production build (`npm run build` first) from a random local port. */
export async function serve() {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname))
    const file = join(DIST, path.endsWith(sep) || path === '/' ? 'index.html' : path)
    try {
      if (!file.startsWith(DIST)) throw new Error('outside dist')
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      })
      response.end(await readFile(file))
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/**
 * Serves the source through Vite's dev server instead. A test page can then import the app's own
 * modules (/src/...) and get the very instances the app runs, which is how the layout checks compare
 * what is on screen with what the engine says.
 */
export async function serveDev() {
  const server = await createViteServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  const url = server.resolvedUrls.local[0]
  return { url, close: () => server.close() }
}

/** Opens the app in headless Chrome and records every request and every page error. */
export async function open({
  width = 1440,
  height = 900,
  colorScheme = 'light',
  storage,
  init,
  dev = false,
  channel,
} = {}) {
  const app = dev ? await serveDev() : await serve()
  // `channel: 'chromium'` runs the full browser, which has the built-in PDF viewer the headless shell lacks.
  const browser = await chromium.launch(channel ? { channel } : {})
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    acceptDownloads: true,
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  const log = { errors: [], requests: [] }
  page.on('pageerror', (error) => log.errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      log.errors.push(`${message.type()}: ${message.text()}`)
  })
  page.on('request', (request) => log.requests.push(request.url()))
  // Only the first load gets the starting settings; a reload must see what the app saved itself.
  if (storage)
    await page.addInitScript((value) => {
      if (!localStorage.getItem('sheetfit:v1')) localStorage.setItem('sheetfit:v1', value)
    }, storage)
  if (init) await page.addInitScript(init)
  await page.goto(app.url)
  return {
    page,
    context,
    browser,
    url: app.url,
    log,
    close: async () => {
      await browser.close()
      await app.close()
    },
  }
}

export const fixture = (name) => join(FIXTURES, name)

/** Adds image files from disk through the file input, as a person using the picker would. */
export async function addFiles(page, names) {
  const before = await page.locator('ul[aria-label=Images] > li').count()
  await page.setInputFiles('input[type=file]', names.map(fixture))
  return before
}

/**
 * Makes photos inside the page with a canvas, so no image files have to be stored for big tests,
 * and keeps them under `key` without adding them. Drawing them is slow work that a measurement of
 * the app's own import must not include; `addPrepared` then hands them over in one step.
 */
export async function prepareGenerated(page, specs, key) {
  await page.evaluate(
    async ({ items, key }) => {
      const files = []
      for (const [index, spec] of items.entries()) {
        const {
          width,
          height,
          type = 'image/jpeg',
          quality = 0.7,
          name = `generated-${index}.jpg`,
        } = spec
        const canvas = new OffscreenCanvas(width, height)
        const context = canvas.getContext('2d')
        const gradient = context.createLinearGradient(0, 0, width, height)
        gradient.addColorStop(0, `hsl(${(index * 47) % 360},80%,50%)`)
        gradient.addColorStop(1, `hsl(${(index * 47 + 120) % 360},70%,40%)`)
        context.fillStyle = gradient
        context.fillRect(0, 0, width, height)
        context.fillStyle = `hsl(${(index * 91) % 360},90%,60%)`
        context.fillRect(width * 0.1, height * 0.2, width * 0.3, height * 0.15)
        const blob = await canvas.convertToBlob({ type, quality })
        files.push(new File([blob], name, { type }))
      }
      window.__prepared = { ...window.__prepared, [key]: files }
    },
    { items: specs, key },
  )
}

/** Gives the app the photos prepared under `key`, through the file input, in one change event. */
export async function addPrepared(page, key) {
  await page.evaluate((key) => {
    const transfer = new DataTransfer()
    for (const file of window.__prepared[key]) transfer.items.add(file)
    const input = document.querySelector('input[type=file]')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, key)
}

export async function addGenerated(page, specs) {
  await prepareGenerated(page, specs, 'now')
  await addPrepared(page, 'now')
}

export async function waitForImages(page, count, timeout = 60000) {
  await page.waitForSelector(`ul[aria-label=Images] > li:nth-child(${count})`, { timeout })
}

/** Runs checks and prints one line per result. The exit code is 1 if any failed. */
export function reporter(title) {
  const results = []
  console.log(`\n== ${title}`)
  return {
    check(name, ok, detail = '') {
      results.push(ok)
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
    },
    done() {
      const failed = results.filter((ok) => !ok).length
      console.log(`${results.length - failed}/${results.length} passed`)
      if (failed) process.exitCode = 1
    },
  }
}

/** Sets every image to the same number of copies through the list's More menu. */
export async function setAllCopies(page, copies) {
  await page.click('button:has-text("More")')
  await page.click('[role=menuitem]:has-text("Set all copies")')
  const field = page.locator('[aria-label="Number of copies for every image"]')
  await field.fill(String(copies))
  await field.press('Enter')
  await page.waitForTimeout(100)
}

/** Waits until the status badge no longer says the packer is still searching. */
export async function waitForSettled(page, timeout = 20000) {
  // A build from before the status badge existed (used only to compare timings) has nothing to wait for.
  if (process.env.SHEETFIT_NO_STATUS) return page.waitForTimeout(800)
  await page.waitForFunction(
    () => {
      const badge = [...document.querySelectorAll('[role=status]')].find((el) =>
        /Optimal|Best found|Time limit reached|Optimizing/.test(el.textContent ?? ''),
      )
      return badge !== undefined && !/Optimizing/.test(badge.textContent ?? '')
    },
    null,
    { timeout },
  )
}

/** Records long tasks and the longest gap between animation frames from now until `stop()`. */
export async function startFrameLog(page) {
  await page.evaluate(() => {
    const log = { tasks: [], frames: [], last: performance.now(), running: true }
    window.__frameLog = log
    log.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) log.tasks.push(entry.duration)
    })
    log.observer.observe({ entryTypes: ['longtask'] })
    const tick = (now) => {
      log.frames.push(now - log.last)
      log.last = now
      if (log.running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

export async function stopFrameLog(page) {
  return page.evaluate(async () => {
    const log = window.__frameLog
    await new Promise((resolve) => setTimeout(resolve, 150))
    log.running = false
    log.observer.disconnect()
    const sorted = [...log.frames].sort((a, b) => a - b)
    return {
      longTasks: log.tasks.length,
      longTaskMax: Math.round(Math.max(0, ...log.tasks)),
      longTaskTotal: Math.round(log.tasks.reduce((sum, t) => sum + t, 0)),
      frames: log.frames.length,
      frameMedian: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
      frameP95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      frameMax: Math.round(sorted.at(-1) ?? 0),
    }
  })
}

/**
 * Wraps the Worker class so a test can see every message the packing worker sends and every
 * request it receives. Install it with `open({ init: watchWorkers() })`. `delay` holds every answer
 * back that many milliseconds, in order, as on a slow machine, so that answers for earlier inputs
 * arrive after the inputs have changed again.
 */
export function watchWorkers(delay = 0) {
  return `(() => {
    const Original = window.Worker
    window.__packing = { sent: [], received: [], created: [], errors: [] }
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options)
        const isPacking = String(url).includes('packing.worker')
        if (isPacking) window.__packing.created.push(String(url))
        if (!isPacking) return
        const post = this.postMessage.bind(this)
        this.postMessage = (message, ...rest) => {
          window.__packing.sent.push({
            type: message.type,
            id: message.id,
            from: message.from,
            budgetMs: message.limits?.budgetMs,
            pieces: message.input?.pieces?.length,
          })
          return post(message, ...rest)
        }
        this.addEventListener('error', () => window.__packing.errors.push('worker error'))
        const record = (event) =>
          window.__packing.received.push({
            type: event.data?.type,
            id: event.data?.id,
            layout: event.data?.layout,
            stopped: event.data?.summary?.stopped,
          })
        this.addEventListener('message', record, true)
        ${
          delay > 0
            ? `
        const add = this.addEventListener.bind(this)
        this.addEventListener = (type, listener, ...rest) => {
          if (type !== 'message' || rest[0] === true) return add(type, listener, ...rest)
          return add(type, (event) => setTimeout(() => listener(event), ${delay}), ...rest)
        }`
            : ''
        }
      }
    }
  })()`
}

/**
 * Counts what React does: how many commits it makes and how many function components it renders
 * in them, through the hook React DevTools would use. Install it with `open({ init: watchRenders() })`
 * and read `window.__renders`. It walks only the parts of the tree that changed, as DevTools does, so
 * a component that bailed out is not counted.
 */
export function watchRenders() {
  return `(() => {
    const state = (window.__renders = { commits: 0, renders: 0, perCommit: [] })
    const FUNCTION_TAGS = [0, 11, 15]
    const PERFORMED_WORK = 1
    const visit = (next, prev) => {
      if (FUNCTION_TAGS.includes(next.tag) && (prev === null || (next.flags & PERFORMED_WORK) !== 0))
        state.renders++
      if (prev !== null && next.child === prev.child) return
      for (let child = next.child; child; child = child.sibling) visit(child, child.alternate)
    }
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) {
        this.renderers.set(this.renderers.size + 1, renderer)
        return this.renderers.size
      },
      onCommitFiberRoot(_id, root) {
        state.commits++
        const before = state.renders
        visit(root.current, root.current.alternate)
        state.perCommit.push(state.renders - before)
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    }
  })()`
}

/**
 * Waits until nothing on the page is mid-way through a fade, a scale or a colour transition. axe reads
 * the colours the browser is showing at that instant, so a button half-way to full opacity or a
 * dialog still fading in reads as low contrast. Endless animations (the spinner) do not count.
 */
export async function waitForQuiet(page, timeout = 5000) {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.playState !== 'running' ||
            animation.effect?.getComputedTiming().iterations === Infinity,
        ),
    null,
    { timeout },
  )
}
