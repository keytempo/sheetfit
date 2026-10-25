import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useMediaQuery } from './use-media-query'
import { ThemeProvider } from './theme-provider'
import { useTheme } from './theme-context'

function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  const wide = useMediaQuery('(min-width: 1024px)')
  return (
    <Toaster
      theme={resolvedTheme}
      position={wide ? 'bottom-right' : 'top-center'}
      toastOptions={{ classNames: { actionButton: '!bg-primary !text-primary-foreground' } }}
    />
  )
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          {children}
          <ThemedToaster />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  )
}
