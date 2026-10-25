import { clamp } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { Zoom } from '@/store/types'

/** CSS pixels per millimetre at actual size (96 px per inch). */
const PX_PER_MM = 96 / 25.4

const ZOOM_MIN = 0.1
const ZOOM_MAX = 4
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

export const ZOOM_MENU_PRESETS = [0.5, 0.75, 1, 1.5]

/**
 * The CSS width of a sheet for a zoom setting. The fit modes use container query units against
 * the scroll area, so the sheet re-fits on every frame of a panel resize with no JavaScript.
 */
export function zoomWidthCss(zoom: Zoom, sheetWidth: number, sheetHeight: number) {
  const fitWidth = 'calc(100cqw - 2 * var(--sheet-pad))'
  switch (zoom.kind) {
    case 'fit-width':
      return fitWidth
    case 'fit-page':
      return `min(${fitWidth}, calc((100cqh - 2 * var(--sheet-pad)) * ${sheetWidth / sheetHeight}))`
    case 'custom':
      return `${sheetWidth * zoom.value * PX_PER_MM}px`
  }
}

export function zoomLabel(zoom: Zoom) {
  switch (zoom.kind) {
    case 'fit-width':
      return 'Fit width'
    case 'fit-page':
      return 'Fit page'
    case 'custom':
      return `${Math.round(zoom.value * 100)}%`
  }
}

/** The zoom factor on screen right now. For the fit modes it is measured from the sheet itself. */
export function currentZoomFactor(zoom: Zoom, sheetWidth: number) {
  if (zoom.kind === 'custom') return zoom.value
  const page = document.querySelector('[data-sheet-page]')
  return page ? page.getBoundingClientRect().width / (sheetWidth * PX_PER_MM) : 1
}

export function setZoomFactor(factor: number) {
  useAppStore.getState().setZoom({ kind: 'custom', value: clamp(factor, ZOOM_MIN, ZOOM_MAX) })
}

/** Moves to the next or previous standard zoom level. */
export function stepZoom(direction: 1 | -1, sheetWidth: number) {
  const current = currentZoomFactor(useAppStore.getState().zoom, sheetWidth)
  const next =
    direction === 1
      ? ZOOM_STEPS.find((step) => step > current * 1.01)
      : [...ZOOM_STEPS].reverse().find((step) => step < current / 1.01)
  setZoomFactor(next ?? (direction === 1 ? ZOOM_MAX : ZOOM_MIN))
}

/** Scales the current zoom, used by Ctrl-wheel and pinch. */
export function scaleZoom(factor: number, sheetWidth: number) {
  setZoomFactor(currentZoomFactor(useAppStore.getState().zoom, sheetWidth) * factor)
}
