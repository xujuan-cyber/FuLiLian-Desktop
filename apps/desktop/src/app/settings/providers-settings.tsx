import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { runInTerminal } from '@/app/right-sidebar/store'
import {
  FEATURED_ID,
  FeaturedProviderRow,
  FireworksProviderRow,
  OpenRouterProviderRow,
  ProviderRow,
  providerTitle,
  sortProviders
} from '@/components/onboarding'
import { Button } from '@/components/ui/button'
import { RowButton } from '@/components/ui/row-button'
import { SearchField } from '@/components/ui/search-field'
import { Skeleton } from '@/components/ui/skeleton'
import { disconnectOAuthProvider, listOAuthProviders } from '@/fulilian'
import { useI18n } from '@/i18n'
import { Check, ChevronDown, ChevronRight, KeyRound, Loader2, Terminal, Trash2 } from '@/lib/icons'
import { normalize } from '@/lib/text'
import { cn } from '@/lib/utils'
import { confirm } from '@/store/confirm'
import { notify, notifyError } from '@/store/notifications'
import { $desktopOnboarding, startManualLocalEndpoint, startManualProviderOAuth } from '@/store/onboarding'
import type { EnvVarInfo, OAuthProvider } from '@/types/fulilian'

import { isKeyVar, ProviderKeyRows } from './credential-key-ui'
import { CustomEndpointsSettings } from './custom-endpoints-settings'
import { SettingsCategoryHeading, useEnvCredentials } from './env-credentials'
import { providerGroup, providerMeta, providerPriority } from './helpers'
import { SettingsContent } from './primitives'

// The embedded terminal (and thus the "run disconnect command" path) only
// exists in the Electron desktop shell, not the web dashboard.
const canRunInTerminal = () => typeof window !== 'undefined' && Boolean(window.fulilianDesktop?.terminal)

// Parallel group headers ("Connected", "Other providers") so the expanded list
// reads as its own section instead of bleeding into the connected group.
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 px-0.5 text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-tertiary)">
      {children}
    </p>
  )
}

// Sub-views surfaced as a sidebar subnav: account sign-in vs raw API keys.
export const PROVIDER_VIEWS = ['accounts', 'keys', 'custom-endpoints'] as const

export type ProviderView = (typeof PROVIDER_VIEWS)[number]

// Group the env catalog by provider — one ListRow per vendor plus optional
// advanced overrides (base URL, region, etc.). Groups without a key field are
// skipped.
//
// Grouping key precedence:
//   1. Backend `provider_label` / `provider` (from the unified provider catalog
//      in fulilian_cli/provider_catalog.py) — the SAME provider identity
//      `fulilian model` uses. This is authoritative: a provider tagged by the
//      backend always renders a card, even with no PROVIDER_GROUPS row.
//   2. Desktop prefix match (`providerGroup`) — legacy fallback for provider
//      env vars that predate the backend tagging.
// Only entries that resolve to neither (the "Other" bucket) are skipped.
function buildProviderKeyGroups(vars: Record<string, EnvVarInfo>): ProviderKeyGroup[] {
  const buckets = new Map<string, [string, EnvVarInfo][]>()

  for (const [key, info] of Object.entries(vars)) {
    if (info.category !== 'provider') {
      continue
    }

    // Prefer the backend-supplied provider label/id so the Keys tab groups by
    // the same identity the CLI picker uses; fall back to the prefix guess.
    const name = info.provider_label?.trim() || info.provider?.trim() || providerGroup(key)

    if (name === 'Other') {
      continue
    }

    buckets.set(name, [...(buckets.get(name) ?? []), [key, info]])
  }

  const groups: ProviderKeyGroup[] = []

  for (const [name, entries] of buckets) {
    const primary = entries.find(([k, i]) => !i.advanced && isKeyVar(k, i)) ?? entries.find(([k, i]) => isKeyVar(k, i))

    if (!primary) {
      continue
    }

    // Presentation overlay (priority, blurb, docs) is keyed by the prefix-based
    // group name; when the backend introduced this provider it may have no
    // overlay entry, so fall back to the backend/env metadata for display.
    const meta = providerMeta(name)

    groups.push({
      // Advanced = the provider's non-key knobs (base URL, region, deployment).
      // Skip redundant alias key vars (e.g. ANTHROPIC_TOKEN vs ANTHROPIC_API_KEY)
      // so we never render a second "Paste key" input — unless one is already
      // set, in which case keep it visible so it stays clearable.
      advanced: entries
        .filter(([k, i]) => k !== primary[0] && (!isKeyVar(k, i) || i.is_set))
        .sort(([a], [b]) => a.localeCompare(b)),
      description: meta?.description ?? primary[1].description,
      docsUrl: meta?.docsUrl ?? primary[1].url ?? undefined,
      hasAnySet: entries.some(([, i]) => i.is_set),
      name,
      primary,
      priority: providerPriority(name)
    })
  }

  return groups.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}

