# Sheetfit PDF export

The exporter turns the layout on screen into a PDF: one page per sheet, every photo stored once and
drawn wherever it is placed, nothing resampled, nothing else on the page. It is hand-written, has no
runtime dependency, and runs in a Web Worker.

## 1. Where it lives

| File                        | Role                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/pdf/client.ts`         | `exportPdf`: the function the export dialog calls. Starts a worker, relays progress, stops it to cancel |
| `src/pdf/worker/`           | `export.worker.ts` (entry), `host.ts` (behaviour, testable in Node), `protocol.ts` (messages)           |
| `src/pdf/build.ts`          | `buildPdf(input, hooks)`: the whole pipeline, with no browser APIs of its own                           |
| `src/pdf/embed.ts`          | `ImageEmbedder`: chooses the route for each file, writes the image objects, deduplicates                |
| `src/pdf/jpeg.ts`           | JPEG headers: size, components, Adobe marker, EXIF orientation, ICC profile                             |
| `src/pdf/png.ts`            | PNG chunks, and a streaming decoder that yields unfiltered scanlines a few rows at a time               |
| `src/pdf/png-source.ts`     | A PNG as a `PixelSource`, including its transparency chunk                                              |
| `src/pdf/browser-decode.ts` | Everything else: the browser's decoder, read out in strips                                              |
| `src/pdf/raster.ts`         | Lossless storage of decoded pixels: reductions, predictors, keeping the smaller                         |
| `src/pdf/pages.ts`          | The drawing instructions of a sheet, and the placement matrix                                           |
| `src/pdf/matrix.ts`         | Affine matrices and the eight EXIF orientations                                                         |
| `src/pdf/writer.ts`         | Objects, streams, the cross-reference table                                                             |
| `src/pdf/deflate.ts`        | Streaming Flate through `CompressionStream`                                                             |
| `src/pdf/testing/`          | A test-only PDF reader and the fixtures (PNG encoder, JPEG header builder, hand-made layouts)           |

`src/lib/download.ts` saves the finished blob.

## 2. What goes into the file

**Pages.** One per sheet, in sheet order. `/MediaBox` is the sheet size in points (mm × 72 ÷ 25.4) for
the orientation the layout actually used, including the one Automatic chose; it, and the image
resources, are stated once on the page tree and inherited by every page. A page is its content stream
and nothing else: no text, headers or page numbers, and none of the preview's overlays (margin
boundary, sheet numbers, hover and selection highlights). The paper is the viewer's white.

**Placement.** For each piece the content stream has `q a b c d e f cm /ImN Do Q`. The layout's
millimetres have a top-left origin and the page's points a bottom-left one; `rotated: true` means
the upright picture turned 90° clockwise inside its footprint, as the preview draws it. The matrix is
the composition of the picture's EXIF orientation (a table of eight, written from the EXIF
specification and cross-checked pixel by pixel against an independent formula) and the placement.
Numbers are written with at most four decimals (a tenth of a micrometre).

**Cut guides.** With the option on, one path per page strokes a rectangle inside each piece's
footprint with a 0.25 pt black line, drawn after the photos, as the preview's one-pixel border sits
inside its piece.

**Structure.** PDF 1.7, `%PDF-1.7` and a binary comment, classic cross-reference table with exact
offsets, exact direct `/Length` values, Flate-compressed content streams, an Info dictionary holding
only `/Producer (Sheetfit)`. No timestamp, no random identifier, no file ID: the same input gives
the same bytes, in the same browser (tested twice in Node and twice in Chrome, byte for byte).

**Size.** A photo is one object however many copies there are; twenty copies of a photo cost five
more bytes each than one. Two files with identical bytes, added as two images, share one object
(SHA-256 of the file), and so do identical colour profiles. An extra page costs about 230 bytes (measured: its page object, its compressed instructions and two table entries) for one piece; more pieces add their
instructions.

## 3. How each image is stored

Every file is first looked at by its bytes, not its name or type. The route is chosen per file, and
if a route fails (damaged data, a size that differs from what the preview shows) the next one is used.

1. **JPEG that a PDF can read as it is** (baseline, extended sequential or progressive Huffman,
   8 bits, 1, 3 or 4 components). The file's own bytes are the image stream (`/DCTDecode`): not
   decoded, not re-encoded. The bytes are referenced as the `File` itself, so a hundred large JPEGs
   cost no memory while the file is built. Gray, RGB and CMYK are set from the component count.
   Adobe's CMYK, which stores values inverted, gets `/Decode [1 0 1 0 1 0 1 0]`. An embedded ICC
   profile (even split over several segments) becomes an `ICCBased` colour space when it describes the
   same number of components. EXIF orientation is applied by the placement matrix. If the size the
   orientation implies differs from the size the preview shows, the browser route is used, so the PDF
   cannot disagree with the preview.
2. **PNG without interlacing or a rotation request.** Decoded by this module, not the browser, so
   every sample is exact: all colour types and bit depths, `tRNS` included. Only the compressed file,
   the line being decoded and one 2 MB chunk of rows are in memory at a time. The colour profile
   (`iCCP`) is embedded, and colour is not converted.
3. **Everything else** (WebP, GIF, BMP, AVIF, interlaced PNG, JPEG variants a PDF cannot read, and
   any file the routes above reject). Decoded by the browser at its full native size, with its EXIF
   orientation applied and read out in strips of about four million pixels (below every canvas limit,
   including phones'); the bitmap is released afterwards.

**Lossless storage of decoded pixels.** Never lossy. A decoded picture is analysed once and then:
fully opaque alpha is dropped; red = green = blue becomes DeviceGray; real alpha becomes a separate
gray `/SMask` of the same depth; a palette stays a palette (`Indexed`); 16-bit stays 16-bit. Each
plane is stored with plain Flate and with Flate plus PNG predictors (a filter chosen per row by the
smallest sum of absolute values) and **the smaller is kept**; for a PNG, the file's own compressed
data is a third candidate and is kept when it is the smallest. A profiled RGB picture is not reduced
to gray, so its profile still applies.

## 4. Worker protocol, progress, cancel

`exportPdf(input, onProgress, signal)` starts one worker per export and posts
`{ type: 'export', input }`. The worker answers `{ type: 'progress', fraction, label }` as it goes,
then `{ type: 'done', blob }` or `{ type: 'failed', message }`. The page stops the worker after the
answer, so a large photo's memory is returned at once.

Progress is real: photos are weighted by their pixels, a photo reports as its rows go by, and writing
the pages takes the last five per cent. Labels are "Embedding photo 3 of 8", "Writing sheet 2 of 5"
and "Finishing the file".

**Cancel** stops the worker (`terminate()`), wherever it is, and nothing is produced; in the dialog
the effect that started the export is cleaned up the moment it closes, so a file that finishes in the
instant after Cancel is not saved. **Errors** name the file and the reason ("Could not read x.png:
this browser cannot decode the file.", "…The file may have been moved or deleted."), and running out
of memory says so and suggests fewer or smaller photos. Try again starts a new worker.

**The snapshot.** What is exported is the layout on screen when Download PDF was pressed, with the
images it uses and the cut-guide choice at that moment. Layouts the packer finds while the file is
written are not applied. Copies that fit on no sheet are not exported; the dialog says how many were
left out.

**Download.** A `Blob` and a temporary link, with the object URL released after ten seconds (some
browsers read the blob a moment after the click). A "Download again" button in the dialog covers a
browser that blocks a download started after a long task.

## 5. Verification

```sh
npm test            # unit tests, the PDF ones through an independent reader
npm run build && npm run e2e:pdf
```

- **Unit tests** (`src/pdf/*.test.ts`, 101 tests): the JPEG parser (every header variant, and a
  mutation fuzz that must never throw); the PNG decoder (all 19 colour type and depth combinations,
  random per-row filters, a multi-chunk image); every placement corner for all eight EXIF
  orientations, turned and not; structure through a reader that checks every offset and length;
  byte-identical JPEG streams; exact PNG samples, `tRNS`, reductions, 80 random RGBA pictures;
  keeping the smaller encoding; every fallback; determinism; cancellation; progress; a hundred photos.
- **Browser and external tools** (`e2e/pdf-export.mjs`, 41 checks): `qpdf --check`, `pdfinfo`,
  `pdfimages` (the 13 JPEG streams are byte-identical to their sources; the lossless ones equal
  ImageMagick's own decode of the sources), and `pdftoppm` rasters compared with screenshots of the
  preview at 216 points over 54 pieces. Also: determinism, twenty copies against a naive writer (95 %
  smaller), 100 photos in 0.9 s, a 50 megapixel photo (37 s, 9.7 MB, valid), Cancel, a failure and
  Try again, a profiled WebP, cut guides, and omitted copies.

Size of twenty copies of a photo (all fitting on one sheet):

| Photo             | 1 copy    | 20 copies | per extra copy | naive, 20 × one copy | saved |
| ----------------- | --------- | --------- | -------------- | -------------------- | ----- |
| JPEG, 2400 × 1600 | 47 318 B  | 47 418 B  | 5 B            | 946 360 B            | 95 %  |
| PNG, 1200 × 800   | 282 215 B | 282 315 B | 5 B            | 5 644 300 B          | 95 %  |

## 6. Limits and known weaknesses

- **Flate level.** `CompressionStream` has one fixed level, so a PNG optimised by a stronger tool
  can be smaller than what is recompressed here; the file's own data is kept when it is smaller.
- **Colour profiles outside PNG and JPEG.** The browser applies a wide-gamut profile of a WebP or AVIF
  when it decodes and does not hand the profile over, so such a file is stored as the sRGB picture the
  preview shows; colours outside sRGB are clipped. (Storing the raw samples without the profile was
  tried first and made reds visibly flat, which is why it was changed.)
- **Partial transparency in formats the browser decodes** (WebP, AVIF) passes through the canvas,
  which holds colour premultiplied, so a pixel's colour at very low alpha can change by a few levels.
  PNG is decoded by this module and has no such effect.
- **Width.** A picture wider than 32 767 pixels cannot be read through a canvas; the export says so.
- **Animated images** (GIF, WebP) are stored as their first frame, as in the preview.
- **16-bit images** need a PDF 1.5 reader, which every current viewer is.
- **A file that changes on disk** after it was added cannot be read; the export says so.
- **No object streams.** Classic cross-reference tables cost about 20 bytes per object; for
  200 sheets that is under 10 kB.
