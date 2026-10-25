import type { LayoutResult, PlacedSheet } from '@/lib/layout-types'
import { formatArea, formatNumber, formatSize } from '@/lib/units'
import { getSheetGeometry } from '@/lib/sheet'
import { useAppStore } from '@/store'

interface HoverStatsProps {
  sheet: PlacedSheet
  layout: LayoutResult
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * Statistics for one sheet. It is always in the page, invisible, and fades in only while the
 * pointer is over the sheet. `hover:` utilities apply only on devices that can hover, so touch
 * screens never show it.
 */
export function HoverStats({ sheet, layout }: HoverStatsProps) {
  const options = useAppStore((state) => state.options)
  const { unit } = options
  const { stats } = sheet
  const { label } = getSheetGeometry(options)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-3 right-3 z-30 w-60 translate-y-1 rounded-lg border bg-popover/90 px-3 py-2.5 text-xs text-popover-foreground opacity-0 shadow-lg backdrop-blur-md transition-[opacity,translate] duration-(--dur-exit) ease-(--ease-exit) group-hover/sheet:translate-y-0 group-hover/sheet:opacity-100 group-hover/sheet:duration-(--dur-enter) group-hover/sheet:ease-(--ease-enter)"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-sm font-semibold tracking-tight">Sheet {sheet.index + 1}</p>
        <p className="font-mono text-sm font-semibold text-primary tabular-nums">
          {formatNumber(stats.fillPercent, 1)}% filled
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full origin-left rounded-full bg-primary"
          style={{ transform: `scaleX(${Math.min(1, stats.fillPercent / 100)})` }}
        />
      </div>
      <dl className="mt-2.5 flex flex-col gap-1">
        <Row label="Pieces" value={String(stats.pieceCount)} />
        <Row label="Used" value={formatArea(stats.usedArea, unit)} />
        <Row label="Wasted" value={formatArea(stats.wastedArea, unit)} />
        <Row
          label="Sheet"
          value={`${label} · ${formatSize(layout.sheetWidth, layout.sheetHeight, unit)}`}
        />
      </dl>
    </div>
  )
}
