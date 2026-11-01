import { inflate } from '../deflate'
import type { Matrix } from '../matrix'

/** A small PDF reader for tests. It trusts nothing: every offset and length is checked. */

export type Value =
  | number
  | string
  | boolean
  | null
  | { ref: number }
  | { name: string }
  | { hex: string }
  | Value[]
  | { [key: string]: Value }

export type Dict = { [key: string]: Value }

export interface PdfObject {
  id: number
  value: Value
  /** The raw stream bytes, exactly /Length of them, or null for a plain object. */
  stream: Uint8Array | null
}

export interface Placement {
  /** The resource name used with Do. */
  name: string
  /** The CTM in force at the Do operator. */
  matrix: Matrix
}

export interface ReadPage {
  mediaBox: number[]
  content: string
  placements: Placement[]
  /** Resource name to object number. */
  images: Map<string, number>
  /** Rectangles drawn with re, as [x, y, w, h]. */
  rectangles: number[][]
  operators: Set<string>
}

export interface ReadPdf {
  version: string
  objects: Map<number, PdfObject>
  trailer: Dict
  pages: ReadPage[]
  fileLength: number
}

const isRef = (value: Value): value is { ref: number } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && 'ref' in value
const isName = (value: Value): value is { name: string } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && 'name' in value

export const nameOf = (value: Value | undefined) =>
  value && isName(value) ? value.name : undefined

class Tokenizer {
  position = 0
  private readonly text: string

  constructor(text: string) {
    this.text = text
  }

  private skipSpace() {
    while (this.position < this.text.length && /[\s\0]/.test(this.text[this.position]))
      this.position++
  }

  parse(): Value {
    this.skipSpace()
    const text = this.text
    const char = text[this.position]
    if (text.startsWith('<<', this.position)) {
      this.position += 2
      const dict: Dict = {}
      for (;;) {
        this.skipSpace()
        if (text.startsWith('>>', this.position)) {
          this.position += 2
          return dict
        }
        const key = this.parse()
        if (!isName(key)) throw new Error(`dictionary key is not a name at ${this.position}`)
        dict[key.name] = this.parse()
      }
    }
    if (char === '[') {
      this.position++
      const list: Value[] = []
      for (;;) {
        this.skipSpace()
        if (text[this.position] === ']') {
          this.position++
          return list
        }
        list.push(this.parse())
      }
    }
    if (char === '/') {
      const match = /^\/[^\s/<>[\]()%]*/.exec(text.slice(this.position))!
      this.position += match[0].length
      return { name: match[0].slice(1) }
    }
    if (char === '<') {
      const end = text.indexOf('>', this.position)
      const hex = text.slice(this.position + 1, end)
      this.position = end + 1
      return { hex }
    }
    if (char === '(') {
      const end = text.indexOf(')', this.position)
      const value = text.slice(this.position + 1, end)
      this.position = end + 1
      return value
    }
    const ref = /^(\d+) (\d+) R(?![\w])/.exec(text.slice(this.position, this.position + 30))
    if (ref) {
      this.position += ref[0].length
      return { ref: Number(ref[1]) }
    }
    const word = /^[^\s/<>[\]()%]+/.exec(text.slice(this.position))
    if (!word) throw new Error(`unexpected character ${JSON.stringify(char)} at ${this.position}`)
    this.position += word[0].length
    if (word[0] === 'true') return true
    if (word[0] === 'false') return false
    if (word[0] === 'null') return null
    const number = Number(word[0])
    if (Number.isNaN(number)) throw new Error(`unknown token ${word[0]}`)
    return number
  }
}

/** One character per byte, which is all the structure checks need. */
const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

/** Reads a PDF and checks its structure as it goes. Throws on the first violation. */
export async function readPdf(bytes: Uint8Array<ArrayBuffer>): Promise<ReadPdf> {
  const text = latin1(bytes)
  const version = /^%PDF-(1\.\d)\n/.exec(text)?.[1]
  if (!version) throw new Error('missing %PDF-1.x header')
  if (!text.endsWith('%%EOF\n')) throw new Error('missing %%EOF')

  const startxref = /startxref\n(\d+)\n%%EOF\n$/.exec(text)
  if (!startxref) throw new Error('missing startxref')
  const xrefAt = Number(startxref[1])
  if (!text.startsWith('xref\n', xrefAt))
    throw new Error('startxref does not point at the xref table')

  const header = /^xref\n(\d+) (\d+)\n/.exec(text.slice(xrefAt, xrefAt + 40))!
  const first = Number(header[1])
  const count = Number(header[2])
  if (first !== 0) throw new Error('xref subsection must start at 0')
  const entriesAt = xrefAt + header[0].length
  const offsets: (number | null)[] = []
  for (let i = 0; i < count; i++) {
    const entry = text.slice(entriesAt + i * 20, entriesAt + i * 20 + 20)
    const match = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(entry)
    if (!match) throw new Error(`xref entry ${i} is not exactly 20 bytes: ${JSON.stringify(entry)}`)
    offsets.push(match[3] === 'n' ? Number(match[1]) : null)
  }
  const trailerAt = entriesAt + count * 20
  if (!text.startsWith('trailer\n', trailerAt))
    throw new Error('trailer does not follow the xref table')
  const trailer = new Tokenizer(text.slice(trailerAt + 8)).parse() as Dict
  if (trailer.Size !== count) throw new Error('trailer /Size does not match the xref table')

  const objects = new Map<number, PdfObject>()
  for (let id = 1; id < count; id++) {
    const offset = offsets[id]
    if (offset === null) throw new Error(`object ${id} is free`)
    const prefix = `${id} 0 obj\n`
    if (!text.startsWith(prefix, offset)) throw new Error(`object ${id} is not at offset ${offset}`)
    const tokenizer = new Tokenizer(
      text.slice(offset + prefix.length, offset + prefix.length + 4000),
    )
    const value = tokenizer.parse()
    const after = offset + prefix.length + tokenizer.position
    let stream: Uint8Array | null = null
    if (text.startsWith('\nstream\n', after)) {
      const dict = value as Dict
      const length = dict.Length
      if (typeof length !== 'number')
        throw new Error(`object ${id}: /Length must be a direct integer`)
      const start = after + 8
      stream = bytes.subarray(start, start + length)
      if (!text.startsWith('\nendstream\nendobj\n', start + length)) {
        throw new Error(`object ${id}: /Length ${length} does not end the stream`)
      }
    } else if (!text.startsWith('\nendobj\n', after)) {
      throw new Error(`object ${id} does not end with endobj`)
    }
    objects.set(id, { id, value, stream })
  }

  const pdf: ReadPdf = { version, objects, trailer, pages: [], fileLength: bytes.length }
  pdf.pages = await pageList(pdf)
  return pdf
}

