import { useStore } from '@nanostores/react'
import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { codiconIcon } from '@/components/ui/codicon'
import { KbdCombo } from '@/components/ui/kbd'
import { TabDropdown } from '@/components/ui/tab-dropdown'
import { Tip } from '@/components/ui/tooltip'
import { getFulilianConfigDefaults, getFulilianConfigRecord, saveFulilianConfig } from '@/fulilian'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import {
  Archive,
  BarChart3,
  Bell,
  CheckCircle2,
  Clock,
  Download,
  EyeOff,
  FileText,
  FolderOpen,
  Globe,
  Info,
  Keyboard,
  KeyRound,
  Layers3,
  type IconComponent,
  Package,
  PawPrint,
  RefreshCw,
  Search,
  Settings2,
  Terminal,
  Upload,
  Zap
} from '@/lib/icons'
import { isEditableTarget } from '@/lib/keybinds/combo'
import { typeToFocusChar } from '@/lib/keybinds/composer-focus-keys'
import { cn } from '@/lib/utils'
import { $commandPaletteOpen, openCommandPalettePage } from '@/store/command-palette'
import { confirm } from '@/store/confirm'
import { bindingsFor } from '@/store/keybinds'
import { notifyError } from '@/store/notifications'

import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { OverlayIconButton } from '../overlays/overlay-chrome'
import { OverlayMain, OverlayNavItem, OverlaySidebar, OverlaySplitLayout } from '../overlays/overlay-split-layout'
import { OverlayView } from '../overlays/overlay-view'
import { SKILLS_ROUTE } from '../routes'

import { AboutSettings } from './about-settings'
import { ApprovalsPermissionsSettings } from './approvals-permissions-settings'
import { AppearanceSettings } from './appearance-settings'
import { AuditSettings } from './audit-settings'
import { BillingSettings } from './billing'
import { ConfigSettings } from './config-settings'
import { CtfSettings } from './ctf-settings'
import { SECTIONS, SETTINGS_GROUPS } from './constants'
import { EvidenceProtectionSettings } from './evidence-protection-settings'
import { ForensicsSettings } from './forensics-settings'
import { GatewaySettings } from './gateway-settings'
import { KeybindSettings } from './keybind-settings'
import { KEYS_VIEWS, KeysSettings, type KeysView } from './keys-settings'
import { NotificationsSettings } from './notifications-settings'
import { PetSettings } from './pet-settings'
import { PluginsSettings } from './plugins-settings'
import { PresetsSettings } from './presets-settings'
import { PROVIDER_VIEWS, ProvidersSettings, type ProviderView } from './providers-settings'
import { QuickEntrySettings } from './quick-entry-settings'
import { SensitiveInfoSettings } from './sensitive-info-settings'
import { SessionsSettings } from './sessions-settings'
import { SettingsContent } from './primitives'
import type { SettingsPageProps, SettingsView as SettingsViewId } from './types'

// Nav views derive from the Workbench group table (DESIGN_PROPOSAL §5.5) so
// the rail, the dropdown and the deep-link enum can never drift apart. The
// legacy `connections` alias is kept resolvable (redirected to gateway below)
// but has no nav row.
const SETTINGS_VIEWS: readonly SettingsViewId[] = [
  ...SETTINGS_GROUPS.flatMap(group => group.views),
  'connections'
]

