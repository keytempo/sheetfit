import { ascii, type Bytes } from './bytes'

/** The body of a stream object: its parts in order and their total length in bytes. */
export interface StreamBody {
  parts: readonly (Bytes | Blob)[]
  length: number
}

/** Writes a PDF file object by object, remembering where each one starts for the cross-reference table. */
export class PdfWriter {
  private readonly parts: (Bytes | Blob)[] = []
  private size = 0
  /** Byte offset of object n, at index n. Entry 0 is the free head of the list. */
  private readonly offsets: number[] = [0]

  constructor() {
    // The second line holds bytes above 127, which tells tools that the file is binary.
    this.append(new Uint8Array([...ascii('%PDF-1.7\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  }

  /** Reserves the next object number, to be written later. */
  reserve(): number {
    this.offsets.push(-1)
    return this.offsets.length - 1
  }

  /** Writes a plain object: `value` is the text between `obj` and `endobj`. */
  writeObject(id: number, value: string) {
    this.begin(id)
    this.append(ascii(`${value}\nendobj\n`))
  }

  /** Writes a stream object. `entries` are the dictionary entries; `/Length` is added exactly. */
  writeStream(id: number, entries: string, body: StreamBody) {
    this.begin(id)
    this.append(ascii(`<<${entries}/Length ${body.length}>>\nstream\n`))
    for (const part of body.parts) this.append(part)
    this.append(ascii('\nendstream\nendobj\n'))
  }

  /** Adds a new object and returns its number. */
  addObject(value: string): number {
    const id = this.reserve()
    this.writeObject(id, value)
    return id
  }

  addStream(entries: string, body: StreamBody): number {
    const id = this.reserve()
    this.writeStream(id, entries, body)
    return id
  }

  /** Ends the file with the cross-reference table and the trailer, and returns it as a Blob. */
  finish(rootId: number, infoId: number): Blob {
    const xrefOffset = this.size
    const count = this.offsets.length
    const lines = ['xref', `0 ${count}`, '0000000000 65535 f ']
    for (let id = 1; id < count; id++) {
      if (this.offsets[id] < 0) throw new Error(`PDF object ${id} was reserved but never written`)
      lines.push(`${String(this.offsets[id]).padStart(10, '0')} 00000 n `)
    }
    this.append(
      ascii(
        `${lines.join('\n')}\ntrailer\n<</Size ${count}/Root ${rootId} 0 R/Info ${infoId} 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      ),
    )
    return new Blob(this.parts, { type: 'application/pdf' })
  }

  private begin(id: number) {
    if (this.offsets[id] !== -1)
      throw new Error(`PDF object ${id} is not reserved or already written`)
    this.offsets[id] = this.size
    this.append(ascii(`${id} 0 obj\n`))
  }

  private append(part: Bytes | Blob) {
    this.parts.push(part)
    this.size += part instanceof Blob ? part.size : part.length
  }
}
