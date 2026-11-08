import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/app'
import { Providers } from '@/app/providers'
import { startWorkSession } from '@/features/work/session'
import './index.css'

void startWorkSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
)