export function resolve(pdf: ReadPdf, value: Value | undefined): Value {
  let current = value
  while (current !== undefined && isRef(current)) {
    const object = pdf.objects.get(current.ref)
    if (!object) throw new Error(`dangling reference to ${current.ref}`)
    current = object.value
  }
  return current ?? null
}

/** Undoes PNG predictors (/Predictor 10 to 15) the way a viewer does. */
export function unpredict(
  data: Uint8Array,
  colors: number,
  bits: number,
  columns: number,
): Uint8Array {
  const rowBytes = Math.ceil((columns * colors * bits) / 8)
  const step = Math.max(1, (colors * bits) >> 3)
  const rows = data.length / (rowBytes + 1)
  if (!Number.isInteger(rows)) throw new Error('predictor data is not a whole number of rows')
  const out = new Uint8Array(rows * rowBytes)
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowBytes + 1)]
    for (let i = 0; i < rowBytes; i++) {
      const x = data[r * (rowBytes + 1) + 1 + i]
      const a = i >= step ? out[r * rowBytes + i - step] : 0
      const b = r > 0 ? out[(r - 1) * rowBytes + i] : 0
      const c = r > 0 && i >= step ? out[(r - 1) * rowBytes + i - step] : 0
      let predicted = 0
      if (type === 1) predicted = a
      else if (type === 2) predicted = b
      else if (type === 3) predicted = (a + b) >> 1
      else if (type === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (type !== 0) throw new Error(`unknown predictor row type ${type}`)
      out[r * rowBytes + i] = (x + predicted) & 255
    }
  }
  return out
}

/** The stream of an object with its Flate filter and predictor undone. DCT data is returned as it is. */
export async function decodedStream(pdf: ReadPdf, id: number): Promise<Uint8Array> {
  const object = pdf.objects.get(id)
  if (!object?.stream) throw new Error(`object ${id} has no stream`)
  const dict = object.value as Dict
  const filter = nameOf(dict.Filter)
  if (filter === undefined || filter === 'DCTDecode') return object.stream
  if (filter !== 'FlateDecode') throw new Error(`unexpected filter ${filter}`)
  const inflated = await inflate(new Uint8Array(object.stream))
  const parms = dict.DecodeParms as Dict | undefined
  if (!parms) return inflated
  if (typeof parms.Predictor !== 'number' || parms.Predictor < 10)
    throw new Error('unexpected predictor')
  return unpredict(
    inflated,
    parms.Colors as number,
    parms.BitsPerComponent as number,
    parms.Columns as number,
  )
}

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
]

/** Interprets a content stream just far enough to find the images drawn and the rectangles stroked. */
function interpret(content: string) {
  const placements: Placement[] = []
  const rectangles: number[][] = []
  const operators = new Set<string>()
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const stack: Matrix[] = []
  let operands: (number | string)[] = []
  for (const token of content.split(/\s+/).filter(Boolean)) {
    if (/^-?\d*\.?\d+$/.test(token) || token.startsWith('/')) {
      operands.push(token.startsWith('/') ? token : Number(token))
      continue
    }
    operators.add(token)
    if (token === 'q') stack.push(ctm)
    else if (token === 'Q') ctm = stack.pop()!
    else if (token === 'cm')
      ctm = multiply(operands.slice(-6) as number[] as unknown as Matrix, ctm)
    else if (token === 'Do')
      placements.push({ name: String(operands.at(-1)).slice(1), matrix: ctm })
    else if (token === 're') rectangles.push(operands.slice(-4) as number[])
    operands = []
  }
  return { placements, rectangles, operators }
}

async function pageList(pdf: ReadPdf): Promise<ReadPage[]> {
  const root = resolve(pdf, pdf.trailer.Root) as Dict
  const tree = resolve(pdf, root.Pages) as Dict
  const kids = tree.Kids as Value[]
  if (tree.Count !== kids.length) throw new Error('/Count does not match /Kids')
  return Promise.all(
    kids.map(async (kid) => {
      const page = resolve(pdf, kid) as Dict
      if (nameOf(page.Type) !== 'Page') throw new Error('kid is not a page')
      // MediaBox and Resources may be given on the page tree and inherited by every page.
      const resources = resolve(pdf, page.Resources ?? tree.Resources) as Dict
      const xobjects = resolve(pdf, resources.XObject) as Dict
      const images = new Map<string, number>()
      for (const [name, ref] of Object.entries(xobjects))
        images.set(name, (ref as { ref: number }).ref)
      const contentRef = (page.Contents as { ref: number }).ref
      const content = latin1(await decodedStream(pdf, contentRef))
      return {
        mediaBox: (page.MediaBox ?? tree.MediaBox) as number[],
        content,
        images,
        ...interpret(content),
      }
    }),
  )
}
