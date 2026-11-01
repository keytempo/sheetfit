import type { ReactNode } from 'react'
import { LayoutContext } from '@/store/layout-context'
import { usePacking } from '@/store/packing'

/**
 * Packs the sheets for the whole app. It sits above both layouts because the header needs the
 * layout (to export it) even when a narrow screen shows only the image list.
 */
export function LayoutProvider({ children }: { children: ReactNode }) {
  return <LayoutContext value={usePacking()}>{children}</LayoutContext>
}