// Deliberately a near-1:1 replica of the first-run onboarding picker
// (`Picker` in desktop-onboarding-overlay): same recommended card, same
// Fireworks #2 quick-key row, same provider rows, same "Other providers"
// disclosure, same OpenRouter quick-key row, and the same bottom-right
// "I have an API key" affordance. The leaf cards are the exact shared
// components, so the two surfaces stay visually identical. Selecting a
// provider hands off to the shared onboarding overlay, which runs that
// provider's real sign-in flow; the key affordances open the API-key
// catalog below.
function OAuthPicker({
  disconnecting,
  onDisconnect,
  onTerminalDisconnect,
  onWantApiKey,
  providers
}: {
  disconnecting: null | string
  onDisconnect: (provider: OAuthProvider) => void
  onTerminalDisconnect: (provider: OAuthProvider) => void
  onWantApiKey: () => void
  providers: OAuthProvider[]
}) {
  const { t } = useI18n()
  const p = t.settings.providers
  const [showAll, setShowAll] = useState(false)
  const ordered = useMemo(() => sortProviders(providers), [providers])

  if (ordered.length === 0) {
    return null
  }

  const select = (p: OAuthProvider) => startManualProviderOAuth(p.id)

  const featured = ordered.find(p => p.id === FEATURED_ID && !p.status?.logged_in) ?? null
  const rest = featured ? ordered.filter(p => p.id !== FEATURED_ID) : ordered
  // Keep connected accounts grouped and always visible; only the unconnected
  // providers hide behind the disclosure, so the page leads with what's set up.
  // Both lists preserve `sortProviders` order (curated priority, then name).
  const connected = rest.filter(p => p.status?.logged_in)
  const others = rest.filter(p => !p.status?.logged_in)
  const collapsible = others.length > 0
  const showOthers = !collapsible || showAll

  return (
    <section className="mb-5 grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <SettingsCategoryHeading icon={KeyRound} title={p.connectAccount} />
        <Button
          className="text-[length:var(--conversation-caption-font-size)]"
          onClick={onWantApiKey}
          size="inline"
          type="button"
          variant="textStrong"
        >
          {p.haveApiKey}
        </Button>
      </div>
      <p className="-mt-2 mb-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {p.intro}
      </p>
      {featured && <FeaturedProviderRow onSelect={select} provider={featured} />}
      {/* Slot #2 — always visible, matching onboarding / CANONICAL_PROVIDERS. */}
      <FireworksProviderRow onClick={onWantApiKey} />
      {connected.length > 0 && (
        <>
          <GroupLabel>{p.connected}</GroupLabel>
          {connected.map(p => (
            <ConnectedProviderRow
              disconnecting={disconnecting === p.id}
              key={p.id}
              onDisconnect={onDisconnect}
              onSelect={select}
              onTerminalDisconnect={onTerminalDisconnect}
              provider={p}
            />
          ))}
        </>
      )}
      {showOthers && (
        <>
          {connected.length > 0 && <GroupLabel>{p.otherProviders}</GroupLabel>}
          {others.map(p => (
            <ProviderRow key={p.id} onSelect={select} provider={p} />
          ))}
          <OpenRouterProviderRow onClick={onWantApiKey} />
        </>
      )}
      {collapsible && (
        <Button
          className="py-1 text-[length:var(--conversation-caption-font-size)]"
          onClick={() => setShowAll(v => !v)}
          size="inline"
          type="button"
          variant="text"
        >
          {showAll ? p.collapse : connected.length > 0 ? p.connectAnother : p.otherProviders}
          <ChevronDown className={cn('size-3.5 transition', showAll && 'rotate-180')} />
        </Button>
      )}
    </section>
  )
}

