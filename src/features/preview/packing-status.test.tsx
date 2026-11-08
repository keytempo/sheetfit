import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { LayoutResult, UnplaceablePiece } from '@/lib/layout-types'
import { handLayout } from '@/pdf/testing/fixtures'
import { PackingStatus } from './packing-status'

const sheet = [{ imageId: 'a', x: 10, y: 10, width: 20, height: 20 }]

function render(layout: LayoutResult, searching = false, limitReached = false) {
  return renderToStaticMarkup(
    <PackingStatus
      layout={layout}
      searching={searching}
      limitReached={limitReached}
      onContinue={() => {}}
    />,
  )
}

const withStatus = (status: LayoutResult['status']): LayoutResult => ({
  ...handLayout([sheet]),
  status,
})
const unplaced = (count: number): UnplaceablePiece[] =>
  Array.from({ length: count }, (_, i) => ({
    piece: { id: `a:${i}`, imageId: 'a', copy: i + 1, copies: count, width: 500, height: 500 },
    reason: 'too-large' as const,
  }))
const withUnplaced = (count: number): LayoutResult => ({
  ...handLayout([sheet]),
  unplaceable: unplaced(count),
})

describe('PackingStatus', () => {
  it('says Optimal for a layout proven to use the fewest sheets', () => {
    expect(render(withStatus('optimal'))).toContain('Optimal')
  })

  it('says Best found for a layout that is not proven', () => {
    const html = render(withStatus('best-found'))
    expect(html).toContain('Best found')
    expect(html).not.toContain('Optimal')
  })

  it('says Optimizing… while the packer is searching, whatever the shown layout says', () => {
    for (const status of ['optimal', 'best-found'] as const) {
      const html = render(withStatus(status), true)
      expect(html).toContain('Optimizing…')
      expect(html).not.toContain('Optimal<')
    }
  })

  it('says the time limit was reached, and offers Continue, instead of Best found', () => {
    const html = render(withStatus('best-found'), false, true)
    expect(html).toContain('Time limit reached')
    expect(html).toContain('>Continue<')
    expect(html).toContain('aria-label="Continue searching for a tighter layout"')
    expect(html).not.toContain('Best found')
    expect(html).not.toContain('Optimizing')
  })

  it('announces the time limit as a status, and keeps Continue out of the announcement', () => {
    const html = render(withStatus('best-found'), false, true)
    const status = html.match(/<span role="status"[^>]*>(.*?)<\/span>/)?.[1] ?? ''
    expect(status).toContain('Time limit reached')
    expect(status).not.toContain('Continue')
  })

  it('shows Optimizing… while a continued search runs, with no Continue to press again', () => {
    const html = render(withStatus('best-found'), true, true)
    expect(html).toContain('Optimizing…')
    expect(html).not.toContain('Continue')
    expect(html).not.toContain('Time limit reached')
  })

  it('offers no Continue for a layout that needs none', () => {
    expect(render(withStatus('optimal'))).not.toContain('Continue')
    expect(render(withStatus('best-found'))).not.toContain('Continue')
  })

  it('shows no time-limit state when there are no sheets', () => {
    expect(render(handLayout([]), false, true)).not.toContain('Time limit reached')
  })

  it('announces the status as a status region and stops the spinner for reduced motion', () => {
    const html = render(withStatus('best-found'), true)
    expect(html).toContain('role="status"')
    expect(html).toContain('motion-reduce:animate-none')
  })

  it('shows no status when there are no sheets', () => {
    expect(render(handLayout([]))).not.toContain('role="status"')
  })

  it('warns, in the right grammar, about copies that fit on no sheet', () => {
    expect(render(withUnplaced(0))).not.toContain('fit on the sheet')
    expect(render(withUnplaced(1))).toContain('1 copy does not fit on the sheet')
    expect(render(withUnplaced(3))).toContain('3 copies do not fit on the sheet')
  })

  it('shows the warning even when nothing at all could be placed', () => {
    const layout: LayoutResult = { ...handLayout([]), unplaceable: unplaced(1) }
    const html = render(layout)
    expect(html).toContain('1 copy does not fit on the sheet')
    expect(html).not.toContain('role="status"')
  })
})
