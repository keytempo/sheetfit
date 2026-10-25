import { SwitchField } from './field'
import { useOption } from './use-option'

export function PreviewSection() {
  const [showMargins, setShowMargins] = useOption('showMargins')
  const [showSheetNumbers, setShowSheetNumbers] = useOption('showSheetNumbers')

  return (
    <>
      <SwitchField
        label="Show margins"
        tooltip="Outlines the margin on every previewed sheet with a dashed line. It does not appear in the PDF."
        helper="A dashed line marks the printable area."
        checked={showMargins}
        onCheckedChange={setShowMargins}
      />
      <SwitchField
        label="Show sheet numbers"
        tooltip="Adds a small number badge to the corner of every previewed sheet. It does not appear in the PDF."
        helper="A numbered badge on each sheet."
        checked={showSheetNumbers}
        onCheckedChange={setShowSheetNumbers}
      />
    </>
  )
}
