import {
  BookmarkIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FileDownIcon,
  FileUpIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  Settings2Icon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PRESETS_BUTTON_ID } from '@/lib/dom-ids'
import { STORAGE_KEY, type Preset } from '@/lib/presets/schema'
import { resolveActive, sameSettings, settingsFromOptions } from '@/lib/presets/settings'
import { useAppStore } from '@/store'
import { presetBook, usePresets } from '@/store/presets'
import {
  applyPreset,
  deleteSavedPreset,
  duplicateSavedPreset,
  exportAll,
  exportOne,
  renameSavedPreset,
  reportLoadNotice,
  saveCurrentSettings,
  updateFromCurrent,
} from './actions'
import { ImportDialog } from './import-dialog'
import { AVAILABILITY, noticeText, quoted } from './messages'
import { PresetNameDialog, type NameTarget } from './preset-name-dialog'

type DialogTarget = NameTarget | { kind: 'import' }

/** Other tabs write presets to the same storage; this tab shows what they wrote, nothing more. */
function useOtherTabs() {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return
      const before = JSON.stringify(presetBook.store.getState().presets)
      presetBook.reload()
      // Another tab applying a preset writes the same key but changes nothing in the list.
      if (JSON.stringify(presetBook.store.getState().presets) !== before)
        useAppStore.getState().announce('Presets updated in another tab')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
}

const destructive =
  'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive [&_svg]:text-destructive'

