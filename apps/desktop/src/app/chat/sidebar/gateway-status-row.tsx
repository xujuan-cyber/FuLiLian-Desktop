import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'

import { LanguageSwitcher } from '@/components/language-switcher'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $activeConnectionId, $connectionsRegistry } from '@/store/connections'
import { $gatewayState } from '@/store/session'
import { checkUpdates } from '@/store/updates'

import { SETTINGS_ROUTE } from '../../routes'

/** The v3 `sidebar.*` keys this dock reads that W4 lands in the i18n files.
 *  Optional on purpose — a missing key hides its affordance rather than
 *  replacing it with a literal string. */
interface DockCopy {
  about?: string
  checkUpdates?: string
  device?: string
  more?: string
  moreAria?: string
  nav?: Record<string, string | undefined>
}

/** The 36px status dock (§8.2): the sidebar's single structural hairline sits
 *  on its top edge, inset 12px. Left: the connection's 6px state dot and
 *  `本地网关 · 已连接` — the one place green is allowed to appear. Right: the
 *  ⋯「更多」menu, which hosts every action the old bottom icon row carried.
 *
 *  The dot reports state (running / error / idle); it is never a control. The
 *  row around the text opens a popover for the details that used to sit on
 *  three separate status lines: this device, the gateway state, the language
 *  shortcut, and About. */
export function SidebarGatewayStatusRow() {
  const { t } = useI18n()
  const g = t.sidebar.gateway
  const dock = t.sidebar as unknown as DockCopy
  const state = useStore($gatewayState)
  const activeConnectionId = useStore($activeConnectionId)
  const registry = useStore($connectionsRegistry)
  const navigate = useNavigate()

  const connection = registry?.connections.find(entry => entry.id === activeConnectionId) ?? null

  const label =
    state === 'open' ? g.connected : state === 'connecting' ? g.connecting : state === 'error' ? g.error : g.offline

  const text = `${g.local} · ${label}`

  const dotClass = state === 'open' ? 'bg-(--v3-accent)' : state === 'error' ? 'bg-(--v3-warn)' : 'bg-(--v3-ink-4)'

  const go = (target: string) => () => navigate(target)

  return (
    <div
      className="v3-hairline-t flex h-9 shrink-0 items-center gap-0.5 px-3"
      data-testid="sidebar-gateway-status"
      role="group"
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            aria-label={text}
            className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] px-2 text-[12px] text-(--v3-ink-3) transition-colors duration-100 ease-out hover:bg-(--v3-hover) hover:text-(--v3-ink-2) hover:transition-none"
            data-tip-region=""
            type="button"
          >
            <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dotClass)} />
            <span className="min-w-0 truncate">{text}</span>
            <Codicon className="ms-auto shrink-0 opacity-60" name="chevron-up" size="0.75rem" />
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-60 p-2" side="top">
          {/* This device: which registered gateway the workspace is actually
              talking to. The switcher lives in the statusbar; this line only
              answers "which machine am I on". */}
          {dock.device ? (
            <div className="px-1 pb-1 text-[11px] font-semibold text-(--v3-ink-3)">{dock.device}</div>
          ) : null}
          <div className="flex items-center gap-2 rounded-[6px] px-1 py-1.5 text-[12px] text-(--v3-ink-2)">
            <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dotClass)} />
            <span className="min-w-0 truncate">{connection?.label ?? g.local}</span>
            <span className="ms-auto shrink-0 text-[11px] text-(--v3-ink-3)">{label}</span>
          </div>

          <div className="my-1.5 h-px bg-(--v3-line)" />
          <div className="px-1 pb-1.5">
            <LanguageSwitcher className="w-full" dropUp />
          </div>

          <div className="my-1.5 h-px bg-(--v3-line)" />
          <button
            className="flex h-7 w-full items-center gap-2 rounded-[6px] px-1 text-start text-[12px] text-(--v3-ink-2) hover:bg-(--v3-hover)"
            onClick={go(`${SETTINGS_ROUTE}?tab=about`)}
            type="button"
          >
            <Codicon name="info" size="0.875rem" />
            <span className="min-w-0 truncate">{dock.about ?? t.settings.nav.about}</span>
          </button>
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={dock.moreAria ?? dock.more}
            className="size-7 shrink-0 rounded-[6px] text-(--v3-ink-3) hover:bg-(--v3-hover) hover:text-(--v3-ink-2)"
            data-tip-region=""
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="ellipsis" size="1rem" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48" side="top">
          <DropdownMenuItem onSelect={go(SETTINGS_ROUTE)}>
            <Codicon name="settings-gear" size="0.875rem" />
            {dock.nav?.settings ?? t.commandCenter.nav.settings.title}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={go(`${SETTINGS_ROUTE}?tab=keybinds`)}>
            <Codicon name="keyboard" size="0.875rem" />
            {t.settings.nav.keybinds}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void checkUpdates()}>
            <Codicon name="cloud-download" size="0.875rem" />
            {dock.checkUpdates ?? t.settings.about.checkNow}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={go(`${SETTINGS_ROUTE}?tab=about`)}>
            <Codicon name="info" size="0.875rem" />
            {dock.about ?? t.settings.nav.about}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Profile / Fleet actions. The rail above the dock keeps the quick
              switch; these are the management doors it has always carried, kept
              here too so the ⋯ menu is a complete index of the sidebar. */}
          <DropdownMenuItem onSelect={go('/profiles')}>
            <Codicon name="account" size="0.875rem" />
            {t.profiles.manageProfiles}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={go(`${SETTINGS_ROUTE}?tab=gateway`)}>
            <Codicon name="plug" size="0.875rem" />
            {t.profiles.connectGateway}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
