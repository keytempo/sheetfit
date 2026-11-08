import { describe, expect, it } from 'vitest'
import { readWorkHint, writeWorkHint } from './hint'

const memory = () => {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

describe('the work hint', () => {
  it('reads back the count that was written', () => {
    const storage = memory()
    writeWorkHint(54, storage)
    expect(readWorkHint(storage)).toBe(54)
  })

  it('is 0 when nothing was written, and after the count goes to 0', () => {
    const storage = memory()
    expect(readWorkHint(storage)).toBe(0)
    writeWorkHint(3, storage)
    writeWorkHint(0, storage)
    expect(readWorkHint(storage)).toBe(0)
  })

  it.each(['abc', '-4', '2.5', '', 'Infinity'])('reads %j as 0', (value) => {
    expect(readWorkHint({ getItem: () => value })).toBe(0)
  })

  it('survives storage that throws, or that is missing', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(readWorkHint(broken)).toBe(0)
    expect(() => writeWorkHint(5, broken)).not.toThrow()
    expect(() => writeWorkHint(5, undefined)).not.toThrow()
  })
})
