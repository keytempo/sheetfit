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

  it('shows just Continue when the time limit was reached: no icon, no label, no other status', () => {
    const html = render(withStatus('best-found'), false, true)
    expect(html).toContain('>Continue<')
    expect(html).toContain('aria-label="Continue searching for a tighter layout"')
    expect(html).not.toContain('Best found')
    expect(html).not.toContain('Optimizing')
    expect(html).not.toContain('<svg')
  })

  it('tells screen readers the time limit was reached, without showing it', () => {
    const html = render(withStatus('best-found'), false, true)
    expect(html).toMatch(/<span role="status" class="sr-only">Time limit reached<\/span>/)
    expect(html).not.toMatch(/<button[^>]*>[^<]*Time limit/)
  })

  const classesOf = (html: string, tag: 'button' | 'span', containing: string) => {
    const match = [...html.matchAll(new RegExp(`<${tag}[^>]*class="([^"]*)"`, 'g'))]
      .map((m) => m[1])
      .find((classes) => classes.includes(containing))
    return (match ?? '').split(/\s+/)
  }

  it('looks exactly like the Optimal pill: the same badge and colour tokens, and nothing on hover', () => {
    const optimal = classesOf(render(withStatus('optimal')), 'span', 'backdrop-blur-sm')
    const pill = classesOf(
      render(withStatus('best-found'), false, true),
      'button',
      'backdrop-blur-sm',
    )
    expect(optimal.length).toBeGreaterThan(5)
    for (const token of optimal) expect(pill).toContain(token)
    expect(pill.filter((token) => token.includes('hover:'))).toEqual([])
    // The only things added are what a button needs, none of it visible: it takes clicks, shows a
    // pointer, has a focus ring, and has a clickable margin round it.
    const added = pill.filter((token) => !optimal.includes(token))
    expect(
      added.every((token) =>
        /pointer|focus-visible|outline|after:|relative|overflow-visible/.test(token),
      ),
    ).toBe(true)
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
