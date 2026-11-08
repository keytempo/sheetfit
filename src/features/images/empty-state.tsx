import { ImagePlusIcon } from 'lucide-react'
import { AddImagesButton } from './add-images-button'

/** A tiny sheet with crop marks, the same motif the empty preview uses. */
function SheetIllustration() {
  return (
    <svg viewBox="0 0 96 112" className="h-28 w-24 text-primary" fill="none" aria-hidden="true">
      <rect
        x="14"
        y="14"
        width="68"
        height="84"
        rx="3"
        className="fill-card stroke-border"
        strokeWidth="1.5"
      />
      <rect
        x="22"
        y="22"
        width="30"
        height="38"
        rx="2"
        className="fill-primary/15 stroke-primary/60"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <rect
        x="56"
        y="22"
        width="18"
        height="18"
        rx="2"
        className="fill-primary/10 stroke-primary/40"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <rect
        x="56"
        y="44"
        width="18"
        height="30"
        rx="2"
        className="fill-primary/10 stroke-primary/40"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <rect
        x="22"
        y="64"
        width="30"
        height="10"
        rx="2"
        className="fill-primary/10 stroke-primary/40"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".7">
        <path d="M2 14h8M14 2v8M94 14h-8M82 2v8M2 98h8M14 110v-8M94 98h-8M82 110v-8" />
      </g>
    </svg>
  )
}

export function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <SheetIllustration />
      <div className="flex max-w-xs flex-col gap-2">
        <h2 className="font-display text-xl font-semibold tracking-tight">No images yet</h2>
        <p className="text-sm text-balance text-muted-foreground">
          Drop images anywhere on this page, or click Add images
        </p>
      </div>
      <AddImagesButton size="lg">
        <ImagePlusIcon />
        Add images
      </AddImagesButton>
      <p className="max-w-[16rem] text-xs text-balance text-muted-foreground">
        You can also paste from the clipboard. Images stay on this device and are kept here, so a
        reload does not lose them; nothing is uploaded.
      </p>
    </div>
  )
}
