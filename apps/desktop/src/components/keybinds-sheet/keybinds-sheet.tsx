import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'

import { SETTINGS_ROUTE } from '@/app/routes'
import { Codicon } from '@/components/ui/codicon'
import { Kbd, KbdCombo } from '@/components/ui/kbd'
import { useI18n } from '@/i18n'
import { Globe, LayoutDashboard, MessageCircle, Pencil } from '@/lib/icons'
import type { IconComponent } from '@/lib/icons'
import {
  $keybindsSheetOpen,
  KEYBIND_GROUP_ORDER,
  type KeybindGroupId,
  keybindSheetRows,
  type ResolvedKeybindRow,
  setKeybindsSheetOpen
} from '@/store/keybinds-registry'

// Step 16 · T9 (方案 §3-T9, 预览 08-keybinds-help.png): the ? cheat sheet — a
// read-only four-card overlay over the SAME registry the keybinds settings
// page reads (store/keybinds-registry.ts). No key listeners live here: '?'
// toggling and Esc closing are dispatched by use-keybinds (the single global
// keydown owner), so the sheet stays a pure function of the store.

const GROUP_ICONS: Record<KeybindGroupId, IconComponent> = {
  global: Globe,
  sessionApproval: MessageCircle,
  editing: Pencil,
  navigationView: LayoutDashboard
}

export function KeybindsSheet() {
  const { t } = useI18n()
  const open = useStore($keybindsSheetOpen)
  const navigate = useNavigate()
  const dialogRef = useRef<HTMLDivElement>(null)
  const k = t.keybinds

  // Focus the card when it opens so Esc/copy users have an anchor; restore
  // focus to the previous holder on close (Radix-style courtesy, hand-rolled —
  // this overlay deliberately sits outside the Dialog machinery).
  useEffect(() => {
    if (!open) {
      return
    }

    const previous = document.activeElement as HTMLElement | null

    dialogRef.current?.focus()

    return () => previous?.focus?.()
  }, [open])

  if (!open) {
    return null
  }

  const rows = keybindSheetRows()

  return createPortal(
    <div className="contents" data-slot="keybinds-sheet">
      {/* Click-catcher: click-away closes, dimmed like the palette overlay. */}
      <div
        aria-hidden
        className="fixed inset-0 z-(--z-switcher-backdrop) bg-black/22 backdrop-blur-[0.125rem]"
        data-slot="keybinds-sheet-backdrop"
        onClick={() => setKeybindsSheetOpen(false)}
      />
      <div
        aria-label={k.title}
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-(--z-switcher) max-h-[min(42rem,88vh)] w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-(--ui-chat-bubble-background) text-foreground shadow-nous outline-none"
        data-slot="keybinds-sheet-card"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) px-5 py-3.5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h2 className="text-sm font-semibold">{k.title}</h2>
            <span className="min-w-0 truncate text-[0.72rem] text-muted-foreground">{k.sheet.hint}</span>
          </div>
          <button
            aria-label={k.sheet.close}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.72rem] text-muted-foreground transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
            onClick={() => setKeybindsSheetOpen(false)}
            type="button"
          >
            <Kbd size="sm">esc</Kbd>
            {k.sheet.close}
          </button>
        </header>

        <div className="grid grid-cols-1 gap-x-6 gap-y-1 px-5 py-3 sm:grid-cols-2">
          {KEYBIND_GROUP_ORDER.map(group => (
            <SheetGroup group={group} key={group} rows={rows.filter(row => row.group === group)} />
          ))}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-(--ui-stroke-tertiary) px-5 py-2.5">
          <p className="min-w-0 truncate text-[0.72rem] text-muted-foreground">{k.sheet.footerNote}</p>
          <button
            className="flex shrink-0 items-center gap-1 text-[0.72rem] font-medium text-info transition-colors hover:underline"
            onClick={() => {
              setKeybindsSheetOpen(false)
              navigate(`${SETTINGS_ROUTE}?tab=keybinds`)
            }}
            type="button"
          >
            <Codicon name="settings-gear" size="0.75rem" />
            {k.sheet.goSettings}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

function SheetGroup({ group, rows }: { group: KeybindGroupId; rows: ResolvedKeybindRow[] }) {
  const { t } = useI18n()
  const k = t.keybinds
  const Icon = GROUP_ICONS[group]

  return (
    <section className="py-2" data-group={group} data-slot="keybinds-sheet-group">
      <h3 className="flex items-center gap-1.5 pb-1 text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{k.groups[group]}</span>
      </h3>
      <div className="grid">
        {rows.map(row => (
          <SheetRow key={row.id} row={row} />
        ))}
      </div>
    </section>
  )
}

function SheetRow({ row }: { row: ResolvedKeybindRow }) {
  const { t } = useI18n()
  const k = t.keybinds
  const label = k.actions[row.id] ?? row.id

  return (
    <div className="flex min-h-7 items-center gap-2.5 border-b border-(--ui-stroke-tertiary)/60 py-1 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-[0.82rem] text-foreground/90">{label}</span>
      {row.status === 'reserved' && (
        <span className="shrink-0 rounded-full border border-(--ui-stroke-tertiary) px-1.5 py-px text-[0.625rem] text-muted-foreground">
          {k.sheet.reserved}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1">
        {row.combos.map(combo => (
          <KbdCombo combo={combo} key={combo} size="sm" />
        ))}
      </span>
    </div>
  )
}
