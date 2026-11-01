import type { DecodeImage } from '../browser-decode'
import { buildPdf } from '../build'
import type { ExportRequest, ExportResponse } from './protocol'

/** Words for a failure that the person can act on. */
export function describeFailure(error: unknown): string {
  if (
    error instanceof RangeError ||
    (error instanceof Error && /memory|allocation/i.test(error.message))
  ) {
    return 'The browser ran out of memory while preparing the PDF. Try fewer or smaller photos.'
  }
  return error instanceof Error && error.message ? error.message : 'The PDF could not be created.'
}

/** Runs export requests: builds the PDF and reports progress, the file or the failure. */
export function createExportHost(post: (response: ExportResponse) => void, decode: DecodeImage) {
  return {
    async handle(request: ExportRequest) {
      try {
        const blob = await buildPdf(request.input, {
          decode,
          onProgress: (progress) => post({ type: 'progress', ...progress }),
        })
        post({ type: 'done', blob })
      } catch (error) {
        post({ type: 'failed', message: describeFailure(error) })
      }
    },
  }
}
