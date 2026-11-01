/** How long the object URL lives after the click. Some browsers read the blob a moment later. */
const REVOKE_DELAY_MS = 10_000

/** Saves a blob as a file through a temporary link, then releases the object URL. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
