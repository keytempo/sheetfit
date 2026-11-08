import { REVOKE_DELAY_MS } from './download'

/**
 * How a PDF held in memory can be printed from a web page, in order of how well it works:
 *  - `frame`: load it in a hidden frame and print that frame. Only Chromium's built-in viewer
 *    shows a PDF in a frame the page may script, so only there is this reliable.
 *  - `tab`: open it in a new tab, where the browser's own viewer has its own Print button.
 *  - `unsupported`: the browser has no built-in PDF viewer (Chrome on Android, for one), so
 *    opening it would only download it. The person is told to download and print from an app.
 */
type PrintPlan = 'frame' | 'tab' | 'unsupported'

export interface PrintEnvironment {
  /** `navigator.pdfViewerEnabled`; undefined in browsers old enough not to have it. */
  pdfViewerEnabled: boolean | undefined
  userAgent: string
}

export function planPrint({ pdfViewerEnabled, userAgent }: PrintEnvironment): PrintPlan {
  if (pdfViewerEnabled === false) return 'unsupported'
  // Chromium's token (headless builds say HeadlessChrome). Safari, Firefox and every browser on
  // iOS lack it; their viewers cannot be scripted from the page (Firefox) or print the wrong
  // document (Safari), so they get a tab.
  return pdfViewerEnabled === true && /Chrome\/\d/.test(userAgent) ? 'frame' : 'tab'
}

/** A loaded frame holding the PDF. */
export interface PrintFrame {
  print: () => void
  remove: () => void
}

/** The browser's side of printing, so the logic around it can be tested without one. */
export interface PrintHost {
  environment: PrintEnvironment
  createUrl: (blob: Blob) => string
  revokeUrl: (url: string, afterMs: number) => void
  /** Rejects when the PDF does not load as a PDF in a frame the page can reach. */
  loadFrame: (url: string) => Promise<PrintFrame>
  /** False when the browser blocked the new tab. */
  openTab: (url: string) => boolean
}

/**
 * What happened. `dialog` means the browser's print dialog was asked for; whether anything was
 * printed after that is the person's business and not visible to a page.
 */
export type PrintOutcome = 'dialog' | 'tab' | 'blocked' | 'unsupported'

export interface PrintSession {
  /** Prints the PDF again, as often as asked. Calls made while one is under way share its result. */
  print: () => Promise<PrintOutcome>
  /** Removes the hidden frame and releases the object URL. Safe to call twice. */
  dispose: () => void
}

/**
 * Prints one PDF, as many times as asked, with one object URL and at most one hidden frame for
 * all of it. Starting a print must happen in the click that asked for it, so everything that needs
 * the click (opening a tab) is done before the first `await`.
 */
export function createPrintSession(blob: Blob, host: PrintHost): PrintSession {
  const plan = planPrint(host.environment)
  let url: string | null = null
  let frame: PrintFrame | null = null
  let openedTab = false
  let disposed = false
  let pending: Promise<PrintOutcome> | null = null

  const getUrl = () => (url ??= host.createUrl(blob))

  const inTab = (): PrintOutcome => {
    const opened = host.openTab(getUrl())
    openedTab ||= opened
    return opened ? 'tab' : 'blocked'
  }

  async function printInFrame(): Promise<PrintOutcome> {
    try {
      frame ??= await host.loadFrame(getUrl())
      if (disposed) {
        frame.remove()
        frame = null
        return 'unsupported'
      }
      frame.print()
      return 'dialog'
    } catch {
      frame?.remove()
      frame = null
      return disposed ? 'unsupported' : inTab()
    }
  }

  const run = (): Promise<PrintOutcome> => {
    if (disposed || plan === 'unsupported') return Promise.resolve('unsupported')
    return plan === 'tab' ? Promise.resolve(inTab()) : printInFrame()
  }

  return {
    print() {
      pending ??= run().finally(() => {
        pending = null
      })
      return pending
    },
    dispose() {
      if (disposed) return
      disposed = true
      frame?.remove()
      frame = null
      // A new tab may still be reading the file; a frame has finished with it.
      if (url !== null) host.revokeUrl(url, openedTab ? REVOKE_DELAY_MS : 0)
    },
  }
}
