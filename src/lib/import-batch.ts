import type { NewImage } from '@/store/types'

interface DecodedFile {
  width: number
  height: number
  thumbnail: Blob
}

export interface BatchHooks {
  decode: (file: File) => Promise<DecodedFile>
  makeId: () => string
  /** Called once for every file, whether it could be decoded or not. */
  onProcessed: () => void
  /** Called for a file that cannot be used, with a message a person can read. */
  onSkipped: (file: File, message: string) => void
}

/**
 * Decodes the files of one batch one after another, in the order they were given, and returns the
 * images that could be used in that same order. A file that cannot be decoded is reported through
 * `onSkipped` and left out; it never stops the rest. Nothing is added to the app here: the caller
 * adds the whole result in one step, so the app reacts to the batch once, not once per file.
 */
export async function decodeBatch(
  files: readonly File[],
  { decode, makeId, onProcessed, onSkipped }: BatchHooks,
): Promise<NewImage[]> {
  const items: NewImage[] = []
  for (const file of files) {
    try {
      const { width, height, thumbnail } = await decode(file)
      items.push({
        id: makeId(),
        name: file.name,
        file,
        thumbnail,
        width,
        height,
        copies: 1,
        percent: 100,
      })
    } catch (error) {
      onSkipped(file, error instanceof Error ? error.message : 'The file could not be decoded')
    } finally {
      onProcessed()
    }
  }
  return items
}

/**
 * Runs tasks one at a time, in the order they were queued, whatever happens to the one before. It
 * is what keeps a second batch, dropped while the first is still loading, behind the first: images
 * never swap places, and each batch is added in one step of its own.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task)
    tail = result.catch(() => undefined)
    return result
  }
}
