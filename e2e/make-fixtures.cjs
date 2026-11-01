/*
 * Regenerates e2e/fixtures. The fixtures are committed, so this is needed only to change them.
 * It uses sharp and ImageMagick, which are NOT dependencies of the project:
 *   NODE_PATH=<dir with sharp> node e2e/make-fixtures.cjs
 */
const sharp = require('sharp')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const out = path.join(__dirname, 'fixtures')
fs.mkdirSync(out, { recursive: true })

/** 96 x 64 raw pixels: four flat quadrants (red, green, blue, yellow) and a black bar on the top left. */
function quadrants(channels = 3) {
  const [w, h] = [96, 64]
  const data = Buffer.alloc(w * h * channels)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const left = x < w / 2
      const top = y < h / 2
      let rgb = left ? (top ? [220, 30, 30] : [30, 60, 220]) : top ? [30, 190, 60] : [240, 220, 30]
      if (y < 6 && x < 30) rgb = [0, 0, 0]
      data.set(rgb, (y * w + x) * channels)
      if (channels === 4) data[(y * w + x) * channels + 3] = 255
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels } })
}

/** A smooth photographic gradient with a little noise, so compression behaves like it does on photos. */
function photo(w, h, seed) {
  const data = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const n = ((x * 7919 + y * 104729 + seed * 13) % 17) - 8
      data[i] = Math.max(0, Math.min(255, 128 + 100 * Math.sin(x / (14 + seed)) + n))
      data[i + 1] = Math.max(0, Math.min(255, 128 + 100 * Math.sin(y / (18 + seed) + 1) + n))
      data[i + 2] = Math.max(0, Math.min(255, 128 + 90 * Math.cos((x + y) / (24 + seed)) + n))
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } })
}

;(async () => {
  for (let o = 1; o <= 8; o++) {
    await quadrants()
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: o })
      .toFile(path.join(out, `orient-${o}.jpg`))
  }
  await photo(160, 110, 1).jpeg({ quality: 88 }).toFile(path.join(out, 'photo.jpg'))
  await photo(120, 120, 2)
    .jpeg({ quality: 88, progressive: true })
    .toFile(path.join(out, 'progressive.jpg'))
  await photo(120, 90, 3).greyscale().jpeg().toFile(path.join(out, 'gray.jpg'))
  await photo(120, 90, 4).toColourspace('cmyk').jpeg().toFile(path.join(out, 'cmyk.jpg'))
  await photo(120, 90, 5)
    .withIccProfile('p3')
    .jpeg({ quality: 90 })
    .toFile(path.join(out, 'icc-p3.jpg'))

  await quadrants().png().toFile(path.join(out, 'opaque.png'))
  await photo(100, 70, 6).png().toFile(path.join(out, 'photo.png'))
  await photo(90, 90, 7)
    .greyscale()
    .toColourspace('srgb')
    .png()
    .toFile(path.join(out, 'gray-rgb.png'))
  await photo(90, 90, 7).greyscale().toColourspace('b-w').png().toFile(path.join(out, 'gray.png'))
  await photo(80, 60, 8).png({ palette: true, colours: 64 }).toFile(path.join(out, 'palette.png'))
  await photo(80, 60, 9).png({ progressive: true }).toFile(path.join(out, 'interlaced.png'))
  await quadrants(4).png().toFile(path.join(out, 'opaque-rgba.png'))

  const alpha = Buffer.alloc(100 * 100 * 4)
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++)
      alpha.set([x * 2, y * 2, 180, Math.round((255 * x) / 99)], (y * 100 + x) * 4)
  }
  await sharp(alpha, { raw: { width: 100, height: 100, channels: 4 } })
    .png()
    .toFile(path.join(out, 'alpha.png'))
  await sharp(alpha, { raw: { width: 100, height: 100, channels: 4 } })
    .webp({ lossless: true })
    .toFile(path.join(out, 'alpha.webp'))

  // Quadrants of known sRGB colours, converted to Display P3 and tagged with that profile: the raw
  // samples are P3 numbers, and only the profile says what colour they are.
  const swatch = Buffer.alloc(64 * 64 * 3)
  const swatches = [
    [255, 0, 0],
    [0, 255, 0],
    [200, 100, 50],
    [10, 20, 30],
  ]
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      swatch.set(swatches[(y < 32 ? 0 : 2) + (x < 32 ? 0 : 1)], (y * 64 + x) * 3)
  await sharp(swatch, { raw: { width: 64, height: 64, channels: 3 } })
    .withIccProfile('p3')
    .webp({ lossless: true })
    .toFile(path.join(out, 'p3.webp'))

  await photo(140, 100, 10).webp({ quality: 85 }).toFile(path.join(out, 'photo.webp'))
  await photo(100, 70, 11).webp({ lossless: true }).toFile(path.join(out, 'lossless.webp'))
  await photo(100, 100, 12).gif().toFile(path.join(out, 'photo.gif'))
  await photo(120, 80, 13).avif({ quality: 60 }).toFile(path.join(out, 'photo.avif'))
  await photo(100, 70, 14).png().toFile(path.join(out, '_bmp-source.png'))
  execFileSync('convert', [path.join(out, '_bmp-source.png'), path.join(out, 'photo.bmp')])
  fs.rmSync(path.join(out, '_bmp-source.png'))

  fs.writeFileSync(path.join(out, 'not-an-image.png'), 'this is not an image')
  fs.writeFileSync(
    path.join(out, 'corrupt.jpg'),
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)]),
  )
  console.log(
    fs
      .readdirSync(out)
      .map((f) => `${f} ${fs.statSync(path.join(out, f)).size}`)
      .join('\n'),
  )
})()