function ConnectedProviderRow({
  disconnecting,
  onDisconnect,
  onSelect,
  onTerminalDisconnect,
  provider
}: {
  disconnecting: boolean
  onDisconnect: (provider: OAuthProvider) => void
  onSelect: (provider: OAuthProvider) => void
  onTerminalDisconnect: (provider: OAuthProvider) => void
  provider: OAuthProvider
}) {
  const { t } = useI18n()
  const copy = t.settings.providers
  const title = providerTitle(provider)
  const Trail = provider.flow === 'external' ? Terminal : ChevronRight
  // Fulilian can clear this provider's creds via the API.
  const canDisconnect = provider.disconnectable ?? provider.flow !== 'external'
  // External (CLI-managed) provider Fulilian can't clear via the API, but ships a
  // command we can run in the embedded terminal (Electron shell only).
  const terminalDisconnect = !canDisconnect && Boolean(provider.disconnect_command) && canRunInTerminal()
  // Only fall back to a static "remove it elsewhere" hint when we offer no button.
  const showHint = !canDisconnect && !terminalDisconnect

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-[6px] transition-colors hover:bg-(--ui-control-hover-background)">
      <RowButton className="min-w-0 px-3 py-2.5 text-left" onClick={() => onSelect(provider)}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[length:var(--conversation-text-font-size)] font-semibold">{title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Check className="size-3" />
            {copy.connected}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.onboarding.flowSubtitles[provider.flow]}</p>
        {showHint && (
          <p className="mt-0.5 truncate text-[0.68rem] leading-5 text-muted-foreground/70">
            {provider.flow === 'external' ? copy.removeExternalGeneric(title) : copy.removeKeyManaged(title)}
          </p>
        )}
      </RowButton>
      <div className="flex items-center gap-1 pr-2">
        <Trail className="size-4 text-muted-foreground transition group-hover:text-foreground" />
        {canDisconnect && (
          <Button
            aria-label={`${t.common.remove} ${title}`}
            disabled={disconnecting}
            onClick={() => onDisconnect(provider)}
            size="icon-xs"
            title={`${t.common.remove} ${title}`}
            type="button"
            variant="ghost"
          >
            {disconnecting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
          </Button>
        )}
        {terminalDisconnect && (
          <Button
            aria-label={`${copy.disconnect} ${title}`}
            onClick={() => onTerminalDisconnect(provider)}
            size="icon-xs"
            title={copy.disconnectInTerminal}
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

function NoProviderKeys() {
  const { t } = useI18n()

  return (
    <div className="grid min-h-32 place-items-center px-4 py-8 text-center text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
      {t.settings.providers.noProviderKeys}
    </div>
  )
}

// Surfaces the "Local / custom endpoint" entry point directly in the API-keys
// tab so users can add any OpenAI-compatible endpoint (Zyphra, vLLM, Ollama…)
// from the GUI. The composer pill and the providers "have an API key" affordance
// both dead-end on the env-var-driven key catalog, which never lists a custom
// endpoint — so without this row there is no reachable Desktop path to it.
// The whole row is the button so the click target and a11y focus match the
// visible area (the chevron + gutter are inside the button, not beside it).
// Pass reason: null — the onboarding overlay renders an unmapped reason string
// verbatim as a banner (see ReasonNotice in onboarding/index.tsx), and we don't
// want a raw identifier like "providers-keys-tab" showing as literal text.
function LocalEndpointRow({ onOpen }: { onOpen: (reason: null | string) => void }) {
  const { t } = useI18n()
  const copy = t.settings.providers.localEndpoint

  return (
    <RowButton
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-[6px] px-3 py-2.5 text-left transition-colors hover:bg-(--ui-control-hover-background)"
      onClick={() => onOpen(null)}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[length:var(--conversation-text-font-size)] font-semibold">{copy.title}</span>
        <span className="truncate text-[length:var(--conversation-caption-font-size)] leading-5 text-muted-foreground">
          {copy.description}
        </span>
      </div>
      <ChevronRight className="size-4 text-muted-foreground transition group-hover:text-foreground" />
    </RowButton>
  )
}

// Loading mirrors of the two real Providers shapes (step 17 P18). The real
// render branches into the accounts picker or the keys catalog, so the loading
// page branches the same way: each skeleton reuses the real containers
// (rounded row cards, p-3 key cards, the gap rhythm) instead of a generic
// heading+rows run that the swap would replace wholesale. Textless by
// contract — bars only, like the overlay-level SettingsSkeleton.

// Mirrors OAuthPicker (below): heading row + intro + featured card + provider
// row cards + collapse affordance, all inside section.mb-5.grid.gap-2.
function AccountsSkeleton() {
  return (
    <SettingsContent>
      <section className="mb-5 grid gap-2" data-testid="providers-skeleton">
        {/* SettingsCategoryHeading + the trailing "I have an API key" affordance. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <div className="mb-3 flex items-center gap-2">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-36 max-w-full" />
          </div>
          <Skeleton className="h-4 w-28" />
        </div>
        {/* intro paragraph (-mt-2 mb-1, one caption line). */}
        <Skeleton className="-mt-2 mb-1 h-3 w-2/3 max-w-full" />
        {/* FeaturedProviderRow: arc card, icon + title, one-line pitch. */}
        <div className="rounded-[8px] bg-primary/[0.06] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Skeleton className="size-5 shrink-0 rounded" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <Skeleton className="mt-2 h-3 w-3/4 max-w-full" />
        </div>
        {/* FireworksProviderRow / ProviderRow / OpenRouterProviderRow cards. */}
        {Array.from({ length: 4 }, (_, row) => (
          <div className="rounded-[6px] px-3 py-2.5" key={row}>
            <Skeleton className="h-3.5 w-28 max-w-full" />
            <Skeleton className="mt-2 h-3 w-1/2 max-w-full" />
          </div>
        ))}
        {/* Collapse / "connect another" affordance. */}
        <Skeleton className="h-4 w-24" />
      </section>
    </SettingsContent>
  )
}

// Mirrors the keys render (below): LocalEndpointRow over the search field and
// the ProviderKeyRows card stack, same wrappers and grid gaps.
function KeysSkeleton() {
  return (
    <SettingsContent>
      <div data-testid="providers-skeleton">
        {/* LocalEndpointRow: full-row button, two-line label + trailing chevron. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-[6px] px-3 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Skeleton className="h-3.5 w-44 max-w-full" />
            <Skeleton className="h-3 w-2/3 max-w-full" />
          </div>
          <Skeleton className="size-4" />
        </div>
        <div className="grid gap-3">
          {/* SearchField: icon + underline input. */}
          <div className="flex items-center gap-1.5 px-0.5">
            <Skeleton className="size-3.5 shrink-0" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
          {/* ProviderKeyRows cards: p-3 card, h-8 label row, h-8 control column. */}
          <div className="grid gap-2">
            {Array.from({ length: 4 }, (_, card) => (
              <div
                className="grid grid-cols-1 items-start gap-x-3 gap-y-1.5 rounded-[6px] p-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)] @2xl:gap-y-3"
                key={card}
              >
                <div className="flex h-8 min-w-0 items-center gap-2">
                  <Skeleton className="size-2 shrink-0 rounded-full" />
                  <Skeleton className="h-3.5 w-32 max-w-full" />
                </div>
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SettingsContent>
  )
}

export function ProvidersSettings({
  onClose,
  onConfigSaved,
  onMainModelChanged,
  onViewChange,
  view
}: ProvidersSettingsProps) {
  const { t } = useI18n()
  const { rowProps, vars } = useEnvCredentials()
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([])
  const [openProvider, setOpenProvider] = useState<null | string>(null)
  const [disconnecting, setDisconnecting] = useState<null | string>(null)
  // Free-text filter for the API-keys view (provider name / env-var key / desc).
  const [keyQuery, setKeyQuery] = useState('')
  // The onboarding overlay owns the OAuth flow. Watch its `manual` flag so we
  // re-read connection state when the user finishes (or dismisses) a sign-in
  // they launched from this page — otherwise the cards keep their stale status.
  const onboardingActive = useStore($desktopOnboarding).manual

  const refreshOAuthProviders = useCallback(async () => {
    // OAuth providers are best-effort — a failure here just hides the panel.
    const { providers } = await listOAuthProviders()
    setOauthProviders(providers)
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      if (onboardingActive) {
        return
      }

      try {
        const { providers } = await listOAuthProviders()

        if (!cancelled) {
          setOauthProviders(providers)
        }
      } catch {
        // Ignore — the OAuth panel just won't render.
      }
    })()

    return () => void (cancelled = true)
  }, [onboardingActive])

  // External (CLI-managed) providers can't be cleared via the API by design —
  // Fulilian never deletes creds another tool owns behind a silent API call.
  // Instead we run the documented removal command in the embedded terminal so
  // the user sees exactly what executes, then return them to chat to watch it.
  async function handleTerminalDisconnect(provider: OAuthProvider) {
    const command = provider.disconnect_command

    if (!command) {
      return
    }

    const name = providerTitle(provider)

    const ok = await confirm({
      confirmLabel: t.settings.providers.disconnect,
      destructive: true,
      title: t.settings.providers.removeTerminalConfirm(name, command)
    })

    if (!ok) {
      return
    }

    // Leave the settings overlay so the terminal pane (chat-only) is visible.
    onClose()
    runInTerminal(command)
    notify({
      kind: 'info',
      title: t.settings.providers.removedTitle,
      message: t.settings.providers.removeTerminalRunning(name)
    })
  }

  async function handleDisconnect(provider: OAuthProvider) {
    const name = providerTitle(provider)

    const ok = await confirm({
      confirmLabel: t.settings.providers.disconnect,
      destructive: true,
      title: t.settings.providers.removeConfirm(name)
    })

    if (!ok) {
      return
    }

    setDisconnecting(provider.id)

    try {
      await disconnectOAuthProvider(provider.id)
      notify({
        durationMs: 3_000,
        kind: 'success',
        title: t.settings.providers.removedTitle,
        message: t.settings.providers.removedMessage(name)
      })
      await refreshOAuthProviders().catch(() => undefined)
    } catch (err) {
      notifyError(err, t.settings.providers.failedRemove(name))
    } finally {
      setDisconnecting(null)
    }
  }

  if (view === 'custom-endpoints') {
    // Above the `!vars` gate: this view owns its env-vars fetch and its own
    // loading skeleton, so the outer gate must not swallow it.
    return <CustomEndpointsSettings onConfigSaved={onConfigSaved} onMainModelChanged={onMainModelChanged} />
  }

  if (!vars) {
    // The real render branches on `hasOauth` (accounts picker vs keys catalog —
    // `showApiKeys` below), so the loading shape must branch the same way or
    // the swap replaces the whole pane instead of filling it in (step 17 P18).
    return oauthProviders.length > 0 ? <AccountsSkeleton /> : <KeysSkeleton />
  }

  const hasOauth = oauthProviders.length > 0
  // The sidebar subnav owns the Accounts/API-keys split now; with no OAuth
  // providers there's nothing for the "Accounts" view to show, so fall to keys.
  // (custom-endpoints already returned above, so it's off the type here — the
  // P18 view-branch reorder is what makes the old `view !== 'custom-endpoints'`
  // guard here a dead comparison.)
  const showApiKeys = view === 'keys' || !hasOauth

  const keyGroups = buildProviderKeyGroups(vars)

  if (showApiKeys) {
    const q = normalize(keyQuery)

    const visibleGroups = q
      ? keyGroups.filter(group => {
          const haystack = [group.name, group.description ?? '', group.primary[0], ...group.advanced.map(([k]) => k)]

          return haystack.some(s => s.toLowerCase().includes(q))
        })
      : keyGroups

    return (
      <SettingsContent>
        <LocalEndpointRow onOpen={startManualLocalEndpoint} />
        {keyGroups.length > 0 ? (
          <div className="grid gap-3">
            <SearchField
              aria-label={t.settings.providers.searchKeys}
              containerClassName="w-full"
              onChange={setKeyQuery}
              placeholder={t.settings.providers.searchKeys}
              value={keyQuery}
            />
            {visibleGroups.length > 0 ? (
              <div className="grid gap-2">
                {visibleGroups.map(group => (
                  <ProviderKeyRows
                    expanded={openProvider === group.name}
                    group={group}
                    key={group.name}
                    onExpand={() => setOpenProvider(group.name)}
                    onToggle={() => setOpenProvider(prev => (prev === group.name ? null : group.name))}
                    rowProps={rowProps}
                  />
                ))}
              </div>
            ) : (
              <div className="grid min-h-24 place-items-center px-4 py-6 text-center text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
                {t.settings.providers.noKeysMatch}
              </div>
            )}
          </div>
        ) : (
          <NoProviderKeys />
        )}
      </SettingsContent>
    )
  }

  return (
    <SettingsContent>
      <OAuthPicker
        disconnecting={disconnecting}
        onDisconnect={provider => void handleDisconnect(provider)}
        onTerminalDisconnect={provider => void handleTerminalDisconnect(provider)}
        onWantApiKey={() => onViewChange('keys')}
        providers={oauthProviders}
      />
    </SettingsContent>
  )
}

interface ProviderKeyGroup {
  advanced: [string, EnvVarInfo][]
  description?: string
  docsUrl?: string
  hasAnySet: boolean
  name: string
  primary: [string, EnvVarInfo]
  priority: number
}

interface ProvidersSettingsProps {
  onClose: () => void
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
  onViewChange: (view: ProviderView) => void
  view: ProviderView
}
