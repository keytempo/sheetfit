import { throwIfAborted, type Bytes } from './bytes'

/**
 * Compresses a stream of byte chunks into a zlib stream, which is what a PDF's FlateDecode filter
 * reads. The browser's CompressionStream has one fixed compression level, so the size is whatever
 * it gives; the chunks are compressed as they arrive and never joined into one buffer.
 */
export async function deflate(
  source: AsyncIterable<Uint8Array<ArrayBuffer>> | Iterable<Uint8Array<ArrayBuffer>>,
  signal?: AbortSignal,
): Promise<Bytes[]> {
  const stream = new CompressionStream('deflate')
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  const output: Bytes[] = []

  // The output must be drained while the input is written, or the writer waits forever.
  const draining = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      output.push(new Uint8Array(value))
    }
  })()

  try {
    for await (const chunk of source) {
      throwIfAborted(signal)
      await writer.write(chunk)
    }
    await writer.close()
  } catch (error) {
    await writer.abort(error).catch(() => undefined)
    await draining.catch(() => undefined)
    throw error
  }
  await draining
  return output
}

/** Inflates a zlib stream, for reading things such as an embedded colour profile. */
export async function inflate(compressed: Bytes, limit = Infinity): Promise<Bytes> {
  const stream = new DecompressionStream('deflate')
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  const chunks: Bytes[] = []
  let total = 0
  const writing = writer
    .write(compressed)
    .then(() => writer.close())
    .catch(() => undefined)
  while (total < limit) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(new Uint8Array(value))
    total += value.length
  }
  await reader.cancel().catch(() => undefined)
  await writing
  const joined = new Uint8Array(Math.min(total, limit))
  let offset = 0
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, joined.length - offset)
    joined.set(chunk.subarray(0, take), offset)
    offset += take
  }
  return joined
}

export const byteLength = (parts: readonly Uint8Array[]) =>
  parts.reduce((sum, part) => sum + part.length, 0)
