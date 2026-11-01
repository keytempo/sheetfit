/** A byte array that can be handed to `Blob` and `CompressionStream` without a cast. */
export type Bytes = Uint8Array<ArrayBuffer>

const encoder = new TextEncoder()

/** The bytes of a string that holds only ASCII, which is all a PDF's structure needs. */
export const ascii = (text: string): Bytes => encoder.encode(text)

export function concat(parts: readonly Uint8Array[]): Bytes {
  let length = 0
  for (const part of parts) length += part.length
  const joined = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

export const readU16 = (bytes: Uint8Array, offset: number, littleEndian = false) =>
  littleEndian ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1]

export const readU32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0

/** Lower-case hexadecimal, two digits per byte. */
export function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** SHA-256 of the bytes as hexadecimal. Equal digests mean the same file. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

export function throwIfAborted(signal: AbortSignal | undefined) {
  signal?.throwIfAborted()
}
