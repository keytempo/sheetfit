import { describe, expect, it, vi } from 'vitest'
import { REVOKE_DELAY_MS } from './download'
import {
  createPrintSession,
  planPrint,
  type PrintEnvironment,
  type PrintFrame,
  type PrintHost,
} from './print-pdf'

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36'
const EDGE = `${CHROME} Edg/153.0.0.0`
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/153.0.0.0 Mobile/15E148 Safari/604.1'

const env = (pdfViewerEnabled: boolean | undefined, userAgent: string): PrintEnvironment => ({
  pdfViewerEnabled,
  userAgent,
})

describe('planPrint', () => {
  it('prints from a hidden frame only in Chromium with its viewer', () => {
    expect(planPrint(env(true, CHROME))).toBe('frame')
    expect(planPrint(env(true, EDGE))).toBe('frame')
    expect(planPrint(env(true, CHROME.replace('Chrome/', 'HeadlessChrome/')))).toBe('frame')
  })

  it('sends Firefox, Safari and every iOS browser to a tab', () => {
    for (const userAgent of [FIREFOX, SAFARI, IOS_CHROME])
      expect(planPrint(env(true, userAgent))).toBe('tab')
  })

  it('does not pretend a browser without a viewer can print, Chromium on Android included', () => {
    expect(planPrint(env(false, CHROME))).toBe('unsupported')
    expect(planPrint(env(false, FIREFOX))).toBe('unsupported')
  })

  it('tries a tab when the browser cannot say whether it has a viewer', () => {
    expect(planPrint(env(undefined, CHROME))).toBe('tab')
  })
})

function fakeHost(overrides: Partial<PrintHost> = {}) {
  const frame: PrintFrame = { print: vi.fn(), remove: vi.fn() }
  const host: PrintHost = {
    environment: env(true, CHROME),
    createUrl: vi.fn(() => 'blob:one'),
    revokeUrl: vi.fn(),
    loadFrame: vi.fn(() => Promise.resolve(frame)),
    openTab: vi.fn(() => true),
    ...overrides,
  }
  return { host, frame }
}
const pdf = new Blob(['%PDF-'], { type: 'application/pdf' })

describe('createPrintSession', () => {
  it('prints in a frame, again and again, with one URL and one frame', async () => {
    const { host, frame } = fakeHost()
    const session = createPrintSession(pdf, host)
    expect(await session.print()).toBe('dialog')
    expect(await session.print()).toBe('dialog')
    expect(frame.print).toHaveBeenCalledTimes(2)
    expect(host.createUrl).toHaveBeenCalledTimes(1)
    expect(host.loadFrame).toHaveBeenCalledTimes(1)
    expect(host.openTab).not.toHaveBeenCalled()
  })

  it('gives calls made during a print the same answer instead of printing twice', async () => {
    const { host, frame } = fakeHost()
    const session = createPrintSession(pdf, host)
    const [a, b] = await Promise.all([session.print(), session.print()])
    expect([a, b]).toEqual(['dialog', 'dialog'])
    expect(frame.print).toHaveBeenCalledTimes(1)
  })

  it('opens a tab, in the same turn as the click, where a frame cannot be used', () => {
    const { host } = fakeHost({ environment: env(true, SAFARI) })
    const session = createPrintSession(pdf, host)
    const result = session.print()
    // No await has happened: the tab was opened inside the click, so no popup blocker objects.
    expect(host.openTab).toHaveBeenCalledWith('blob:one')
    return expect(result).resolves.toBe('tab')
  })

  it('says so when the browser blocks the tab', async () => {
    const { host } = fakeHost({ environment: env(true, FIREFOX), openTab: vi.fn(() => false) })
    expect(await createPrintSession(pdf, host).print()).toBe('blocked')
  })

  it('opens nothing and creates no URL when the browser has no viewer', async () => {
    const { host } = fakeHost({ environment: env(false, CHROME) })
    expect(await createPrintSession(pdf, host).print()).toBe('unsupported')
    expect(host.createUrl).not.toHaveBeenCalled()
    expect(host.openTab).not.toHaveBeenCalled()
  })

  it('falls back to a tab when the frame does not load as a PDF', async () => {
    const { host } = fakeHost({ loadFrame: vi.fn(() => Promise.reject(new Error('no viewer'))) })
    expect(await createPrintSession(pdf, host).print()).toBe('tab')
    expect(host.openTab).toHaveBeenCalledTimes(1)
  })

  it('falls back to a tab, and drops the frame, when printing in it throws', async () => {
    const { host, frame } = fakeHost()
    vi.mocked(frame.print).mockImplementationOnce(() => {
      throw new Error('denied')
    })
    const session = createPrintSession(pdf, host)
    expect(await session.print()).toBe('tab')
    expect(frame.remove).toHaveBeenCalledTimes(1)
    // The next print starts a fresh frame rather than reusing the broken one.
    expect(await session.print()).toBe('dialog')
    expect(host.loadFrame).toHaveBeenCalledTimes(2)
  })

  it('releases the URL and removes the frame when disposed, and does so once', async () => {
    const { host, frame } = fakeHost()
    const session = createPrintSession(pdf, host)
    await session.print()
    session.dispose()
    session.dispose()
    expect(frame.remove).toHaveBeenCalledTimes(1)
    expect(host.revokeUrl).toHaveBeenCalledTimes(1)
    expect(host.revokeUrl).toHaveBeenCalledWith('blob:one', 0)
  })

  it('keeps the URL alive a little longer after a tab was opened, which may still be reading it', async () => {
    const { host } = fakeHost({ environment: env(true, FIREFOX) })
    const session = createPrintSession(pdf, host)
    await session.print()
    session.dispose()
    expect(host.revokeUrl).toHaveBeenCalledWith('blob:one', REVOKE_DELAY_MS)
  })

  it('creates no URL, and so has none to release, when nothing was printed', () => {
    const { host } = fakeHost()
    createPrintSession(pdf, host).dispose()
    expect(host.createUrl).not.toHaveBeenCalled()
    expect(host.revokeUrl).not.toHaveBeenCalled()
  })

  it('cleans up a frame that finishes loading after the dialog was closed', async () => {
    let finish: (frame: PrintFrame) => void = () => {}
    const { host, frame } = fakeHost({
      loadFrame: vi.fn(() => new Promise<PrintFrame>((resolve) => (finish = resolve))),
    })
    const session = createPrintSession(pdf, host)
    const result = session.print()
    session.dispose()
    finish(frame)
    expect(await result).toBe('unsupported')
    expect(frame.print).not.toHaveBeenCalled()
    expect(frame.remove).toHaveBeenCalledTimes(1)
  })

  it('does nothing once disposed', async () => {
    const { host } = fakeHost()
    const session = createPrintSession(pdf, host)
    session.dispose()
    expect(await session.print()).toBe('unsupported')
    expect(host.loadFrame).not.toHaveBeenCalled()
  })
})