export function SettingsView({ onClose, onConfigSaved, onMainModelChanged }: SettingsPageProps) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { hash, pathname, search } = useLocation()

  // MCP moved out of Settings into Capabilities (/skills?tab=mcp). Keep old
  // `/settings?tab=mcp` deep links working — `useRouteEnumParam` would silently
  // coerce the unknown tab to the default view otherwise. Preserve `server=` so
  // an old bookmark still lands on (and highlights) the selected server.
  useEffect(() => {
    const params = new URLSearchParams(search)

    if (params.get('tab') === 'mcp') {
      const server = params.get('server')
      const suffix = server ? `&server=${encodeURIComponent(server)}` : ''
      navigate(`${SKILLS_ROUTE}?tab=mcp${suffix}`, { replace: true })
    }
  }, [navigate, search])

  const [activeView, setActiveView] = useRouteEnumParam('tab', SETTINGS_VIEWS, 'config:model' as SettingsViewId)

  // Connections merged into the unified Gateways page: land old
  // `?tab=connections` routes/bookmarks there instead of a dead entry.
  useEffect(() => {
    if (activeView === 'connections') {
      setActiveView('gateway')
    }
  }, [activeView, setActiveView])
  // Providers subnav (Accounts vs API keys) lives in its own param so each
  // sub-view is deep-linkable and survives a refresh.
  const [providerView, setProviderView] = useRouteEnumParam<ProviderView>('pview', PROVIDER_VIEWS, 'accounts')
  const [keysView] = useRouteEnumParam<KeysView>('kview', KEYS_VIEWS, 'tools')

  // Jump to a section + its sub-view in one navigate. Two sequential setters
  // would each read the same stale `search` and the second would clobber the
  // first's `tab` — so the sub-view never opened on narrow screens.
  const openSubView = useCallback(
    (tab: SettingsViewId, param: string, value: string, fallback: string) => {
      const params = new URLSearchParams(search)
      params.set('tab', tab)

      if (value === fallback) {
        params.delete(param)
      } else {
        params.set(param, value)
      }

      const qs = params.toString()
      navigate({ hash, pathname, search: qs ? `?${qs}` : '' }, { replace: true })
    },
    [hash, navigate, pathname, search]
  )

  const openProviderView = useCallback(
    (view: ProviderView) => openSubView('providers', 'pview', view, 'accounts'),
    [openSubView]
  )

  const openKeysView = useCallback((view: KeysView) => openSubView('keys', 'kview', view, 'tools'), [openSubView])

  const importInputRef = useRef<HTMLInputElement | null>(null)

  const exportConfig = async () => {
    try {
      const cfg = await getFulilianConfigRecord()
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'fulilian-config.json'
      a.click()
      URL.revokeObjectURL(url)
      triggerHaptic('success')
    } catch (err) {
      notifyError(err, t.settings.exportFailed)
    }
  }

  const resetConfig = async () => {
    const ok = await confirm({
      confirmLabel: t.settings.resetToDefaults,
      destructive: true,
      title: t.settings.resetConfirm
    })

    if (!ok) {
      return
    }

    try {
      await saveFulilianConfig(await getFulilianConfigDefaults())
      triggerHaptic('success')
      onConfigSaved?.()
    } catch (err) {
      notifyError(err, t.settings.resetFailed)
    }
  }

  const sectionById = useMemo(() => new Map(SECTIONS.map(section => [section.id, section])), [])

  // One label/icon resolution per nav view. `config:workspace` presents as the
  // Workbench "programming" entry (DESIGN_PROPOSAL §5.5) while reusing the
  // existing workspace page — a link, not a new page.
  const viewMeta = useCallback(
    (view: SettingsViewId): { icon: IconComponent; label: string } => {
      if (view.startsWith('config:')) {
        const section = sectionById.get(view.slice('config:'.length))

        if (!section) {
          return { icon: Settings2, label: view }
        }

        return {
          icon: section.icon,
          label:
            view === 'config:workspace'
              ? t.settings.group.programming
              : (t.settings.sections[section.id] ?? section.label)
        }
      }

      switch (view) {
        case 'about':
          return { icon: Info, label: t.settings.nav.about }
        case 'approvals':
          return { icon: CheckCircle2, label: t.security.approvals.nav }
        case 'audit':
          return { icon: Clock, label: t.security.audit.nav }
        case 'billing':
          return { icon: BarChart3, label: t.settings.nav.billing }
        case 'ctf':
          return { icon: Terminal, label: t.settings.group.ctf.nav }
        case 'evidence-protection':
          return { icon: FolderOpen, label: t.security.evidence.nav }
        case 'forensics':
          return { icon: FileText, label: t.settings.group.forensics.nav }
        case 'gateway':
          return { icon: Globe, label: t.settings.nav.gateway }
        case 'keybinds':
          return { icon: Keyboard, label: t.settings.nav.keybinds }
        case 'keys':
          return { icon: KeyRound, label: t.settings.nav.apiKeys }
        case 'notifications':
          return { icon: Bell, label: t.settings.nav.notifications }
        case 'pet':
          // Same string the page renders as its heading — a second key would
          // be exactly the drift the four-locale rule exists to avoid.
          return { icon: PawPrint, label: t.settings.appearance.pet.title }
        case 'plugins':
          return { icon: Package, label: t.settings.nav.plugins }
        case 'presets':
          return { icon: Layers3, label: t.presets.title }
        case 'providers':
          return { icon: Zap, label: t.settings.nav.providers }
        case 'quick-entry':
          return { icon: Zap, label: t.settings.quickEntry.enabledTitle }
        case 'sensitive-info':
          return { icon: EyeOff, label: t.security.sensitive.nav }
        case 'sessions':
          return { icon: Archive, label: t.settings.nav.archivedChats }
        default:
          return { icon: Settings2, label: view }
      }
    },
    [sectionById, t]
  )

  const navGroups = useMemo(
    () =>
      SETTINGS_GROUPS.map(group => ({
        id: group.id,
        items: group.views.map(view => {
          const meta = viewMeta(view)

          return {
            active: activeView === view,
            children:
              view === 'providers'
                ? [
                    {
                      active: activeView === 'providers' && providerView === 'accounts',
                      icon: codiconIcon('account'),
                      id: 'pview:accounts',
                      label: t.settings.nav.providerAccounts,
                      onSelect: () => openProviderView('accounts')
                    },
                    {
                      active: activeView === 'providers' && providerView === 'keys',
                      icon: KeyRound,
                      id: 'pview:keys',
                      label: t.settings.nav.providerApiKeys,
                      onSelect: () => openProviderView('keys')
                    },
                    {
                      active: activeView === 'providers' && providerView === 'custom-endpoints',
                      icon: Globe,
                      id: 'pview:custom-endpoints',
                      label: t.settings.nav.providerCustomEndpoints,
                      onSelect: () => openProviderView('custom-endpoints')
                    }
                  ]
                : view === 'keys'
                  ? [
                      {
                        active: activeView === 'keys' && keysView === 'tools',
                        icon: Settings2,
                        id: 'kview:tools',
                        label: t.settings.nav.keysTools,
                        onSelect: () => openKeysView('tools')
                      },
                      {
                        active: activeView === 'keys' && keysView === 'settings',
                        icon: Settings2,
                        id: 'kview:settings',
                        label: t.settings.nav.keysSettings,
                        onSelect: () => openKeysView('settings')
                      }
                    ]
                  : undefined,
            icon: meta.icon,
            id: view,
            label: meta.label,
            onSelect: () => setActiveView(view)
          }
        }),
        label: t.settings.group[group.id]
      })),
    [activeView, keysView, providerView, t, viewMeta, setActiveView, openProviderView, openKeysView]
  )

  // Type-to-search: printable keystrokes on the Settings surface (outside any
  // field) open the settings-scoped palette, seeded with the character — same
  // reflex as the chat surface's type-to-focus, pointed at search instead.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ($commandPaletteOpen.get() || isEditableTarget(event.target)) {
        return
      }

      const char = typeToFocusChar(event)

      if (char === null || char === ' ') {
        return
      }

      event.preventDefault()
      openCommandPalettePage('settings', char)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Fake search pill riding the card's top edge, dead-center and half off it.
  // Clicking (or just typing) opens the ⌘K palette scoped to settings; while
  // the palette is up the pill hands over to it — grows slightly and fades,
  // then fades back when the palette closes. It renders as chrome, not an
  // input — no border, recessed fill, live ⌘K hint.
  const searchCombo = bindingsFor('nav.commandPalette')[0]
  const paletteOpen = useStore($commandPaletteOpen)

  const searchPill = (
    <button
      className={cn(
        'flex h-(--titlebar-control-height) items-center gap-1.5 rounded-full border border-(--ui-stroke-secondary) bg-(--ui-chat-surface-background) px-2.5 text-(--ui-text-tertiary) shadow-sm transition-all duration-200 ease-out hover:text-foreground motion-reduce:transition-none',
        paletteOpen && 'pointer-events-none scale-110 opacity-0'
      )}
      onClick={() => {
        triggerHaptic('open')
        openCommandPalettePage('settings')
      }}
      tabIndex={paletteOpen ? -1 : undefined}
      type="button"
    >
      <Search className="size-3" />
      <span className="text-xs">{t.settings.search.pill}</span>
      {searchCombo && <KbdCombo combo={searchCombo} size="sm" variant="ghost" />}
    </button>
  )

  const navFooter = (
    <>
      <Tip label={t.settings.exportConfig}>
        <OverlayIconButton onClick={() => void exportConfig()}>
          <Download />
        </OverlayIconButton>
      </Tip>
      <Tip label={t.settings.importConfig}>
        <OverlayIconButton
          onClick={() => {
            triggerHaptic('open')
            importInputRef.current?.click()
          }}
        >
          <Upload />
        </OverlayIconButton>
      </Tip>
      <Tip label={t.settings.resetToDefaults}>
        <OverlayIconButton
          className="hover:text-destructive"
          onClick={() => {
            triggerHaptic('warning')
            void resetConfig()
          }}
        >
          <RefreshCw />
        </OverlayIconButton>
      </Tip>
    </>
  )

  const activeSettingsContent =
    activeView === 'config:appearance' ? (
      <AppearanceSettings />
    ) : activeView === 'about' ? (
      <AboutSettings />
    ) : activeView === 'presets' ? (
      <PresetsSettings />
    ) : activeView === 'gateway' || activeView === 'connections' ? (
      // 'connections' renders the unified page too so the frame before
      // the alias redirect lands doesn't flash the fallback view.
      <GatewaySettings />
    ) : activeView === 'keybinds' ? (
      <KeybindSettings />
    ) : activeView === 'forensics' ? (
      <ForensicsSettings />
    ) : activeView === 'ctf' ? (
      <CtfSettings />
    ) : activeView === 'approvals' ? (
      <ApprovalsPermissionsSettings />
    ) : activeView === 'evidence-protection' ? (
      <EvidenceProtectionSettings />
    ) : activeView === 'audit' ? (
      <AuditSettings />
    ) : activeView === 'sensitive-info' ? (
      <SensitiveInfoSettings />
    ) : activeView === 'pet' ? (
      <SettingsContent>
        <PetSettings />
      </SettingsContent>
    ) : activeView === 'quick-entry' ? (
      <SettingsContent>
        <QuickEntrySettings />
      </SettingsContent>
    ) : activeView.startsWith('config:') ? (
      <ConfigSettings
        activeSectionId={activeView.slice('config:'.length)}
        importInputRef={importInputRef}
        onConfigSaved={onConfigSaved}
        onMainModelChanged={onMainModelChanged}
      />
    ) : activeView === 'providers' ? (
      <ProvidersSettings
        onClose={onClose}
        onConfigSaved={onConfigSaved}
        onMainModelChanged={onMainModelChanged}
        onViewChange={setProviderView}
        view={providerView}
      />
    ) : activeView === 'keys' ? (
      <KeysSettings view={keysView} />
    ) : activeView === 'notifications' ? (
      <NotificationsSettings />
    ) : activeView === 'billing' ? (
      <BillingSettings />
    ) : activeView === 'plugins' ? (
      <PluginsSettings />
    ) : (
      <SessionsSettings />
    )

  return (
    <OverlayView closeLabel={t.settings.closeSettings} edgeBadge={searchPill} onClose={onClose}>
      <OverlaySplitLayout>
        {/* Wide rail: the six Workbench groups with header rows (§5.5).
            Rendered here rather than via the shared OverlayNav because the
            group headers are settings-specific — rows still go through the
            shared OverlayNavItem so tour handles keep working. */}
        <OverlaySidebar className="max-[47.5rem]:hidden">
          {navGroups.map(group => (
            <Fragment key={group.id}>
              <div
                aria-hidden
                className="px-2 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-wider text-(--ui-text-tertiary)"
              >
                {group.label}
              </div>
              {group.items.map(item => (
                <Fragment key={item.id}>
                  <OverlayNavItem
                    active={item.active}
                    icon={item.icon}
                    id={item.id}
                    label={item.label}
                    onClick={item.onSelect}
                  />
                  {item.children && item.active && (
                    <div className="ml-3.5 flex flex-col gap-0.5 pl-1.5">
                      {item.children.map(child => (
                        <OverlayNavItem
                          active={child.active}
                          icon={child.icon}
                          id={child.id}
                          key={child.id}
                          label={child.label}
                          nested
                          onClick={child.onSelect}
                        />
                      ))}
                    </div>
                  )}
                </Fragment>
              ))}
            </Fragment>
          ))}
          <div className="mt-auto flex items-center gap-1 pt-2">{navFooter}</div>
        </OverlaySidebar>

        {/* Narrow: the same groups flattened into the titlebar dropdown, with
            one separator at each group break — mirrors OverlayNav's narrow
            degradation for the split layout. */}
        <div
          className={cn(
            'pointer-events-none relative z-20 h-[calc(var(--titlebar-height)+0.1875rem)] items-center justify-between gap-2 pl-3 pr-12',
            'hidden max-[47.5rem]:flex'
          )}
        >
          <div className="pointer-events-auto min-w-0 [-webkit-app-region:no-drag]">
            <TabDropdown
              align="start"
              items={navGroups.flatMap((group, groupIndex) => [
                ...group.items.map(item => ({
                  active: item.active && !item.children?.some(child => child.active),
                  icon: item.icon,
                  id: item.id,
                  label: item.label,
                  onSelect: item.onSelect,
                  separatorBefore: groupIndex > 0 && group.items[0] === item
                })),
                ...(group.items ?? []).flatMap(item =>
                  (item.children ?? []).map(child => ({
                    active: child.active,
                    icon: child.icon,
                    id: child.id,
                    indent: true,
                    label: child.label,
                    onSelect: child.onSelect
                  }))
                )
              ])}
            />
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
            {navFooter}
          </div>
        </div>

        <OverlayMain className="px-0 pb-0">{activeSettingsContent}</OverlayMain>
      </OverlaySplitLayout>
    </OverlayView>
  )
}

export { SettingsView as SettingsPage }
