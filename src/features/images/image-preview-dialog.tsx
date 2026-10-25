import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatNumber } from '@/lib/units'
import type { ImageItem } from '@/store/types'

/** The image being previewed is kept while the dialog fades out, even if it was just removed. */
export interface PreviewState {
  image: ImageItem
  open: boolean
}

interface ImagePreviewDialogProps extends PreviewState {
  onOpenChange: (open: boolean) => void
}

export function ImagePreviewDialog({ image, open, onOpenChange }: ImagePreviewDialogProps) {
  const megapixels = (image.width * image.height) / 1_000_000

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">{image.name}</DialogTitle>
          <DialogDescription className="font-mono tabular-nums">
            {image.width} × {image.height} px · {formatNumber(megapixels, 1)} MP
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center rounded-lg border bg-muted p-2">
          <img
            src={image.url}
            alt={image.name}
            className="max-h-[65dvh] w-auto max-w-full rounded-sm object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
