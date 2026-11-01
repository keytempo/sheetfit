import { decodeInBrowser } from '../browser-decode'
import { createExportHost } from './host'
import type { ExportRequest } from './protocol'

/** The worker's entry point: one request per worker, which the page stops to cancel. */
const host = createExportHost((response) => self.postMessage(response), decodeInBrowser)
self.addEventListener(
  'message',
  (event: MessageEvent<ExportRequest>) => void host.handle(event.data),
)
