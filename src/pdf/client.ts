import type { ExportFunction } from '@/lib/export-types'
import type { ExportRequest, ExportResponse } from './worker/protocol'

/** `sheetfit-2026-10-29.pdf`, with the date on the person's own clock. */
function filenameFor(date: Date) {
  const two = (value: number) => String(value).padStart(2, '0')
  return `sheetfit-${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}.pdf`
}

/**
 * Writes the PDF in a Web Worker so the page stays responsive. Cancelling stops the worker, which
 * ends the work at once, wherever it is, and nothing is produced. Each export gets its own worker,
 * which is stopped again when it is done, so a large photo's memory is returned right away.
 */
export const exportPdf: ExportFunction = (input, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The export was cancelled', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./worker/export.worker.ts', import.meta.url), {
      type: 'module',
    })
    const stop = () => {
      signal.removeEventListener('abort', cancel)
      worker.terminate()
    }
    const cancel = () => {
      stop()
      reject(new DOMException('The export was cancelled', 'AbortError'))
    }
    const fail = (message: string) => {
      stop()
      reject(new Error(message))
    }

    signal.addEventListener('abort', cancel, { once: true })
    worker.addEventListener('message', (event: MessageEvent<ExportResponse>) => {
      const response = event.data
      if (response.type === 'progress') {
        onProgress({ fraction: response.fraction, label: response.label })
      } else if (response.type === 'done') {
        stop()
        resolve({ filename: filenameFor(new Date()), blob: response.blob })
      } else {
        fail(response.message)
      }
    })
    worker.addEventListener('error', () => fail('The PDF could not be created in this browser.'))
    worker.addEventListener('messageerror', () =>
      fail('The PDF could not be created in this browser.'),
    )
    const request: ExportRequest = { type: 'export', input }
    worker.postMessage(request)
  })
