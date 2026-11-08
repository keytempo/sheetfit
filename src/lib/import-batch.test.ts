import { describe, expect, it, vi } from 'vitest'
import { createSerialQueue, decodeBatch, type BatchHooks } from './import-batch'

const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' })
const decoded = { width: 800, height: 600, thumbnail: new Blob(['t']) }

function hooks(overrides: Partial<BatchHooks> = {}): BatchHooks {
  let id = 0
  return {
    decode: vi.fn(() => Promise.resolve(decoded)),
    makeId: () => `image-${++id}`,
    onProcessed: vi.fn(),
    onSkipped: vi.fn(),
    ...overrides,
  }
}

describe('decodeBatch', () => {
  it('returns every usable image in the order the files were given, with fresh ids', async () => {
    const items = await decodeBatch([file('b.jpg'), file('a.jpg'), file('c.jpg')], hooks())
    expect(items.map((item) => item.name)).toEqual(['b.jpg', 'a.jpg', 'c.jpg'])
    expect(items.map((item) => item.id)).toEqual(['image-1', 'image-2', 'image-3'])
    expect(items[0]).toMatchObject({ width: 800, height: 600, copies: 1, percent: 100 })
  })

  it('keeps duplicate file names as separate images', async () => {
    const items = await decodeBatch([file('same.jpg'), file('same.jpg')], hooks())
    expect(items).toHaveLength(2)
    expect(new Set(items.map((item) => item.id)).size).toBe(2)
  })

  it('decodes one file at a time, so the page is never asked for many bitmaps at once', async () => {
    let running = 0
    let most = 0
    const decode = vi.fn(async () => {
      running += 1
      most = Math.max(most, running)
      await Promise.resolve()
      running -= 1
      return decoded
    })
    await decodeBatch([file('1'), file('2'), file('3')], hooks({ decode }))
    expect(most).toBe(1)
  })

  it('skips a file that cannot be decoded, says which and why, and carries on', async () => {
    const decode = vi.fn((f: File) =>
      f.name === 'bad.jpg'
        ? Promise.reject(new Error('This browser cannot decode the file'))
        : Promise.resolve(decoded),
    )
    const h = hooks({ decode })
    const items = await decodeBatch([file('a.jpg'), file('bad.jpg'), file('c.jpg')], h)
    expect(items.map((item) => item.name)).toEqual(['a.jpg', 'c.jpg'])
    expect(h.onSkipped).toHaveBeenCalledTimes(1)
    expect(h.onSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'bad.jpg' }),
      'This browser cannot decode the file',
    )
  })

  it('gives a plain message when the failure carries none', async () => {
    const h = hooks({ decode: vi.fn().mockRejectedValue('nope') })
    await decodeBatch([file('a.jpg')], h)
    expect(h.onSkipped).toHaveBeenCalledWith(expect.anything(), 'The file could not be decoded')
  })

  it('reports progress for every file, usable or not', async () => {
    const h = hooks({
      decode: vi.fn((f: File) =>
        f.name === 'bad' ? Promise.reject(new Error('x')) : Promise.resolve(decoded),
      ),
    })
    await decodeBatch([file('a'), file('bad'), file('c')], h)
    expect(h.onProcessed).toHaveBeenCalledTimes(3)
  })

  it('returns nothing for a batch of nothing but bad files', async () => {
    const items = await decodeBatch(
      [file('a'), file('b')],
      hooks({ decode: () => Promise.reject(new Error('x')) }),
    )
    expect(items).toEqual([])
  })
})

describe('createSerialQueue', () => {
  it('runs tasks one after another in the order they were queued', async () => {
    const queue = createSerialQueue()
    const log: string[] = []
    const slow = queue(async () => {
      log.push('first starts')
      await new Promise((resolve) => setTimeout(resolve, 20))
      log.push('first ends')
      return 1
    })
    const fast = queue(() => {
      log.push('second starts')
      return Promise.resolve(2)
    })
    expect(await Promise.all([slow, fast])).toEqual([1, 2])
    expect(log).toEqual(['first starts', 'first ends', 'second starts'])
  })

  it('keeps going after a task fails, and passes the failure to whoever queued it', async () => {
    const queue = createSerialQueue()
    const failing = queue(() => Promise.reject(new Error('boom')))
    const next = queue(() => Promise.resolve('fine'))
    await expect(failing).rejects.toThrow('boom')
    await expect(next).resolves.toBe('fine')
  })
})
