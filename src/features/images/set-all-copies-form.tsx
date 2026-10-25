import { useState } from 'react'
import { toast } from 'sonner'
import { NumberField } from '@/components/number-field'
import { Button } from '@/components/ui/button'
import { pluralize } from '@/lib/format'
import { LIMITS } from '@/lib/print-options'
import { useAppStore } from '@/store'

export function SetAllCopiesForm({ onDone }: { onDone: () => void }) {
  const [copies, setCopies] = useState(1)
  const imageCount = useAppStore((state) => state.images.length)
  const setAllCopies = useAppStore((state) => state.setAllCopies)

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setAllCopies(copies)
        toast(`Every image now has ${pluralize(copies, 'copy', 'copies')}`)
        onDone()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Set all copies to</span>
        <NumberField
          aria-label="Number of copies for every image"
          value={copies}
          onChange={setCopies}
          min={LIMITS.copies.min}
          max={LIMITS.copies.max}
          decimals={0}
        />
        <p className="text-xs text-muted-foreground">
          Applies to all {pluralize(imageCount, 'image')}.
        </p>
      </div>
      <Button type="submit">Apply</Button>
    </form>
  )
}
