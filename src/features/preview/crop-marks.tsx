/** Print crop marks drawn just outside the four corners of the nearest positioned parent. */
export function CropMarks() {
  const line = 'absolute bg-current'
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 text-primary/60">
      <span className={`${line} top-0 -left-4 h-px w-3`} />
      <span className={`${line} -top-4 left-0 h-3 w-px`} />
      <span className={`${line} top-0 -right-4 h-px w-3`} />
      <span className={`${line} -top-4 right-0 h-3 w-px`} />
      <span className={`${line} bottom-0 -left-4 h-px w-3`} />
      <span className={`${line} -bottom-4 left-0 h-3 w-px`} />
      <span className={`${line} -right-4 bottom-0 h-px w-3`} />
      <span className={`${line} right-0 -bottom-4 h-3 w-px`} />
    </div>
  )
}
