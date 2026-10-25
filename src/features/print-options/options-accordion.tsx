import {
  EyeIcon,
  FrameIcon,
  LayoutGridIcon,
  RectangleVerticalIcon,
  RulerIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { BaseSizeSection } from './base-size-section'
import { LayoutSection } from './layout-section'
import { PreviewSection } from './preview-section'
import { SheetSection } from './sheet-section'
import { SpacingSection } from './spacing-section'

const SECTIONS: { value: string; title: string; icon: LucideIcon; content: ReactNode }[] = [
  { value: 'sheet', title: 'Sheet', icon: RectangleVerticalIcon, content: <SheetSection /> },
  { value: 'base-size', title: 'Base print size', icon: RulerIcon, content: <BaseSizeSection /> },
  { value: 'spacing', title: 'Spacing', icon: FrameIcon, content: <SpacingSection /> },
  { value: 'layout', title: 'Layout', icon: LayoutGridIcon, content: <LayoutSection /> },
  { value: 'preview', title: 'Preview', icon: EyeIcon, content: <PreviewSection /> },
]

export function OptionsAccordion() {
  return (
    <Accordion type="multiple" defaultValue={SECTIONS.map((section) => section.value)}>
      {SECTIONS.map(({ value, title, icon: Icon, content }) => (
        <AccordionItem key={value} value={value}>
          <AccordionTrigger>
            <span className="flex items-center gap-2.5">
              <Icon className="size-4 text-primary" />
              {title}
            </span>
          </AccordionTrigger>
          <AccordionContent>{content}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
