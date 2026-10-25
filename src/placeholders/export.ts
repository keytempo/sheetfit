import type { ExportFunction } from '@/lib/export-types'

/*
 * PLACEHOLDER: simulates a PDF export for about two seconds and produces no file.
 * Every third attempt fails on purpose so the dialog's error and retry states can be reviewed.
 * The real exporter implements the same `ExportFunction` and replaces this file's export in
 * src/placeholders/index.ts.
 */

const DURATION_MS = 2000
const STEP_MS = 50
const STAGES = ['Preparing images', 'Placing pieces on sheets', 'Writing the PDF']

let completedAttempts = 0

function abortError() {
  return new DOMException('Export cancelled', 'AbortError')
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export const simulateExport: ExportFunction = async (input, onProgress, signal) => {
  for (let elapsed = 0; elapsed < DURATION_MS; elapsed += STEP_MS) {
    await wait(STEP_MS, signal)
    const fraction = (elapsed + STEP_MS) / DURATION_MS
    onProgress({
      fraction,
      label: STAGES[Math.min(STAGES.length - 1, Math.floor(fraction * STAGES.length))],
    })
  }

  completedAttempts += 1
  if (completedAttempts % 3 === 0) {
    throw new Error('Simulated failure: the placeholder exporter fails every third attempt.')
  }

  const used = new Set(input.layout.sheets.flatMap((s) => s.pieces.map((p) => p.piece.imageId)))
  const sizeBytes = input.images
    .filter((image) => used.has(image.id))
    .reduce((sum, image) => sum + image.file.size, 0)
  const date = new Date().toISOString().slice(0, 10)

  return { filename: `sheetfit-${date}.pdf`, sizeBytes }
}
