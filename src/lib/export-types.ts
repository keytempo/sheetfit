import type { LayoutResult } from './layout-types'

/** The contract between the export dialog and whatever writes the PDF. */

export interface ExportImage {
  id: string
  name: string
  file: File
  width: number
  height: number
}

export interface ExportInput {
  layout: LayoutResult
  /** Every image referenced by the layout. */
  images: readonly ExportImage[]
  cutGuides: boolean
}

export interface ExportProgress {
  /** 0–1 */
  fraction: number
  label: string
}

export interface ExportResult {
  filename: string
  sizeBytes: number
}

/** Rejects with an `AbortError` when `signal` is aborted. */
export type ExportFunction = (
  input: ExportInput,
  onProgress: (progress: ExportProgress) => void,
  signal: AbortSignal,
) => Promise<ExportResult>
