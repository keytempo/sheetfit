import { useRef, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { addImageFiles } from './add-images'

/** A button that opens the file picker. On phones the picker offers the gallery and the camera. */
export function AddImagesButton({
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick'>) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <Button onClick={() => inputRef.current?.click()} {...props}>
        {children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        hidden
        onChange={(event) => {
          void addImageFiles([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
    </>
  )
}