function PresetActions({
  preset,
  differs,
  locked,
  onRename,
}: {
  preset: Preset
  /** The current settings are not this preset's. */
  differs: boolean
  locked: boolean
  onRename: () => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="truncate" dir="auto">
          {preset.name}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent collisionPadding={8}>
        <DropdownMenuItem disabled={locked} onSelect={onRename}>
          <PencilIcon />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={locked} onSelect={() => duplicateSavedPreset(preset.id)}>
          <CopyIcon />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={locked || !differs}
          onSelect={() => updateFromCurrent(preset.id)}
        >
          <RefreshCwIcon />
          Update with current settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => exportOne(preset.id)}>
          <FileDownIcon />
          Export
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={locked}
          className={destructive}
          onSelect={() => deleteSavedPreset(preset.id)}
        >
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * The presets control in the header: a menu that applies a preset in one step and shows which one
 * the settings belong to and whether they have moved away from it. Saving, renaming and importing
 * ask in a dialog; everything else happens at once and says so in a toast, with Undo where
 * something is lost.
 */
export function PresetsMenu() {
  const presets = usePresets((state) => state.presets)
  const activeId = usePresets((state) => state.activeId)
  const availability = usePresets((state) => state.availability)
  const notice = usePresets((state) => state.notice)
  const current = useAppStore(useShallow((state) => settingsFromOptions(state.options)))
  const active = resolveActive(presets, activeId, current)
  const modified = active?.modified ?? false
  const locked = availability === 'read-only'

  const [dialog, setDialog] = useState<{ target: DialogTarget; open: boolean } | null>(null)
  // A dialog opens only after the menu has finished closing: two layers open at once fight over focus.
  const opensAfterClose = useRef<DialogTarget | null>(null)

  useOtherTabs()

  useEffect(() => {
    const first = presetBook.store.getState().notice
    if (first) reportLoadNotice(first)
  }, [])

  // The visible text is the name, then “Modified”; the accessible name has to contain it as written.
  const label = active ? `Presets: ${active.preset.name}${modified ? ' Modified' : ''}` : 'Presets'
  const warning = AVAILABILITY[availability]
  // A newer version is both a notice and an availability; it is said once.
  const statusLines = [
    warning,
    notice && notice.kind !== 'newer-version' ? noticeText(notice) : null,
  ].filter((line): line is string => line !== null && line !== '')

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                id={PRESETS_BUTTON_ID}
                variant="outline"
                aria-label={label}
                className="sm:ml-2"
              >
                <span className="relative">
                  <BookmarkIcon />
                  {modified && (
                    <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary ring-2 ring-card lg:hidden" />
                  )}
                </span>
                <span className="hidden max-w-40 truncate lg:inline" dir="auto">
                  {active ? active.preset.name : 'Presets'}
                </span>
                {modified && (
                  <span className="hidden text-xs font-normal text-muted-foreground lg:inline">
                    {/* Collapses on screen; keeps "name Modified" readable as one phrase in the text. */}{' '}
                    Modified
                  </span>
                )}
                <ChevronDownIcon className="hidden text-muted-foreground lg:block" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Presets</TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          className="w-72 max-w-[calc(100vw-1.5rem)]"
          onCloseAutoFocus={(event) => {
            const next = opensAfterClose.current
            if (!next) return
            opensAfterClose.current = null
            event.preventDefault()
            setDialog({ target: next, open: true })
          }}
        >
          <DropdownMenuLabel>Presets</DropdownMenuLabel>
          {statusLines.map((line) => (
            <DropdownMenuLabel key={line} className="font-normal leading-snug">
              {line}
            </DropdownMenuLabel>
          ))}

          {presets.length === 0 ? (
            <DropdownMenuLabel className="font-normal leading-snug">
              No presets yet. Save the current settings to use them again in one step.
            </DropdownMenuLabel>
          ) : (
            <DropdownMenuRadioGroup value={active?.preset.id ?? ''}>
              {presets.map((preset) => (
                <DropdownMenuRadioItem
                  key={preset.id}
                  value={preset.id}
                  onSelect={() => applyPreset(preset.id)}
                >
                  <span className="truncate" dir="auto">
                    {preset.name}
                  </span>
                  {modified && active?.preset.id === preset.id && (
                    <span className="ml-auto pl-2 text-xs text-muted-foreground">Modified</span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}

          <DropdownMenuSeparator />
          {active && modified && (
            <>
              <DropdownMenuItem
                disabled={locked}
                onSelect={() => updateFromCurrent(active.preset.id)}
              >
                <RefreshCwIcon />
                <span className="truncate">Update {quoted(active.preset.name)}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => applyPreset(active.preset.id, 'Reverted to')}>
                <RotateCcwIcon />
                <span className="truncate">Revert to {quoted(active.preset.name)}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            disabled={locked}
            onSelect={() => {
              opensAfterClose.current = { kind: 'save' }
            }}
          >
            <SaveIcon />
            Save current settings…
          </DropdownMenuItem>
          {presets.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Settings2Icon />
                Manage presets
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                collisionPadding={8}
                className="w-64 max-w-[calc(100vw-1.5rem)]"
              >
                {presets.map((preset) => (
                  <PresetActions
                    key={preset.id}
                    preset={preset}
                    differs={!sameSettings(preset.settings, current)}
                    locked={locked}
                    onRename={() => {
                      opensAfterClose.current = {
                        kind: 'rename',
                        id: preset.id,
                        name: preset.name,
                      }
                    }}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={locked}
            onSelect={() => {
              opensAfterClose.current = { kind: 'import' }
            }}
          >
            <FileUpIcon />
            Import presets…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={presets.length === 0} onSelect={exportAll}>
            <DownloadIcon />
            Export all presets
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog && dialog.target.kind !== 'import' && (
        <PresetNameDialog
          target={dialog.target}
          open={dialog.open}
          onOpenChange={(open) => setDialog({ ...dialog, open })}
          onSubmit={(target, name) =>
            target.kind === 'rename'
              ? renameSavedPreset(target.id, name)
              : saveCurrentSettings(name)
          }
        />
      )}
      {dialog && dialog.target.kind === 'import' && (
        <ImportDialog open={dialog.open} onOpenChange={(open) => setDialog({ ...dialog, open })} />
      )}
    </>
  )
}
