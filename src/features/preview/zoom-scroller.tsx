import { motion } from 'motion/react'
import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useAppStore } from '@/store'
import { currentZoomFactor, setZoomFactor, scaleZoom, zoomWidthCss } from './zoom'

interface ZoomScrollerProps {
  sheetWidth: number
  sheetHeight: number
  children: ReactNode
}

interface Point {
  x: number
  y: number
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The scrolling surface that holds the sheets. It owns the zoom: it publishes the sheet width as a
 * CSS variable, handles Ctrl/Cmd-wheel and two-finger pinch, and in scroll mode reports which
 * sheet is in view. Because `children` is created by the parent, a zoom change re-renders only
 * this wrapper, never the pieces.
 */
export function ZoomScroller({ sheetWidth, sheetHeight, children }: ZoomScrollerProps) {
  const zoom = useAppStore((state) => state.zoom)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const touches = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    // A native listener is needed: React registers wheel handlers as passive, which cannot
    // cancel the browser's own page zoom.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      scaleZoom(Math.exp(-event.deltaY * 0.0025), sheetWidth)
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [sheetWidth])

  const handleScroll = () => {
    const scroller = scrollerRef.current
    const { viewMode, currentSheet, setCurrentSheet } = useAppStore.getState()
    if (!scroller || viewMode !== 'scroll') return

    const threshold = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.4
    let index = 0
    for (const sheet of scroller.querySelectorAll<HTMLElement>(
      '[data-sheet-column] [data-sheet-index]',
    )) {
      if (sheet.getBoundingClientRect().top <= threshold) index = Number(sheet.dataset.sheetIndex)
    }
    if (index !== currentSheet) setCurrentSheet(index)
  }

  const handlePointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'touch') return
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()]
      pinch.current = {
        distance: distance(a, b),
        zoom: currentZoomFactor(useAppStore.getState().zoom, sheetWidth),
      }
    }
  }

  const handlePointerMove = (event: ReactPointerEvent) => {
    if (!touches.current.has(event.pointerId)) return
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()]
      setZoomFactor((pinch.current.zoom * distance(a, b)) / pinch.current.distance)
    }
  }

  const handlePointerEnd = (event: ReactPointerEvent) => {
    touches.current.delete(event.pointerId)
    if (touches.current.size < 2) pinch.current = null
  }

  return (
    <motion.div
      layoutScroll
      ref={scrollerRef}
      role="region"
      aria-label="Sheets"
      tabIndex={0}
      onScroll={handleScroll}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      style={{ '--sheet-w': zoomWidthCss(zoom, sheetWidth, sheetHeight) } as CSSProperties}
      className="canvas-surface absolute inset-0 touch-pan-x touch-pan-y overflow-auto overscroll-contain [--sheet-pad:1rem] [container-type:size] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:[--sheet-pad:2rem]"
    >
      <div className="relative flex min-h-full w-max min-w-full flex-col p-(--sheet-pad)">
        {children}
      </div>
    </motion.div>
  )
}
