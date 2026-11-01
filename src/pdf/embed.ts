import type { ExportImage } from '@/lib/export-types'
import { sha256Hex, type Bytes } from './bytes'
import type { DecodeImage } from './browser-decode'
import { byteLength, deflate, inflate } from './deflate'
import { parseJpeg, type JpegInfo } from './jpeg'
import { swapsAxes, type ExifOrientation } from './matrix'
import { parsePng } from './png'
import { pngSource } from './png-source'
import { encodeRaster, type PixelSource, type RasterEncoding } from './raster'
import type { PdfWriter } from './writer'

/** An image already in the file: its object number and how its stored pixels turn upright. */
export interface EmbeddedImage {
  id: number
  orientation: ExifOrientation
}

interface Profile {
  id: number
  /** Colour components the profile describes: 1, 3 or 4. */
  components: number
}

const DEVICE_SPACES = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' } as const
const PROFILE_SPACES: Record<string, number> = { GRAY: 1, 'RGB ': 3, CMYK: 4 }

/** The colour components an ICC profile describes, or null when it is not usable in a PDF. */
function profileComponents(header: Uint8Array): number | null {
  if (header.length < 128) return null
  const signature = String.fromCharCode(...header.subarray(16, 20))
  const marker = String.fromCharCode(...header.subarray(36, 40))
  // PDF 1.7 reads profile versions up to 4.
  if (marker !== 'acsp' || header[8] > 4) return null
  return PROFILE_SPACES[signature] ?? null
}

const isAbort = (error: unknown, signal: AbortSignal | undefined) =>
  signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')

/**
 * Puts each source image into the PDF once. JPEG files go in byte for byte; everything else is
 * decoded and stored losslessly. Identical files share one image, however often they were added.
 */
export class ImageEmbedder {
  private readonly byDigest = new Map<string, EmbeddedImage>()
  private readonly profiles = new Map<string, Profile>()

  private readonly writer: PdfWriter
  private readonly decode: DecodeImage
  private readonly signal: AbortSignal | undefined

  constructor(writer: PdfWriter, decode: DecodeImage, signal?: AbortSignal) {
    this.writer = writer
    this.decode = decode
    this.signal = signal
  }

  async embed(image: ExportImage, onProgress: (fraction: number) => void): Promise<EmbeddedImage> {
    let bytes: Bytes
    try {
      bytes = new Uint8Array(await image.file.arrayBuffer())
    } catch {
      throw new Error(`Could not read ${image.name}. The file may have been moved or deleted.`)
    }
    const digest = await sha256Hex(bytes)
    const known = this.byDigest.get(digest)
    if (known) return known

    const embedded = await this.embedBytes(image, bytes, onProgress)
    this.byDigest.set(digest, embedded)
    return embedded
  }

  private async embedBytes(
    image: ExportImage,
    bytes: Bytes,
    onProgress: (fraction: number) => void,
  ): Promise<EmbeddedImage> {
    try {
      const jpeg = parseJpeg(bytes)
      if (jpeg && this.matchesPreview(jpeg, image)) {
        onProgress(1)
        return await this.embedJpeg(image.file, jpeg)
      }

      const png = parsePng(bytes)
      if (png && png.width === image.width && png.height === image.height) {
        const source = pngSource(png, this.signal)
        if (source) {
          const profile = png.compressedProfile
            ? await this.profile(
                png.compressedProfile,
                'compressed',
                png.colorType === 0 || png.colorType === 4 ? 1 : 3,
              )
            : null
          const encoding = await encodeRaster(source, {
            reduceGray: profile?.components !== 3,
            signal: this.signal,
            onProgress,
          })
          return { id: this.writeRaster(encoding, source, profile), orientation: 1 }
        }
      }
    } catch (error) {
      // Whatever this file's own bytes cannot give, the browser's decoder still can.
      if (isAbort(error, this.signal)) throw error
    }
    return this.embedDecoded(image, onProgress)
  }

  /** The pixel size the JPEG has once its EXIF orientation is applied, as the preview shows it. */
  private matchesPreview(jpeg: JpegInfo, image: ExportImage) {
    const turned = swapsAxes(jpeg.orientation)
    return (
      (turned ? jpeg.height : jpeg.width) === image.width &&
      (turned ? jpeg.width : jpeg.height) === image.height
    )
  }

