import type { ExportInput, ExportProgress } from '@/lib/export-types'

/** What the page sends to the export worker. */
export interface ExportRequest {
  type: 'export'
  input: ExportInput
}

/** What the export worker sends back. Cancelling needs no message: the page stops the worker. */
export type ExportResponse =
  | ({ type: 'progress' } & ExportProgress)
  | { type: 'done'; blob: Blob }
  | { type: 'failed'; message: string }
