import { describe, expect, it } from 'vitest'
import { exportInput, exportImage, fakeJpeg, handLayout, makeFile } from '../testing/fixtures'
import type { DecodeImage } from '../browser-decode'
import { createExportHost, describeFailure } from './host'
import type { ExportResponse } from './protocol'

const refuse: DecodeImage = () => Promise.reject(new Error('no decoder here'))

function run(input: Parameters<typeof exportInput>) {
  const responses: ExportResponse[] = []
  const host = createExportHost((response) => responses.push(response), refuse)
  return { responses, done: host.handle({ type: 'export', input: exportInput(...input) }) }
}

describe('export host', () => {
  const image = exportImage('a', makeFile(fakeJpeg({ width: 40, height: 30 }), 'a.jpg'), 40, 30)
  const layout = handLayout([[{ imageId: 'a', x: 10, y: 10, width: 20, height: 15 }]])

  it('reports progress, then the finished file', async () => {
    const { responses, done } = run([layout, [image]])
    await done
    const last = responses.at(-1)!
    expect(last.type).toBe('done')
    expect(responses.filter((r) => r.type === 'progress').length).toBeGreaterThan(2)
    if (last.type === 'done') expect(last.blob.size).toBeGreaterThan(100)
  })

  it('reports a failure in words instead of throwing', async () => {
    const { responses, done } = run([handLayout([]), [image]])
    await done
    expect(responses).toHaveLength(1)
    const [response] = responses
    expect(response.type).toBe('failed')
    if (response.type === 'failed') expect(response.message).toMatch(/nothing to export/)
  })

  it('describes running out of memory in a way the person can act on', () => {
    expect(describeFailure(new RangeError('Array buffer allocation failed'))).toMatch(
      /ran out of memory/,
    )
    expect(describeFailure(new Error('Out of memory'))).toMatch(/ran out of memory/)
    expect(describeFailure(new Error('Could not read a.png.'))).toBe('Could not read a.png.')
    expect(describeFailure('strange')).toBe('The PDF could not be created.')
  })
})
