import { usePasteImages } from '@/features/images/use-paste-images'
import { WindowDropZone } from '@/features/images/window-drop-zone'
import { useEscapeDeselect } from '@/features/selection/use-escape-deselect'
import { DesktopLayout } from './desktop-layout'
import { Header } from './header'
import { LayoutProvider } from './layout-provider'
import { LiveRegion } from './live-region'
import { MobileLayout } from './mobile-layout'
import { useMediaQuery } from './use-media-query'

export function App() {
  const wide = useMediaQuery('(min-width: 1024px)')
  usePasteImages()
  useEscapeDeselect()

  return (
    <LayoutProvider>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Header />
        <main className="min-h-0 flex-1">{wide ? <DesktopLayout /> : <MobileLayout />}</main>
      </div>
      <WindowDropZone />
      <LiveRegion />
    </LayoutProvider>
  )
}
