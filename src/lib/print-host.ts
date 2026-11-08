import type { PrintFrame, PrintHost } from './print-pdf'

/** A PDF held in memory loads in well under a second; this is how long a missing viewer is awaited. */
const LOAD_TIMEOUT_MS = 10_000

function loadFrame(url: string): Promise<PrintFrame> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'

    const fail = (message: string) => {
      clearTimeout(timer)
      frame.remove()
      reject(new Error(message))
    }
    const timer = setTimeout(() => fail('The PDF did not load in time.'), LOAD_TIMEOUT_MS)

    frame.addEventListener('load', () => {
      clearTimeout(timer)
      try {
        const view = frame.contentWindow
        // Only a frame that really holds the PDF may be printed: asking any other frame to print
        // would print the page this app is in.
        if (!view || view.document.contentType !== 'application/pdf')
          return fail('The browser did not show the PDF.')
        resolve({
          print: () => {
            // Printing a frame goes best when the frame has the focus, but the frame is invisible:
            // whoever pressed Print gets the focus back, so a keyboard is never left inside it.
            const previous = document.activeElement
            view.focus()
            try {
              view.print()
            } finally {
              if (previous instanceof HTMLElement) previous.focus()
            }
          },
          remove: () => frame.remove(),
        })
      } catch {
        fail('The browser would not let the page print the PDF.')
      }
    })
    frame.src = url
    document.body.append(frame)
  })
}

export const browserPrintHost: PrintHost = {
  environment: {
    pdfViewerEnabled: navigator.pdfViewerEnabled,
    userAgent: navigator.userAgent,
  },
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url, afterMs) => {
    if (afterMs > 0) setTimeout(() => URL.revokeObjectURL(url), afterMs)
    else URL.revokeObjectURL(url)
  },
  loadFrame,
  openTab: (url) => window.open(url, '_blank') !== null,
}
