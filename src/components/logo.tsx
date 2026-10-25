import type { ComponentProps } from 'react'

/** Four photos nested on one sheet. */
export function LogoMark(props: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <g className="fill-primary-foreground">
        <rect x="7" y="7" width="10" height="13" rx="1.5" />
        <rect x="19" y="7" width="6" height="6" rx="1.5" fillOpacity=".85" />
        <rect x="19" y="15" width="6" height="10" rx="1.5" fillOpacity=".7" />
        <rect x="7" y="22" width="10" height="3" rx="1.5" fillOpacity=".55" />
      </g>
    </svg>
  )
}