  private async embedJpeg(file: File, jpeg: JpegInfo): Promise<EmbeddedImage> {
    const profile = jpeg.icc ? await this.profile(jpeg.icc, 'raw', jpeg.components) : null
    const space = profile ? `[/ICCBased ${profile.id} 0 R]` : DEVICE_SPACES[jpeg.components]
    // Adobe writes CMYK upside down in value, which /Decode turns back.
    const decode =
      jpeg.components === 4 && jpeg.adobeTransform !== null ? '/Decode[1 0 1 0 1 0 1 0]' : ''
    const id = this.writer.addStream(
      `/Type/XObject/Subtype/Image/Width ${jpeg.width}/Height ${jpeg.height}/ColorSpace${space}/BitsPerComponent 8${decode}/Filter/DCTDecode`,
      { parts: [file], length: file.size },
    )
    return { id, orientation: jpeg.orientation }
  }

  private async embedDecoded(
    image: ExportImage,
    onProgress: (fraction: number) => void,
  ): Promise<EmbeddedImage> {
    let decoded
    try {
      decoded = await this.decode(image.file)
    } catch (error) {
      if (isAbort(error, this.signal)) throw error
      const reason = error instanceof Error ? error.message : 'it could not be decoded'
      throw new Error(`Could not read ${image.name}: ${reason}.`, { cause: error })
    }
    try {
      const { source } = decoded
      if (source.width !== image.width || source.height !== image.height) {
        throw new Error(`Could not read ${image.name}: its size changed since it was added.`)
      }
      const encoding = await encodeRaster(source, { signal: this.signal, onProgress })
      return { id: this.writeRaster(encoding, source, null), orientation: 1 }
    } finally {
      decoded.close()
    }
  }

  /**
   * Writes a colour profile once. `compressed` data is already a zlib stream, as in a PNG. Returns
   * null for a profile that cannot be used or does not describe `expected` components.
   */
  private async profile(
    data: Bytes,
    form: 'raw' | 'compressed',
    expected: number,
  ): Promise<Profile | null> {
    const digest = await sha256Hex(data)
    const known = this.profiles.get(digest)
    if (known) return known.components === expected ? known : null

    const header = form === 'raw' ? data : await inflate(data, 128)
    const components = profileComponents(header)
    if (components !== expected) return null

    const parts = form === 'raw' ? await deflate([data], this.signal) : [data]
    const id = this.writer.addStream(
      `/N ${components}/Alternate${DEVICE_SPACES[components as 1 | 3 | 4]}/Filter/FlateDecode`,
      { parts, length: byteLength(parts) },
    )
    const profile = { id, components }
    this.profiles.set(digest, profile)
    return profile
  }

  private writeRaster(
    encoding: RasterEncoding,
    source: PixelSource,
    profile: Profile | null,
  ): number {
    const { colour, alpha, width, height } = encoding
    const profileSpace = { gray: 1, rgb: 3, indexed: 3 }[colour.space]
    const base =
      profile && profile.components === profileSpace
        ? `[/ICCBased ${profile.id} 0 R]`
        : colour.space === 'gray'
          ? '/DeviceGray'
          : '/DeviceRGB'
    const space =
      colour.space === 'indexed'
        ? `[/Indexed ${base} ${source.palette!.length / 3 - 1}<${[...source.palette!].map((v) => v.toString(16).padStart(2, '0')).join('')}>]`
        : base

    let mask = ''
    if (alpha) {
      const maskId = this.writer.addStream(
        `/Type/XObject/Subtype/Image/Width ${width}/Height ${height}/ColorSpace/DeviceGray/BitsPerComponent ${alpha.bits}${alpha.plane.entries}`,
        { parts: alpha.plane.parts, length: alpha.plane.length },
      )
      mask = `/SMask ${maskId} 0 R`
    }
    return this.writer.addStream(
      `/Type/XObject/Subtype/Image/Width ${width}/Height ${height}/ColorSpace${space}/BitsPerComponent ${colour.bits}${mask}${colour.plane.entries}`,
      { parts: colour.plane.parts, length: colour.plane.length },
    )
  }
}
