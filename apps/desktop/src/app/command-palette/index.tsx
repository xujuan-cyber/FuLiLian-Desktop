import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'

import {
  HUD_HEADING,
  HUD_ITEM,
  HUD_NOTE,
  HUD_NOTE_VARIANT,
  HUD_POSITION,
  HUD_SURFACE,
  HUD_TEXT
} from '@/app/floating-hud'
import { codiconIcon } from '@/components/ui/codicon'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { HighlightMatches } from '@/components/ui/highlight-matches'
import { KbdCombo, KbdGroup } from '@/components/ui/kbd'
import { searchSessions } from '@/api/sessions'
import { getFulilianConfigRecord, listAllProfileSessions } from '@/fulilian'
import { useMediaQuery } from '@/hooks/use-media-query'
import { type Translations, useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import {
  Activity,
  AppWindow,
  Archive,
  BarChart3,
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Clipboard,
  Download,
  Egg,
  FileText,
  GitBranch,
  Globe,
  type IconComponent,
  Info,
  KeyRound,
  Layers3,
  MessageCircle,
  Monitor,
  Moon,
  Package,
  Palette,
  PawPrint,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Settings2,
  SlidersHorizontal,
  Starmap,
  Sun,
  Terminal,
  Users,
  Wrench,
  Zap
} from '@/lib/icons'
import { normalize } from '@/lib/text'
import { coarseElapsed } from '@/lib/time'
import { cn } from '@/lib/utils'
import { resolveVersionStatus } from '@/lib/version-status'
import { $repoWorktrees } from '@/store/coding-status'
import {
  $commandPaletteOpen,
  $commandPalettePage,
  $commandPaletteSeed,
  closeCommandPalette,
  setCommandPaletteOpen
} from '@/store/command-palette'
import { startNewSessionWithKind, type PaletteSessionKind } from '@/store/command-palette-kind'
import { $bindings, bindingsFor } from '@/store/keybinds'
import { $dismissedAutoProjectIds, filterVisibleProjects } from '@/store/layout'
import { openPetGenerate } from '@/store/pet-generate'
import { openBrowserTab } from '@/store/preview'
import { $projectTree, goToProject, openFolderAsProject, requestStartWorkSession } from '@/store/projects'
import { $connection } from '@/store/session'
import { openSessionChanges } from '@/store/session-changes'
import { runGatewayRestart } from '@/store/system-actions'
import {
  $backendUpdateApply,
  $backendUpdateStatus,
  $desktopVersion,
  $updateApply,
  $updateStatus,
  requestActiveUpdate
} from '@/store/updates'
import { canOpenNewWindow, openNewWindow } from '@/store/windows'
import { luminance } from '@/themes/color'
import { type ThemeMode, useTheme } from '@/themes/context'
import { isUserTheme, resolveTheme } from '@/themes/user-themes'
import type { SessionInfo, SessionSearchResult } from '@/types/fulilian'

import { openSession, openSessionIntentFromModifiers } from '../open-session'
import {
  AGENTS_ROUTE,
  ARTIFACTS_ROUTE,
  CASES_ROUTE,
  COMMAND_CENTER_ROUTE,
  CRON_ROUTE,
  MESSAGING_ROUTE,
  navigateToWorkspacePage,
  NEW_CHAT_ROUTE,
  PROFILES_ROUTE,
  SETTINGS_ROUTE,
  SKILLS_ROUTE,
  STARMAP_ROUTE,
  WEBHOOKS_ROUTE
} from '../routes'
import { SECTIONS } from '../settings/constants'
import { type SettingsSearchEntry, settingsSearchTargetQuery } from '../settings/settings-search'
import { useSettingsSearchCatalog } from '../settings/use-settings-search'

import { usePaletteContributions } from './contrib'
import { HighlightWatcher } from './highlight-watcher'
import { MarketplaceThemePage } from './marketplace-theme-page'
import { PetInlineToggle, PetPalettePage } from './pet-palette-page'
import { runSecurityAuditFromPalette } from './security-audit-action'
import { SessionKindBadge, sessionBadgeKind, sessionLeadNode } from './session-marks'
import { StatusRow } from './status-row'

// Exported for the zone/keyboard fixture tests (hub-groups.test.tsx) — the
// assertions run against the REAL row/group shapes, not mocks of them.
export interface PaletteItem {
  /** Keybind action id — its live combo renders as a hotkey hint. */
  action?: string
  /** Renders a trailing check: this row IS the current setting (theme, mode). */
  active?: boolean
  /** §4.3 mode badge after the label — forensics/CTF kind markers only (the
   *  T8 会话 zone; `sessionBadgeKind` keeps project rows unmarked). */
  badge?: 'ctf' | 'forensics'
  /** Static trailing combo hint for a modifier-variant select (e.g. `mod+enter`). */
  comboHint?: string
  /** Short note beside the label — state the row acts on (a version, a count). */
  detail?: string
  /** `state` when the row will change what `detail` says (a toggle's on/off). */
  detailVariant?: keyof typeof HUD_NOTE_VARIANT
  /** Non-interactive row: arrows skip it and select does nothing. The honest
   *  "coming soon" affordance (no current user — the /cases placeholder it
   *  once hosted is a real link since T14). */
  disabled?: boolean
  icon: IconComponent
  id: string
  /** Keep the palette open after running (live-preview pickers like theme/mode). */
  keepOpen?: boolean
  keywords?: string[]
  label: string
  /** Row-leading node (the T8 会话 zone's SessionStatusDot); replaces `icon`. */
  lead?: ReactNode
  /** Label shown while ⌘/⌃ is held — previews the modifier-variant action. */
  modLabel?: string
  /**
   * Runs when the row becomes the cmdk highlight (arrow keys or hover). When
   * a row has no onHighlight, a highlight on it clears the live preview.
   */
  onHighlight?: () => void
  /**
   * When set, ⌘/⌃-select (or ⌘-Enter) opens a new tab and ⇧⌘-select pops a
   * window — matching sidebar session rows. Plain select stays in-place.
   * Receives the last selector event so the modifiers can be read.
   */
  runWithEvent?: (event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void
  /** Action to run when selected. Mutually exclusive with `to`. */
  run?: () => void
  /** Open a nested palette page (VS Code-style "choose X → options"). */
  to?: string
}

export interface PaletteGroup {
  /** Optional: a headingless group renders as a bare action row (e.g. the
   *  "Install theme…" entry pinned atop the theme picker). */
  heading?: string
  items: PaletteItem[]
}

// Nested page → its parent, so Back / Esc step up one level instead of closing
// the palette. Pages absent here go straight back to the root list.
const PAGE_PARENTS: Record<string, string> = { 'install-theme': 'theme' }

/** A nested page reachable from a root item via `to`. */
interface PalettePage {
  groups: PaletteGroup[]
  placeholder: string
  title: string
}

interface SessionEntry {
  git_branch?: null | string
  id: string
  preview?: string
  title: string
}

// Ranking happens in React, not cmdk. We score, sort, and prune the groups
// ourselves and hand cmdk an already-ordered list with `shouldFilter={false}`,
// leaving it as pure keyboard/selection machinery. (cmdk's own group
// re-sorting silently no-ops: its sort() queries groups by an internal id that
// never matches the heading text it writes into `data-value`, so groups always
// keep source order — which put a generic keyword match like "Capabilities" on
// top and the auto-highlight on it while an exact "Tools" row sat below.)
//
// cmdk still auto-selects the first DOM item whenever the search changes, so
// rendering best-match-first is what puts the highlight on the best match.
//
// AND semantics: every typed word must appear in the label or keywords. The
// grade rewards matches on the visible label — exact > prefix > whole word >
// word prefix > substring > scattered terms > keyword-only — so typing "tools"
// selects the row that says Tools, not a row that hides it in keywords.
const scoreItem = (item: PaletteItem, needle: string): number => {
  const label = item.label.toLowerCase()
  const keys = (item.keywords ?? []).join(' ').toLowerCase()
  const terms = needle.split(/\s+/).filter(Boolean)

  if (terms.some(term => !label.includes(term) && !keys.includes(term))) {
    return 0
  }

  if (label === needle) {
    return 1
  }

  if (label.startsWith(needle)) {
    return 0.9
  }

  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

  if (words.includes(needle)) {
    return 0.85
  }

  if (words.some(word => word.startsWith(needle))) {
    return 0.8
  }

  if (label.includes(needle)) {
    return 0.7
  }

  if (terms.every(term => label.includes(term))) {
    return 0.6
  }

  // Matched only via keywords — the weakest, generic-row signal.
  return 0.4
}

// Order items within each group by score, order groups by their best item, and
// drop everything that doesn't match. Ties keep their original order (stable
// sort), so curated group/item ordering still breaks even scores.
export const rankGroups = (groups: PaletteGroup[], search: string): PaletteGroup[] => {
  const needle = normalize(search)

  if (!needle) {
    return groups
  }

  return groups
    .map(group => {
      const scored = group.items
        .map(item => ({ item, score: scoreItem(item, needle) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)

      return { group: { ...group, items: scored.map(entry => entry.item) }, max: scored[0]?.score ?? 0 }
    })
    .filter(entry => entry.max > 0)
    .sort((a, b) => b.max - a.max)
    .map(entry => entry.group)
}

// cmdk selection values must be unique; labels alone can repeat (a settings
// field and a session can share a title). The id suffix disambiguates.
const paletteValue = (item: PaletteItem): string => `${item.label}\u0001${item.id}`

const EMPTY_GROUPS: PaletteGroup[] = []

// Backstop only. The palette normally retires on the content's real
// `animationend`, so the CSS owns the close duration; this just guarantees the
// body can't stay mounted forever somewhere animations never run (jsdom,
// `animation: none`). Deliberately longer than any plausible exit so it never
// races the real signal and truncates the fade.
const EXIT_FALLBACK_MS = 1000

/**
 * The palette's row list, split out so an OPENING palette paints before it
 * renders rows. This component mounts with the portal, so `useDeferredValue`'s
 * initial value applies per open: the first commit is the frame + input
 * (instant), and the several-hundred-row list arrives in an interruptible
 * follow-up render. Opening ⌘K must never wait on building the list.
 */
const PaletteGroups = memo(function PaletteGroups({
  bindings,
  groups,
  modHeld,
  noResultsLabel,
  onSelectItem,
  onSelectMods,
  search
}: {
  bindings: Record<string, string[]>
  groups: PaletteGroup[]
  modHeld: boolean
  noResultsLabel: string
  onSelectItem: (item: PaletteItem) => void
  onSelectMods: (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void
  search: string
}) {
  const deferred = useDeferredValue(groups, EMPTY_GROUPS)
  // While the rows are still catching up, an empty list means "not rendered
  // yet", not "nothing matched" — don't flash the empty state on open.
  const pending = deferred !== groups

  return (
    <>
      {/* Filtering happens in rankGroups, so cmdk's own CommandEmpty
          (keyed to its internal filter count) would never fire. */}
      {deferred.length === 0 && !pending && <StatusRow text={noResultsLabel} />}
      {deferred.map((group, index) => (
        <CommandGroup className={HUD_HEADING} heading={group.heading} key={group.heading ?? `palette-group-${index}`}>
          {group.items.map(item => (
            <PaletteRow
              bindings={bindings}
              item={item}
              key={item.id}
              modHeld={modHeld}
              onSelectItem={onSelectItem}
              onSelectMods={onSelectMods}
              search={search}
            />
          ))}
        </CommandGroup>
      ))}
    </>
  )
})

const PaletteRow = memo(function PaletteRow({
  bindings,
  item,
  modHeld,
  onSelectMods,
  onSelectItem,
  search
}: {
  bindings: Record<string, string[]>
  item: PaletteItem
  modHeld: boolean
  onSelectMods: (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void
  onSelectItem: (item: PaletteItem) => void
  search: string
}) {
  const Icon = item.icon
  // The row's live keybind, else a static modifier-variant hint (⌘↵). One slot,
  // so every downstream `ml-auto` fallback below keeps working unchanged.
  // `bindingsFor`, not a raw lookup: a plugin's action is contributed after
  // $bindings was seeded, so its combo only resolves through the fallback chain.
  const combo = (item.action ? bindingsFor(item.action, bindings)[0] : undefined) ?? item.comboHint
  // While ⌘/⌃ is held, a row with a modifier variant previews it: the label
  // swaps to the variant's copy so Enter reads as what it will actually do.
  const modPreview = modHeld && Boolean(item.modLabel)

  return (
    <CommandItem
      className={cn(HUD_ITEM, HUD_TEXT)}
      disabled={item.disabled}
      keywords={item.keywords}
      onMouseDown={onSelectMods}
      onSelect={() => onSelectItem(item)}
      value={paletteValue(item)}
    >
      {item.lead ?? <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className={cn('truncate', modPreview && 'text-muted-foreground/80')}>
        {modPreview ? (
          item.modLabel
        ) : (
          /* Same per-term split as scoreItem's AND matcher, so the emphasis
             shows exactly which words earned the row its rank. */
          <HighlightMatches query={search.split(/\s+/)} text={item.label} />
        )}
      </span>
      {item.badge && <SessionKindBadge kind={item.badge} />}
      {item.detail && (
        <span className={cn(HUD_NOTE, HUD_NOTE_VARIANT[item.detailVariant ?? 'muted'])}>{item.detail}</span>
      )}
      {combo && (
        <KbdCombo className={cn('ml-auto', modPreview ? 'opacity-90' : 'opacity-55')} combo={combo} size="sm" />
      )}
      {item.to && <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground/70', !combo && 'ml-auto')} />}
      {item.active && <Check className={cn('size-3.5 shrink-0 text-primary', !combo && !item.to && 'ml-auto')} />}
    </CommandItem>
  )
})

// Fulilian session ids: <YYYYMMDD>_<HHMMSS>_<6 hex>. Used to offer a direct
// "Go to session ‹id›" jump for ids that aren't in the recent-200 list.
const SESSION_ID_RE = /^\d{8}_\d{6}_[a-f0-9]{6}$/

// Same relative-age keys the sidebar rows use (search page detail column).
const SEARCH_AGE_KEY = { day: 'ageDay', hour: 'ageHour', minute: 'ageMin' } as const

/**
 * Groups for the sessions deep-search page (step14 R6): a title/preview/branch
 * filter over the local recent-200 list, unioned with the backend's
 * full-library search results (deduped against the local hits). Exported pure
 * so the A5 fixture assertions (title hit / keyword hit / no-hit empty) test
 * the actual ranking, not a mock of it.
 */
export function buildSessionSearchGroups({
  needle,
  openSession,
  results,
  sessions,
  t
}: {
  needle: string
  openSession: (sessionId: string) => (event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void
  results?: SessionSearchResult[]
  sessions: SessionEntry[]
  t: Translations
}): PaletteGroup[] {
  const local = needle
    ? sessions.filter(session =>
        [session.title, session.preview ?? '', session.git_branch ?? '']
          .map(normalize)
          .some(text => text.includes(needle))
      )
    : sessions.slice(0, 20)

  const seen = new Set(local.map(session => session.id))
  const remote = (results ?? []).filter(result => !seen.has(result.session_id)).slice(0, 30)

  const row = (id: string, key: string, label: string, detail?: string, keywords?: string[]): PaletteItem => ({
    detail,
    icon: MessageCircle,
    id: `search-session-${key}`,
    keywords,
    label,
    runWithEvent: openSession(id)
  })

  const localItems = local.map(session =>
    row(
      session.id,
      `local-${session.id}`,
      session.title,
      session.preview || undefined,
      ['chat', 'session', ...(session.git_branch ? [session.git_branch] : [])]
    )
  )

  // Remote hits carry a matched-content excerpt (no title field on the wire)
  // and the conversation's start time — the deep-reach complement to the
  // title/preview rows above.
  const remoteItems = remote.map(result => {
    const startedAt = result.session_started
    const age = !startedAt
      ? undefined
      : (() => {
          const { unit, value } = coarseElapsed(Date.now() - startedAt * 1000)

          return unit === 'second' ? t.sidebar.row.ageNow : `${value}${t.sidebar.row[SEARCH_AGE_KEY[unit]]}`
        })()

    return row(
      result.session_id,
      `remote-${result.session_id}`,
      result.snippet.split('\n')[0]?.trim() || result.session_id,
      age,
      ['chat', 'session', result.source ?? '', result.model ?? '']
    )
  })

  if (localItems.length === 0 && remoteItems.length === 0) {
    return []
  }

  return [
    ...(localItems.length > 0 ? [{ heading: t.commandCenter.sections.sessions, items: localItems }] : []),
    ...(remoteItems.length > 0 ? [{ heading: t.commandCenter.sessionSearchRemote, items: remoteItems }] : [])
  ]
}

// ── T8 work-hub zones (方案 §3-T8) ──────────────────────────────────────────
// Four exported pure builders — 动作 / 会话 / 页面 / 容器 — so the A5 fixture
// assertions (zone shape, honest placeholders, fuzzy ranking) test the REAL
// groups the palette renders, not a mock of them. Same contract as
// buildSessionSearchGroups above.

/** Rows the 会话 zone shows on an empty palette: the recent sessions. */
const RECENT_ZONE_LIMIT = 8
/** Deep-search (FTS) hits shown in the ROOT list while typing — the full set
 *  stays one `to` click away on the search-sessions page. */
const REMOTE_ROOT_LIMIT = 8

/**
 * 动作 zone: the work-mode new-session trio (the T6/T7 kind payload口径 —
 * kind rides as recorded intent, never a fabricated container) plus the
 * security-audit run. 「切换主题」 lives in the Appearance zone below, where
 * the theme pickers already rank for theme queries.
 */
export function buildActionZoneGroups({
  onNewSession,
  onRunSecurityAudit,
  t
}: {
  onNewSession: (kind: PaletteSessionKind) => void
  onRunSecurityAudit: () => void
  t: Translations
}): PaletteGroup[] {
  const cc = t.commandCenter

  return [
    {
      heading: cc.zones.actions,
      items: [
        {
          icon: Search,
          id: 'action-new-forensics',
          keywords: ['forensics', 'case', 'new', '取證', '取证'],
          label: cc.newForensics,
          run: () => onNewSession('forensics')
        },
        {
          icon: Bug,
          id: 'action-new-ctf',
          keywords: ['ctf', 'challenge', 'new'],
          label: cc.newCtf,
          run: () => onNewSession('ctf')
        },
        {
          icon: Terminal,
          id: 'action-new-coding',
          keywords: ['coding', 'project', 'programming', 'new', 'task'],
          label: cc.newCodingTask,
          run: () => onNewSession('project')
        },
        {
          icon: Clipboard,
          id: 'action-security-audit',
          keywords: ['audit', 'security', 'export', 'log'],
          label: cc.maintenance.securityAudit,
          run: onRunSecurityAudit
        }
      ]
    }
  ]
}

/**
 * 会话 zone on the empty palette: the most recent sessions, each row led by
 * the ONE SessionStatusDot primitive (same as sidebar rows / pane tiles) and
 * badged by kind. Honest by construction: the badge comes from
 * `sessionContainerKind`, which answers 'project' until the kind column
 * lands — so today NO row paints a 取证/CTF badge, and `sessionBadgeKind`
 * keeps it that way. No sessions → no zone (no fabricated rows).
 */
export function buildRecentSessionGroups({
  heading,
  limit = RECENT_ZONE_LIMIT,
  openSession,
  sessions
}: {
  heading: string
  limit?: number
  openSession: (sessionId: string) => (event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void
  sessions: SessionInfo[]
}): PaletteGroup[] {
  const recent = sessions.slice(0, limit)

  if (recent.length === 0) {
    return []
  }

  return [
    {
      heading,
      items: recent.map(session => ({
        badge: sessionBadgeKind(session) ?? undefined,
        detail: session.preview ?? undefined,
        icon: MessageCircle,
        id: `zone-session-${session.id}`,
        keywords: ['chat', 'session', ...(session.git_branch ? [session.git_branch] : [])],
        label: sessionTitle(session),
        lead: sessionLeadNode(session.id, session),
        runWithEvent: openSession(session.id)
      }))
    }
  ]
}

/**
 * 页面 zone: the fixed route entries — every APP_ROUTES destination plus the
 * command-center panel — with the /cases overview as a real navigation row
 * since T14 (before that it rendered as a DISABLED 「即将可用」 placeholder,
 * 方案 T8-4). Rows marked `to` open a nested palette page instead of
 * navigating.
 */
export function buildPageZoneGroups({
  canOpenNewWindowFlag,
  go,
  t
}: {
  canOpenNewWindowFlag: boolean
  go: (path: string) => () => void
  t: Translations
}): PaletteGroup[] {
  const cc = t.commandCenter

  return [
    {
      heading: cc.zones.pages,
      items: [
        {
          action: 'session.new',
          icon: Plus,
          id: 'nav-new',
          keywords: ['chat', 'create'],
          label: cc.nav.newChat.title,
          run: go(NEW_CHAT_ROUTE)
        },
        ...(canOpenNewWindowFlag
          ? [
              {
                action: 'session.newWindow',
                icon: AppWindow,
                id: 'nav-new-window',
                keywords: ['window', 'instance', 'open', 'new'],
                label: t.keybinds.actions['session.newWindow'],
                run: () => void openNewWindow()
              }
            ]
          : []),
        {
          action: 'nav.settings',
          icon: Settings,
          id: 'nav-settings',
          label: cc.nav.settings.title,
          run: go(SETTINGS_ROUTE)
        },
        {
          icon: Search,
          id: 'nav-search-sessions',
          keywords: ['sessions', 'search', 'find', 'history', 'chats', 'conversation'],
          label: cc.searchSessions,
          to: 'search-sessions'
        },
        {
          action: 'nav.skills',
          icon: Wrench,
          id: 'nav-skills',
          keywords: ['skills', 'tools', 'toolsets', 'mcp', 'capabilities'],
          label: cc.nav.skills.title,
          run: go(SKILLS_ROUTE)
        },
        {
          action: 'nav.messaging',
          icon: MessageCircle,
          id: 'nav-messaging',
          label: cc.nav.messaging.title,
          run: go(MESSAGING_ROUTE)
        },
        {
          action: 'nav.webhooks',
          icon: Globe,
          id: 'nav-webhooks',
          keywords: ['webhook', 'subscription', 'receiver'],
          label: t.shell.statusbar.openWebhooks,
          run: go(WEBHOOKS_ROUTE)
        },
        {
          action: 'nav.artifacts',
          icon: Package,
          id: 'nav-artifacts',
          label: cc.nav.artifacts.title,
          run: go(ARTIFACTS_ROUTE)
        },
        {
          action: 'nav.cron',
          icon: Clock,
          id: 'nav-cron',
          keywords: ['schedule', 'jobs'],
          label: t.shell.statusbar.cron,
          run: go(CRON_ROUTE)
        },
        { action: 'nav.profiles', icon: Users, id: 'nav-profiles', label: t.profiles.title, run: go(PROFILES_ROUTE) },
        { action: 'nav.agents', icon: Cpu, id: 'nav-agents', label: t.agents.title, run: go(AGENTS_ROUTE) },
        {
          icon: Starmap,
          id: 'nav-starmap',
          keywords: ['star map', 'memory', 'memories', 'skills', 'graph', 'learning', 'constellation'],
          label: t.starmap.title,
          run: go(STARMAP_ROUTE)
        },
        {
          action: 'nav.commandCenter',
          icon: Activity,
          id: 'nav-command-center',
          keywords: ['command center', 'panel', 'system'],
          label: cc.commandCenter,
          run: go(COMMAND_CENTER_ROUTE)
        },
        {
          // T14: /cases is a real workspace page now — the T8-4 honest
          // placeholder becomes a plain navigation row (a dead link is still
          // not an option; the route is registered in APP_ROUTES).
          action: 'nav.cases',
          icon: FileText,
          id: 'nav-cases',
          keywords: ['cases', 'overview', '案件'],
          label: cc.casesOverview,
          run: go(CASES_ROUTE)
        }
      ]
    }
  ]
}

/**
 * 容器 zone: the work containers (§4.1). The kind data layer does not exist
 * yet (T8-4), so the zone lists only REAL container sources — the "open
 * folder" upsert and the project tree. No 案件/赛题 container is ever
 * fabricated here; when the kind column lands, forensics/CTF container rows
 * join through `sessionContainerKind`.
 */
export function buildContainerZoneGroups({
  onOpenFolder,
  onOpenProject,
  projects,
  t
}: {
  onOpenFolder: () => void
  onOpenProject: (projectId: string, newSession: boolean) => void
  projects: Array<{ icon?: null | string; id: string; isNoProject?: boolean; label: string; path?: null | string }>
  t: Translations
}): PaletteGroup[] {
  const cc = t.commandCenter

  return [
    {
      heading: cc.zones.containers,
      items: [
        {
          action: 'workspace.openFolder',
          icon: codiconIcon('folder-opened'),
          id: 'project-open-folder',
          keywords: ['open', 'folder', 'directory', 'project', 'add', 'import', 'workspace'],
          label: cc.openFolder,
          run: onOpenFolder
        },
        ...projects.map(project => ({
          comboHint: 'mod+enter',
          icon: codiconIcon(project.icon || (project.isNoProject ? 'home' : 'folder-library')),
          id: `project-${project.id}`,
          keywords: ['project', 'workspace', 'go to', project.label, ...(project.path ? [project.path] : [])],
          label: project.label,
          modLabel: cc.newSessionInProject(project.label),
          runWithEvent: (event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) =>
            onOpenProject(project.id, Boolean(event?.metaKey || event?.ctrlKey))
        }))
      ]
    }
  ]
}

/**
 * The palette's status line under the three states (T8-3): which single
 * message the (empty) result list carries. A pure mapping so the states are
 * assertable without a mount — 空态 renders zones (never this label, see
 * `queryPresent`), 加载态 says searching while the FTS query is in flight,
 * and 无结果态 only after the query settled.
 */
export function paletteStatusLabel({
  fetching,
  labels,
  page,
  queryPresent
}: {
  fetching: boolean
  labels: { noMatchingSessions: string; noResults: string; searching: string }
  page: null | string
  queryPresent: boolean
}): string {
  if (page === 'search-sessions') {
    return fetching ? labels.searching : labels.noMatchingSessions
  }

  return queryPresent && fetching ? labels.searching : labels.noResults
}

/**
 * Tab 补全: Tab completes the input to the highlighted row's label. Null when
 * there is nothing to complete to (no highlight, a disabled placeholder, or
 * the label already typed) — the key then keeps its default behavior.
 */
export const tabCompletionValue = (item: PaletteItem | null | undefined, search: string): string | null =>
  item && !item.disabled && item.label !== search ? item.label : null

/**
 * Ctrl 1-9 跳位: jump the selection to the first row of the Nth visible zone.
 * Scoped to the OPEN palette — the global dispatcher yields these chords
 * while ⌘K is up (see use-keybinds). Returns whether a row was jumped to.
 */
export function jumpToZone(scope: ParentNode, zone: number): boolean {
  const groups = Array.from(scope.querySelectorAll('[cmdk-group]:not([hidden])'))
  const target = groups[zone - 1]?.querySelector('[cmdk-item]')

  if (!(target instanceof HTMLElement)) {
    return false
  }

  target.click()

  return true
}


// A typed/pasted folder path: absolute (`/…`) or a Windows drive (`C:\…`).
// Deliberately NOT `~/…`: the upsert's membership check (projectIdForCwd)
// compares literal strings against the tree's absolute paths, so an unexpanded
// home path would always miss and double-create.
const FOLDER_PATH_RE = /^(\/|[A-Za-z]:[/\\]).+/

type SessionRow = Awaited<ReturnType<typeof listAllProfileSessions>>['sessions'][number]

const toSessionEntry = (session: SessionRow): SessionEntry => ({
  git_branch: session.git_branch ?? null,
  id: session.id,
  preview: session.preview ?? undefined,
  title: sessionTitle(session)
})

type NonConfigSettingsLabel =
  | 'about'
  | 'archivedChats'
  | 'gateway'
  | 'keysSettings'
  | 'keysTools'
  | 'mcp'
  | 'plugins'
  | 'providerAccounts'
  | 'providerApiKeys'

const NON_CONFIG_SETTINGS: ReadonlyArray<{
  icon: IconComponent
  keywords?: string[]
  labelKey: NonConfigSettingsLabel
  tab: string
}> = [
  {
    icon: Zap,
    keywords: ['accounts', 'sign in', 'oauth', 'login', 'subscription', 'models', 'anthropic', 'openai'],
    labelKey: 'providerAccounts',
    tab: 'providers&pview=accounts'
  },
  {
    icon: KeyRound,
    keywords: ['providers', 'api key', 'keys', 'secrets', 'tokens', 'egress', 'iron proxy', 'sandbox proxy'],
    labelKey: 'providerApiKeys',
    tab: 'providers&pview=keys'
  },
  {
    icon: Globe,
    // The Connections registry merged into the unified Gateways page.
    keywords: [
      'connection',
      'connections',
      'messaging',
      'remote',
      'multi',
      'instances',
      'ssh',
      'cloud',
      'add gateway',
      'registry'
    ],
    labelKey: 'gateway',
    tab: 'gateway'
  },
  {
    icon: KeyRound,
    keywords: ['api', 'secrets', 'tokens', 'credentials', 'browser', 'search'],
    labelKey: 'keysTools',
    tab: 'keys&kview=tools'
  },
  {
    icon: Settings2,
    keywords: ['gateway', 'proxy', 'server', 'webhook', 'env', 'egress proxy', 'iron proxy'],
    labelKey: 'keysSettings',
    tab: 'keys&kview=settings'
  },
  {
    icon: Package,
    keywords: ['plugins', 'extensions', 'desktop plugins', 'addon', 'add-on'],
    labelKey: 'plugins',
    tab: 'plugins'
  },
  { icon: Archive, keywords: ['history', 'archived'], labelKey: 'archivedChats', tab: 'sessions' },
  { icon: Info, keywords: ['version', 'about'], labelKey: 'about', tab: 'about' }
]

const THEME_MODES: ReadonlyArray<{ icon: IconComponent; mode: ThemeMode }> = [
  { icon: Sun, mode: 'light' },
  { icon: Moon, mode: 'dark' },
  { icon: Monitor, mode: 'system' }
]

// Which Light/Dark groups a theme belongs in. Built-ins render in both modes
// (the engine synthesises the missing side). Imported VS Code themes only carry
// the variant(s) the extension shipped — a single dark theme like Dracula lives
// under Dark only, while a GitHub/Solarized family (light + dark) lives in both.
function themeSupportsMode(name: string, target: 'light' | 'dark'): boolean {
  if (!isUserTheme(name)) {
    return true
  }

  const resolved = resolveTheme(name)

  if (!resolved) {
    return true
  }

  const background =
    target === 'dark' ? (resolved.darkColors ?? resolved.colors).background : resolved.colors.background

  return target === 'dark' ? luminance(background) <= 0.5 : luminance(background) > 0.5
}

/**
 * ⌘K is an overlay that is stateful to itself: pressing it must open a frame
 * immediately, and must not be held up by whatever else the shell is doing. So
 * the mounted cost of a CLOSED palette is one store subscription and nothing
 * else.
 *
 * Everything expensive — a dozen store subscriptions (connection, update
 * status/apply, keybinds, worktrees, projects, theme, i18n), three server
 * queries, and the group builders that assemble a few hundred rows — lives in
 * `CommandPaletteBody`, which only exists while the palette is on screen.
 * Before this split those hooks ran on every render of the always-mounted
 * component: an in-flight update rewrote `$updateApply` per progress line and
 * rebuilt the entire row set each time, for a surface nobody could see.
 *
 * `mounted` lags `open` by the close animation rather than tracking it exactly.
 * Unmounting the body the instant `open` flips false would rip the content out
 * of the tree before Radix could play `data-[state=closed]`, so the overlay
 * would vanish instead of closing. The body reports its own exit via
 * `onExited` (the content's real `animationend`), so nothing here has to know
 * how long that animation is — the CSS owns the duration.
 *
 * The `openCount` key remounts the body per open, which is what lets local
 * search/sub-page state reset without a close effect.
 */
export function CommandPalette() {
  const open = useStore($commandPaletteOpen)
  const [mounted, setMounted] = useState(open)
  const [openCount, setOpenCount] = useState(0)

  const retire = useCallback(() => {
    // Only retire the body if the palette is still closed — a reopen mid-fade
    // must not unmount the fresh instance.
    if (!$commandPaletteOpen.get()) {
      setMounted(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setOpenCount(count => count + 1)
      setMounted(true)

      return
    }

    // Safety net for environments where the exit animation never runs (jsdom,
    // `animation: none`), so the body can't be stranded mounted. The real
    // unmount is `onExited` below; whichever fires first wins.
    const timer = setTimeout(retire, EXIT_FALLBACK_MS)

    return () => clearTimeout(timer)
  }, [open, retire])

  return (
    <DialogPrimitive.Root onOpenChange={setCommandPaletteOpen} open={open}>
      {mounted && <CommandPaletteBody key={openCount} onExited={retire} />}
    </DialogPrimitive.Root>
  )
}

function CommandPaletteBody({ onExited }: { onExited: () => void }) {
  const { t } = useI18n()
  const pendingPage = useStore($commandPalettePage)
  const pendingSeed = useStore($commandPaletteSeed)
  const bindings = useStore($bindings)
  const worktrees = useStore($repoWorktrees)
  const projectTree = useStore($projectTree)
  const dismissedAutoProjects = useStore($dismissedAutoProjectIds)
  const navigate = useNavigate()

  const { availableThemes, clearThemePreview, mode, previewTheme, resolvedMode, setMode, setTheme, themeName } =
    useTheme()

  // Mode rows preview like theme rows do: paint the committed skin at the
  // highlighted brightness. `system` has to be resolved here — previewTheme
  // paints a concrete light/dark.
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')

  const resolveThemeMode = useCallback(
    (target: ThemeMode): 'light' | 'dark' => (target === 'system' ? (systemDark ? 'dark' : 'light') : target),
    [systemDark]
  )

  const [search, setSearch] = useState('')
  const [page, setPage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The Update row names the same install the statusbar names — same target
  // selection, same resolver. Reduced to the label string: an in-flight apply
  // rewrites these stores on every progress line, and only a changed string
  // should rebuild the palette's groups.
  const connection = useStore($connection)
  const desktopVersion = useStore($desktopVersion)
  const clientStatus = useStore($updateStatus)
  const clientApply = useStore($updateApply)
  const backendStatus = useStore($backendUpdateStatus)
  const backendApply = useStore($backendUpdateApply)

  const updateVersionLabel = useMemo(() => {
    const backend = connection?.mode === 'remote'
    const apply = backend ? backendApply : clientApply
    const status = backend ? backendStatus : clientStatus

    return resolveVersionStatus({
      applying: apply.applying || apply.stage === 'restart',
      behind: status?.behind ?? 0,
      copy: t.shell.statusbar,
      remote: backend,
      restarting: apply.stage === 'restart',
      sha: status?.currentSha?.slice(0, 7) ?? null,
      target: backend ? 'backend' : 'client',
      updateAvailable: status?.updateAvailable,
      version: backend ? status?.currentVersion : desktopVersion?.appVersion
    }).label
  }, [backendApply, backendStatus, clientApply, clientStatus, connection?.mode, desktopVersion?.appVersion, t])

  // cmdk's onSelect doesn't forward the triggering event — keep the last
  // click/keydown modifiers so session rows can honour ⌘-Enter / ⌘-click.
  const lastSelectMods = useRef<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>({
    ctrlKey: false,
    metaKey: false,
    shiftKey: false
  })

  const noteSelectMods = (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    lastSelectMods.current = {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    }
  }

  // Live ⌘/⌃-held state while the palette is open: rows with a modifier
  // variant (projects) preview it by swapping their label. Window-level
  // listeners because focus sits in the search input; blur clears so a
  // ⌘-Tab away doesn't strand the preview on.
  const [modHeld, setModHeld] = useState(false)

  useEffect(() => {
    const sync = (event: KeyboardEvent) => setModHeld(event.metaKey || event.ctrlKey)
    const clear = () => setModHeld(false)

    window.addEventListener('keydown', sync, { capture: true })
    window.addEventListener('keyup', sync, { capture: true })
    window.addEventListener('blur', clear)

    return () => {
      window.removeEventListener('keydown', sync, { capture: true })
      window.removeEventListener('keyup', sync, { capture: true })
      window.removeEventListener('blur', clear)
    }
  }, [])

  // Server-backed sources for the type-to-search groups. This component only
  // exists while the palette is open, so the queries are inherently lazy — no
  // `enabled` gate needed. react-query handles caching/dedup/staleness, so a
  // reopen paints from cache and revalidates in the background.
  const configQuery = useQuery({
    queryKey: ['command-palette', 'config'],
    queryFn: () => getFulilianConfigRecord()
  })

  const sessionsQuery = useQuery({
    queryKey: ['command-palette', 'sessions'],
    queryFn: () => listAllProfileSessions(200, 1, 'exclude')
  })

  const archivedQuery = useQuery({
    queryKey: ['command-palette', 'archived'],
    queryFn: () => listAllProfileSessions(200, 0, 'only')
  })

  const mcpServers = useMemo(() => {
    const raw = configQuery.data?.mcp_servers

    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.keys(raw as Record<string, unknown>).sort()
      : []
  }, [configQuery.data])

  const sessions = useMemo(() => (sessionsQuery.data?.sessions ?? []).map(toSessionEntry), [sessionsQuery.data])
  // Full rows for the 会话 zone — the dot and the kind badge need more fields
  // than the SessionEntry projection holds.
  const rawSessions = useMemo(() => sessionsQuery.data?.sessions ?? [], [sessionsQuery.data])
  const sessionInfoById = useMemo(() => new Map(rawSessions.map(session => [session.id, session])), [rawSessions])
  const archivedSessions = useMemo(() => (archivedQuery.data?.sessions ?? []).map(toSessionEntry), [archivedQuery.data])

  // ── Session deep search (step14 R6) ────────────────────────────────────────
  // The nested page unions two sources: the local recent-200 list (title/
  // preview/branch filter, instant) and the backend's full-library search
  // (`GET /api/sessions/search`, debounced — it reads every session, so the
  // keystroke must not fire it per character). Existing root-list session
  // group untouched; this page is the deep-reach complement.
  const [searchSessionsQuery, setSearchSessionsQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setSearchSessionsQuery(search), 250)

    return () => clearTimeout(timer)
  }, [search])

  const trimmedSearchQuery = searchSessionsQuery.trim()

  const sessionSearchQuery = useQuery({
    // T8 会话区: FTS 直出 on the root list too (the search-sessions page keeps
    // its deep-reach version). The 250ms debounce above keeps the per-keystroke
    // load off the backend; react-query dedups the shared query key.
    enabled: trimmedSearchQuery.length > 0 && (page === null || page === 'search-sessions'),
    queryKey: ['command-palette', 'session-search', trimmedSearchQuery],
    queryFn: () => searchSessions(trimmedSearchQuery),
    staleTime: 15_000
  })

  // Search/sub-page are local to a mount, and this component remounts per open
  // (keyed by open count), so each open starts clean without a reset effect.

  // Deep-link into a nested page (e.g. `/pet list` → pets picker).
  useEffect(() => {
    if (pendingPage) {
      setPage(pendingPage)
      $commandPalettePage.set(null)
    }
  }, [pendingPage])

  // Landing on a page (deep-link open onto Settings, drilling into a submenu,
  // stepping back out) must leave the filter typeable immediately — the whole
  // point of the pill/⌘K hand-off is "just start typing". Radix only
  // autofocuses on mount; a page swap re-renders the same input, and the
  // back-button click moves focus to the button.
  useEffect(() => {
    inputRef.current?.focus()
  }, [page])

  // Type-to-search hand-off: the keystroke that opened the palette (typing on
  // the Settings page) prefills the filter so the first character isn't lost.
  useEffect(() => {
    if (pendingSeed !== null) {
      setSearch(pendingSeed)
      $commandPaletteSeed.set(null)
    }
  }, [pendingSeed])

  const go = useCallback((path: string) => () => navigateToWorkspacePage(navigate, path), [navigate])

  // Sessions: plain select = open beside what's already loaded (focus existing
  // tile/main, else a new tab — main only when it's a blank draft);
  // ⌘/⌃-select / ⌘-Enter = force a new tab; ⇧⌘ = own window. Same door as the
  // sidebar, minus the sidebar's licence to spend main.
  const goSession = useCallback(
    (sessionId: string) => (event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
      openSession(sessionId, navigate, openSessionIntentFromModifiers(event, 'stack'))
    },
    [navigate]
  )

  const sessionSearchPage = useMemo<PaletteGroup[]>(
    () =>
      page === 'search-sessions'
        ? buildSessionSearchGroups({
            needle: normalize(trimmedSearchQuery),
            openSession: goSession,
            results: sessionSearchQuery.data?.results,
            sessions,
            t
          })
        : [],
    [goSession, page, sessionSearchQuery.data, sessions, t, trimmedSearchQuery]
  )

  // Step up one nested page (or back to the root list), clearing the filter so
  // the parent page doesn't reopen mid-search.
  const goBack = useCallback(() => {
    setSearch('')
    setPage(prev => (prev ? (PAGE_PARENTS[prev] ?? null) : null))
  }, [])

  const settingsSectionLabel = useCallback(
    (section: (typeof SECTIONS)[number]) => t.settings.sections[section.id] ?? section.label,
    [t.settings.sections]
  )

  // Running a keepOpen row (a toggle) changes state the rows themselves report,
  // so the groups have to rebuild without the palette closing. A counter keeps
  // that generic — the palette never learns which stores its contributions read.
  const [selectTick, setSelectTick] = useState(0)

  const contributedItems = usePaletteContributions()

  // The active repo's worktrees → "new conversation in <branch>". This is the
  // ⌘K-typed "I want to work on <branch>" reflex: each entry seeds a fresh
  // session anchored to that worktree's checkout (requestStartWorkSession),
  // so git is the source of truth and edits land in the right tree.
  const branchGroup = useMemo<PaletteGroup[]>(
    () =>
      worktrees.length > 0
        ? [
            {
              heading: t.commandCenter.branches,
              items: worktrees.map(wt => {
                const name = wt.branch?.trim() || wt.path.split('/').pop() || wt.path

                return {
                  icon: GitBranch,
                  id: `worktree-${wt.path}`,
                  keywords: ['branch', 'worktree', 'switch', name, wt.path],
                  label: t.commandCenter.startInBranch(name),
                  run: () => requestStartWorkSession(wt.path)
                }
              })
            }
          ]
        : [],
    [t, worktrees]
  )

  const baseGroups = useMemo<PaletteGroup[]>(() => {
    const settingsTab = (tab: string) => `${SETTINGS_ROUTE}?tab=${tab}`
    const cc = t.commandCenter

    // T8 work-hub zones (方案 §3-T8). Group order is the tiebreaker rankGroups
    // falls back on (stable sort), and exact ties are the common case — so
    // this order IS the priority: what you can DO (动作), where you're going
    // (页面), the work you were in (会话 recent), the containers that scope it
    // (容器), then what you can configure (commands / command center /
    // appearance / settings below).
    return [
      ...buildActionZoneGroups({
        onNewSession: startNewSessionWithKind,
        onRunSecurityAudit: () => void runSecurityAuditFromPalette(),
        t
      }),
      ...buildPageZoneGroups({ canOpenNewWindowFlag: canOpenNewWindow(), go, t }),
      ...buildRecentSessionGroups({
        heading: cc.zones.sessions,
        openSession: goSession,
        sessions: rawSessions
      }),
      ...buildContainerZoneGroups({
        onOpenFolder: () => void openFolderAsProject(),
        onOpenProject: (projectId, newSession) => goToProject(projectId, { newSession }),
        projects: filterVisibleProjects(projectTree, dismissedAutoProjects),
        t
      }),
      // Registry-contributed rows (core features + plugins) — one group,
      // omitted while nothing contributes.
      ...(contributedItems.length > 0
        ? [
            {
              heading: cc.commands,
              items: contributedItems.map(item => ({
                action: item.action,
                // Read on mount and after every select (the deps below), so a
                // row that reports state can't show the state it just left.
                detail: item.detail?.(),
                detailVariant: item.detailVariant,
                icon: item.icon ?? Zap,
                id: item.key,
                keepOpen: item.keepOpen,
                keywords: item.keywords,
                label: item.label,
                run: item.run
              }))
            }
          ]
        : []),
      {
        heading: cc.commandCenter,
        items: [
          {
            icon: Archive,
            id: 'cc-sessions',
            keywords: ['command center', 'sessions', 'pin'],
            label: cc.sections.sessions,
            run: go(`${COMMAND_CENTER_ROUTE}?section=sessions`)
          },
          {
            icon: FileText,
            id: 'cc-session-changes',
            keywords: ['changes', 'diff', 'review', 'session', 'files', 'touched'],
            label: cc.sessionChanges,
            run: () => openSessionChanges()
          },
          {
            icon: Activity,
            id: 'cc-system',
            keywords: ['command center', 'system', 'status', 'logs'],
            label: cc.sections.system,
            run: go(`${COMMAND_CENTER_ROUTE}?section=system`)
          },
          {
            icon: BarChart3,
            id: 'cc-usage',
            keywords: ['command center', 'usage', 'tokens', 'cost'],
            label: cc.sections.usage,
            run: go(`${COMMAND_CENTER_ROUTE}?section=usage`)
          },
          {
            // R11: the dedicated log diagnostics page (file × level × search).
            icon: FileText,
            id: 'cc-logs',
            keywords: ['command center', 'logs', 'diagnostics', 'errors'],
            label: cc.sections.logs,
            run: go(`${COMMAND_CENTER_ROUTE}?section=logs`)
          },
          {
            icon: RefreshCw,
            id: 'cc-restart-gateway',
            keywords: ['gateway', 'restart', 'messaging', 'reconnect', 'system'],
            label: cc.restartGateway,
            run: () => void runGatewayRestart()
          },
          {
            detail: updateVersionLabel,
            icon: Download,
            id: 'cc-update-fulilian',
            keywords: ['update', 'upgrade', 'fulilian', 'version', 'system', 'restart'],
            label: cc.updateFulilian,
            run: () => requestActiveUpdate()
          },
          {
            icon: RefreshCw,
            id: 'cc-reload-window',
            keywords: ['reload', 'window', 'refresh', 'restart', 'ui', 'stuck'],
            label: cc.reloadWindow,
            run: () => window.location.reload()
          },
          {
            action: 'view.showBrowser',
            icon: codiconIcon('globe'),
            id: 'cc-open-browser',
            keywords: ['browser', 'web', 'url', 'address', 'open', 'navigate', 'internet', 'site'],
            label: cc.openBrowser,
            run: () => openBrowserTab()
          }
        ]
      },
      {
        // Declared before Settings: cmdk keeps group order, so this keeps the
        // theme/mode pickers on top for "theme"/"color" queries instead of
        // buried under a fuzzy Settings match.
        heading: cc.appearance,
        items: [
          {
            icon: Palette,
            id: 'appearance-theme',
            keywords: ['theme', 'appearance', 'color', 'palette', 'skin', 'dark', 'light', 'look'],
            label: cc.changeTheme,
            to: 'theme'
          },
          {
            icon: Sun,
            id: 'appearance-mode',
            keywords: ['appearance', 'color mode', 'brightness', 'dark', 'light', 'system'],
            label: cc.changeColorMode,
            to: 'color-mode'
          },
          {
            icon: PawPrint,
            id: 'appearance-pets',
            keywords: ['pet', 'petdex', 'mascot', 'pets', '/pet', 'paw'],
            label: cc.pets.title,
            to: 'pets'
          },
          {
            icon: Egg,
            id: 'appearance-generate-pet',
            keywords: ['pet', 'generate', 'create', 'make', 'new pet', 'mascot', 'hatch', 'ai'],
            label: cc.generatePet.title,
            run: () => openPetGenerate()
          }
        ]
      },
      {
        heading: cc.settings,
        items: [
          ...SECTIONS.map(section => ({
            icon: section.icon,
            id: `set-config-${section.id}`,
            keywords: ['settings', section.label, settingsSectionLabel(section)],
            label: settingsSectionLabel(section),
            run: go(settingsTab(`config:${section.id}`))
          })),
          ...NON_CONFIG_SETTINGS.map(entry => ({
            icon: entry.icon,
            id: `set-${entry.tab}`,
            keywords: ['settings', ...(entry.keywords ?? [])],
            label: t.settings.nav[entry.labelKey],
            run: go(settingsTab(entry.tab))
          }))
        ]
      }
    ]
    // `selectTick` is a deliberate re-read trigger, not a value: rows report
    // live state through `detail()`, so the groups must rebuild after a select
    // that kept the palette open — eslint only sees an unused dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    contributedItems,
    dismissedAutoProjects,
    go,
    goSession,
    projectTree,
    rawSessions,
    selectTick,
    settingsSectionLabel,
    t,
    updateVersionLabel
  ])

  // The long, granular lists (settings fields, API keys, MCP servers, archived
  // chats) only surface once the user types — otherwise they'd bury the
  // navigation entries on an empty palette.
  //
  // Settings results are the DEEP catalog (schema-driven config fields,
  // appearance controls, stored credentials — the same entries the Settings
  // page serves), not a hardcoded key list: ⌘K is the de-facto settings
  // search everywhere, so root and the settings page must agree. The body
  // mounts per open, so the catalog queries fire on open and stay warm.
  const settingsCatalog = useSettingsSearchCatalog(true)

  const settingsEntryItem = useCallback(
    (entry: SettingsSearchEntry): PaletteItem => ({
      detail: entry.context,
      icon: entry.icon,
      id: `sp-${entry.id}`,
      keywords: [entry.context, entry.description ?? '', ...entry.keywords],
      label: entry.label,
      run: go(`${SETTINGS_ROUTE}?${settingsSearchTargetQuery(entry.target)}`)
    }),
    [go]
  )

  const searchGroups = useMemo<PaletteGroup[]>(() => {
    if (!search.trim()) {
      return []
    }

    const result: PaletteGroup[] = []

    // Paste a raw session id → jump straight to it, even if it predates the
    // recent-200 window the lists below are built from.
    const directId = search.trim()

    if (SESSION_ID_RE.test(directId)) {
      result.push({
        items: [
          {
            icon: MessageCircle,
            id: `goto-${directId}`,
            keywords: ['session', 'id', 'go to', directId],
            label: `${t.commandCenter.goToSession} ${directId}`,
            runWithEvent: goSession(directId)
          }
        ]
      })
    }

    // Paste/type an absolute folder path → open it as a project directly (the
    // ⌘O upsert without the native picker). Same reflex as the raw-session-id
    // row above.
    if (FOLDER_PATH_RE.test(directId)) {
      result.push({
        items: [
          {
            icon: codiconIcon('folder-opened'),
            id: `open-folder-${directId}`,
            keywords: ['open', 'folder', 'project', directId],
            label: t.commandCenter.openFolderAt(directId),
            run: () => void openFolderAsProject(directId)
          }
        ]
      })
    }

    // Deep-link straight to a Capabilities sub-tab. The root "Go to" entry only
    // lands on the top-level Skills view; typing "mcp"/"tools"/"skills" should
    // jump to the exact tab (matches the "not just the top lvl" ask).
    const capLabel = t.commandCenter.nav.skills.title

    result.push({
      heading: capLabel,
      items: [
        {
          icon: Wrench,
          id: 'cap-skills',
          keywords: ['skills', 'capabilities'],
          label: `${capLabel}: ${t.skills.tabSkills}`,
          run: go(`${SKILLS_ROUTE}?tab=skills`)
        },
        {
          icon: SlidersHorizontal,
          id: 'cap-toolsets',
          keywords: ['tools', 'toolsets', 'capabilities'],
          label: `${capLabel}: ${t.skills.tabToolsets}`,
          run: go(`${SKILLS_ROUTE}?tab=toolsets`)
        },
        {
          icon: Layers3,
          id: 'cap-mcp',
          keywords: ['mcp', 'servers', 'tools', 'capabilities', 'model context protocol'],
          label: `${capLabel}: ${t.skills.tabMcp}`,
          run: go(`${SKILLS_ROUTE}?tab=mcp`)
        }
      ]
    })

    // Apply a theme directly from the root search (e.g. "nous" → Nous). Live
    // preview via keepOpen, mirroring the nested theme picker. If the theme
    // can't render the current light/dark mode, flip to the one it supports.
    result.push({
      heading: t.settings.appearance.themeTitle,
      items: availableThemes.map(theme => {
        // Same mode fixup as run(): if a theme cannot render the current
        // light/dark, preview (and commit) in the one mode it supports.
        const previewMode = themeSupportsMode(theme.name, resolvedMode)
          ? resolvedMode
          : resolvedMode === 'dark'
            ? 'light'
            : 'dark'

        return {
          active: themeName === theme.name,
          icon: Palette,
          id: `search-theme-${theme.name}`,
          keepOpen: true,
          keywords: ['theme', 'appearance', 'color', 'skin', theme.name, theme.description],
          label: theme.label,
          onHighlight: () => previewTheme(theme.name, previewMode),
          run: () => {
            setTheme(theme.name)

            if (!themeSupportsMode(theme.name, resolvedMode)) {
              setMode(previewMode)
            }
          }
        }
      })
    })

    // Switch light/dark/system directly (typing "dark" shouldn't require the
    // nested color-mode page).
    result.push({
      heading: t.settings.appearance.colorMode,
      items: THEME_MODES.map(entry => ({
        active: mode === entry.mode,
        icon: entry.icon,
        id: `search-mode-${entry.mode}`,
        keepOpen: true,
        keywords: ['appearance', 'color mode', 'brightness', entry.mode, t.settings.modeOptions[entry.mode].label],
        label: t.settings.modeOptions[entry.mode].label,
        onHighlight: () => previewTheme(themeName, resolveThemeMode(entry.mode)),
        run: () => setMode(entry.mode)
      }))
    })

    if (sessions.length > 0) {
      result.push({
        heading: t.commandCenter.sections.sessions,
        items: sessions.map(session => ({
          badge: sessionBadgeKind(sessionInfoById.get(session.id)) ?? undefined,
          icon: MessageCircle,
          id: `session-${session.id}`,
          keywords: [
            'chat',
            'session',
            ...(session.preview ? [session.preview] : []),
            ...(session.git_branch ? [session.git_branch] : [])
          ],
          label: session.title,
          lead: sessionLeadNode(session.id, sessionInfoById.get(session.id)),
          runWithEvent: goSession(session.id)
        }))
      })
    }

    // T8 会话区 FTS 直出: backend deep-search hits the local recent-200 list
    // doesn't hold, capped for the root (the search-sessions page keeps the
    // full set). Same row shape as buildSessionSearchGroups' remote rows —
    // excerpt label, relative-age detail — led by the same status dot. The
    // dot resolves the live state from the stored id alone; no SessionInfo
    // exists for these, so no kind badge (honest, per T8-4).
    const localIds = new Set(sessions.map(session => session.id))
    const remoteHits = (sessionSearchQuery.data?.results ?? [])
      .filter(hit => !localIds.has(hit.session_id))
      .slice(0, REMOTE_ROOT_LIMIT)

    if (remoteHits.length > 0) {
      result.push({
        heading: t.commandCenter.sessionSearchRemote,
        items: remoteHits.map(hit => {
          const startedAt = hit.session_started
          const age = !startedAt
            ? undefined
            : (() => {
                const { unit, value } = coarseElapsed(Date.now() - startedAt * 1000)

                return unit === 'second' ? t.sidebar.row.ageNow : `${value}${t.sidebar.row[SEARCH_AGE_KEY[unit]]}`
              })()

          return {
            detail: age,
            icon: MessageCircle,
            id: `zone-fts-${hit.session_id}`,
            keywords: ['chat', 'session', hit.source ?? '', hit.model ?? ''],
            label: hit.snippet.split('\n')[0]?.trim() || hit.session_id,
            lead: sessionLeadNode(hit.session_id),
            runWithEvent: goSession(hit.session_id)
          }
        })
      })
    }

    const fieldItems = [...settingsCatalog.appearanceEntries, ...settingsCatalog.configEntries].map(settingsEntryItem)

    if (fieldItems.length > 0) {
      result.push({ heading: t.commandCenter.settingsFields, items: fieldItems })
    }

    if (settingsCatalog.pluginEntries.length > 0) {
      result.push({
        heading: t.settings.nav.plugins,
        items: settingsCatalog.pluginEntries.map(settingsEntryItem)
      })
    }

    if (settingsCatalog.credentialEntries.length > 0) {
      result.push({
        heading: t.settings.nav.apiKeys,
        items: settingsCatalog.credentialEntries.map(settingsEntryItem)
      })
    }

    if (mcpServers.length > 0) {
      result.push({
        heading: t.commandCenter.mcpServers,
        items: mcpServers.map(name => ({
          icon: Wrench,
          id: `mcp-${name}`,
          keywords: ['mcp', 'server', 'tool'],
          label: name,
          run: go(`${SKILLS_ROUTE}?tab=mcp&server=${encodeURIComponent(name)}`)
        }))
      })
    }

    if (archivedSessions.length > 0) {
      result.push({
        heading: t.commandCenter.archivedChats,
        items: archivedSessions.map(session => ({
          icon: Archive,
          id: `archived-${session.id}`,
          keywords: [
            'archived',
            'chat',
            'session',
            ...(session.preview ? [session.preview] : []),
            ...(session.git_branch ? [session.git_branch] : [])
          ],
          label: session.title,
          run: go(`${SETTINGS_ROUTE}?tab=sessions&session=${encodeURIComponent(session.id)}`)
        }))
      })
    }

    return result
  }, [
    archivedSessions,
    availableThemes,
    go,
    goSession,
    mcpServers,
    mode,
    previewTheme,
    resolvedMode,
    resolveThemeMode,
    search,
    sessionInfoById,
    sessionSearchQuery.data,
    sessions,
    setMode,
    setTheme,
    settingsCatalog,
    settingsEntryItem,
    t,
    themeName
  ])

  // Branch rows rank below BOTH the fixed groups and the typed-only lists: they
  // scale with whatever worktrees happen to exist, so on a tie they're the least
  // likely thing meant. Everything above is either always-present chrome or a
  // list the search itself asked for.
  const groups = useMemo(
    () => [...baseGroups, ...searchGroups, ...branchGroup],
    [baseGroups, branchGroup, searchGroups]
  )

  // Settings-scoped page (⌘K on the Settings overlay, or its search pill):
  // the same catalog as root, minus everything that isn't settings. Pages
  // always list; the granular entries surface on type, same contract as the
  // root.
  const settingsPageGroups = useMemo<PaletteGroup[]>(() => {
    const settingsTab = (tab: string) => `${SETTINGS_ROUTE}?tab=${tab}`
    const cc = t.commandCenter

    const result: PaletteGroup[] = [
      {
        heading: cc.settings,
        items: [
          ...SECTIONS.map(section => ({
            icon: section.icon,
            id: `sp-config-${section.id}`,
            keywords: ['settings', section.label, settingsSectionLabel(section)],
            label: settingsSectionLabel(section),
            run: go(settingsTab(`config:${section.id}`))
          })),
          ...NON_CONFIG_SETTINGS.map(entry => ({
            icon: entry.icon,
            id: `sp-${entry.tab}`,
            keywords: ['settings', ...(entry.keywords ?? [])],
            label: t.settings.nav[entry.labelKey],
            run: go(settingsTab(entry.tab))
          }))
        ]
      }
    ]

    if (search.trim()) {
      result.push({
        heading: cc.settingsFields,
        items: [...settingsCatalog.appearanceEntries, ...settingsCatalog.configEntries].map(settingsEntryItem)
      })

      if (settingsCatalog.pluginEntries.length > 0) {
        result.push({
          heading: t.settings.nav.plugins,
          items: settingsCatalog.pluginEntries.map(settingsEntryItem)
        })
      }

      if (settingsCatalog.credentialEntries.length > 0) {
        result.push({
          heading: t.settings.nav.apiKeys,
          items: settingsCatalog.credentialEntries.map(settingsEntryItem)
        })
      }
    }

    return result
  }, [go, search, settingsCatalog, settingsEntryItem, settingsSectionLabel, t])

  // Nested palette pages (VS Code-style submenus). Reusable: add an entry here
  // and point a root item at it via `to`.
  const subPages = useMemo<Record<string, PalettePage>>(
    () => ({
      theme: {
        title: t.settings.appearance.themeTitle,
        placeholder: t.settings.appearance.themeDesc,
        groups: [
          // Pinned at the top: drills into the Marketplace browser.
          {
            items: [
              {
                icon: Download,
                id: 'theme-install',
                keywords: ['install', 'marketplace', 'vscode', 'vs code', 'download', 'new', 'color'],
                label: t.commandCenter.installTheme.title,
                to: 'install-theme'
              }
            ]
          },
          // Brightness lives with the palettes: one mode toggle for the whole
          // list instead of splitting every theme across a Light and a Dark group.
          {
            heading: t.settings.appearance.colorMode,
            items: THEME_MODES.map(entry => ({
              active: mode === entry.mode,
              icon: entry.icon,
              id: `theme-mode-${entry.mode}`,
              keepOpen: true,
              keywords: ['appearance', 'brightness', 'color mode', t.settings.modeOptions[entry.mode].label],
              label: t.settings.modeOptions[entry.mode].label,
              onHighlight: () => previewTheme(themeName, resolveThemeMode(entry.mode)),
              run: () => setMode(entry.mode)
            }))
          },
          // Every palette once, applied on top of the selected mode. An import
          // that only ships one variant (Dracula) flips the mode to the side it
          // can actually render.
          {
            heading: t.settings.appearance.themeTitle,
            items: availableThemes.map(theme => {
              const previewMode = themeSupportsMode(theme.name, resolvedMode)
                ? resolvedMode
                : resolvedMode === 'dark'
                  ? 'light'
                  : 'dark'

              return {
                active: themeName === theme.name,
                icon: Palette,
                id: `theme-${theme.name}`,
                keepOpen: true,
                keywords: ['theme', 'appearance', 'palette', theme.label, theme.description ?? ''],
                label: theme.label,
                onHighlight: () => previewTheme(theme.name, previewMode),
                run: () => {
                  setTheme(theme.name)

                  if (previewMode !== resolvedMode) {
                    setMode(previewMode)
                  }
                }
              }
            })
          }
        ]
      },
      'color-mode': {
        title: t.settings.appearance.colorMode,
        placeholder: t.settings.appearance.colorModeDesc,
        groups: [
          {
            heading: t.settings.appearance.colorMode,
            items: THEME_MODES.map(entry => ({
              active: mode === entry.mode,
              icon: entry.icon,
              id: `mode-${entry.mode}`,
              keepOpen: true,
              keywords: ['appearance', 'brightness', t.settings.modeOptions[entry.mode].label],
              label: t.settings.modeOptions[entry.mode].label,
              onHighlight: () => previewTheme(themeName, resolveThemeMode(entry.mode)),
              run: () => setMode(entry.mode)
            }))
          }
        ]
      },
      // Server-driven page: browse petdex gallery, adopt/switch, toggle off.
      pets: {
        title: t.commandCenter.pets.title,
        placeholder: t.commandCenter.pets.placeholder,
        groups: []
      },
      // Session deep search (step14 R6): recent-200 title/preview filter ∪
      // debounced backend search; groups are built above.
      'search-sessions': {
        title: t.commandCenter.searchSessions,
        placeholder: t.commandCenter.searchSessionsPlaceholder,
        groups: sessionSearchPage
      },
      // Server-driven page: items come from the Marketplace, rendered by
      // <MarketplaceThemePage> (loader + live search + per-row install).
      'install-theme': {
        title: t.commandCenter.installTheme.pageTitle,
        placeholder: t.commandCenter.installTheme.placeholder,
        groups: []
      },
      // Settings-scoped search (⌘K while the Settings overlay is up, or the
      // search pill beside its close button).
      settings: {
        title: t.commandCenter.nav.settings.title,
        placeholder: t.settings.search.placeholder,
        groups: settingsPageGroups
      }
    }),
    [
      availableThemes,
      mode,
      previewTheme,
      resolvedMode,
      resolveThemeMode,
      sessionSearchPage,
      setMode,
      setTheme,
      settingsPageGroups,
      t,
      themeName
    ]
  )

  const activePage = page ? subPages[page] : null
  const unrankedGroups = activePage ? activePage.groups : groups
  const visibleGroups = useMemo(() => rankGroups(unrankedGroups, search), [unrankedGroups, search])
  const placeholder = activePage ? activePage.placeholder : t.commandCenter.searchPlaceholder

  // The three states' single status line (T8-3), via the pure mapping:
  // 空态 renders the zones and never reaches this label (no query, no fetch);
  // 加载态 says searching while the FTS query is in flight; 无结果态 only
  // after the query settled — a missed match never renders a fabricated row.
  const noResultsLabel = paletteStatusLabel({
    fetching: sessionSearchQuery.isFetching,
    labels: {
      noMatchingSessions: t.commandCenter.noMatchingSessions,
      noResults: t.commandCenter.noResults,
      searching: t.commandCenter.searchSessionsSearching
    },
    page,
    queryPresent: search.trim().length > 0
  })

  // The HighlightWatcher inside <Command> reports the highlighted row (arrows
  // or hover) from the cmdk store. Resolve it back to its PaletteItem so
  // preview-capable rows (the theme pickers) can paint live. Any other
  // highlight clears the preview. The resolved item is also what Tab 补全
  // completes to (T8 keyboard conventions).
  const itemByValue = useMemo(() => {
    const map = new Map<string, PaletteItem>()

    for (const group of visibleGroups) {
      for (const item of group.items) {
        map.set(paletteValue(item), item)
      }
    }

    return map
  }, [visibleGroups])

  const highlightedItemRef = useRef<PaletteItem | null>(null)

  const handleHighlight = useCallback(
    (value: string) => {
      const item = itemByValue.get(value) ?? null

      highlightedItemRef.current = item

      if (item?.onHighlight) {
        item.onHighlight()
      } else {
        clearThemePreview()
      }
    },
    [clearThemePreview, itemByValue]
  )

  // A preview lives only while its rows show. If the page changes, give the
  // paint back to the committed appearance.
  useEffect(() => {
    clearThemePreview()
  }, [page, clearThemePreview])

  // Clear at close START, not at unmount. The body stays mounted through the
  // whole exit animation (see CommandPalette), so an unmount clear would
  // revert the theme only after the fade. The unmount return is the backstop
  // for a body that dies without a close (a remount on reopen).
  const paletteOpen = useStore($commandPaletteOpen)

  useEffect(() => {
    if (!paletteOpen) {
      clearThemePreview()
    }
  }, [paletteOpen, clearThemePreview])

  useEffect(() => clearThemePreview, [clearThemePreview])

  const handleSelect = (item: PaletteItem) => {
    if (item.to) {
      setPage(item.to)
      setSearch('')

      return
    }

    if (item.runWithEvent) {
      item.runWithEvent(lastSelectMods.current)
    } else {
      item.run?.()
    }

    // Clear stashed modifiers so a plain Enter after a ⌘-click isn't sticky.
    lastSelectMods.current = { ctrlKey: false, metaKey: false, shiftKey: false }

    if (!item.keepOpen) {
      closeCommandPalette()

      return
    }

    // Staying open means the rows are still on screen — re-read anything they
    // report (a toggle's on/off) so the note isn't showing the previous state.
    setSelectTick(tick => tick + 1)
  }

  return (
    <DialogPrimitive.Portal>
      {/* Transparent overlay: keeps click-away + focus trap, but no dim/blur. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-(--z-over-modal)" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          HUD_POSITION,
          HUD_SURFACE,
          'z-(--z-over-modal-content) w-[min(34rem,calc(100vw-2rem))] overflow-hidden duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=open]:zoom-in-95'
        )}
        // The close animation finishing is what retires this whole subtree —
        // the CSS owns the duration, not a hardcoded timer. Guarded on the
        // content itself (descendants animate too) and on the closed state, so
        // an OPEN animation never unmounts the palette we just opened.
        onAnimationEnd={event => {
          if (event.target === event.currentTarget && event.currentTarget.dataset.state === 'closed') {
            onExited()
          }
        }}
      >
        <DialogPrimitive.Title className="sr-only">{t.commandCenter.paletteTitle}</DialogPrimitive.Title>
        <Command className="bg-transparent" loop shouldFilter={false}>
          <HighlightWatcher onValue={handleHighlight} />
          {activePage && (
            <button
              className="flex w-full items-center gap-1.5 border-b border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={goBack}
              type="button"
            >
              <ChevronLeft className="size-3.5" />
              <span>{t.commandCenter.back}</span>
              <span className="text-muted-foreground/50">/</span>
              <span className="font-medium text-foreground">{activePage.title}</span>
            </button>
          )}
          <CommandInput
            className={HUD_TEXT}
            onKeyDown={event => {
              // Capture modifiers before cmdk's Enter fires onSelect (which
              // swipes the inviting MouseEvent and hands us nothing).
              noteSelectMods(event)

              // T8 键位 Ctrl 1-9 跳位: jump the selection to the first row of
              // the Nth visible zone while the palette is up. The global
              // dispatcher yields these chords while the palette is open (see
              // use-keybinds `paletteOwnsNumberCombo`; the T9 keybind table
              // keeps Ctrl 1/2/3 for new-three-modes once the palette is
              // closed, so the two scopes never collide).
              if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
                event.preventDefault()
                event.stopPropagation()
                jumpToZone(document, Number(event.key))

                return
              }

              // T8 键位 Tab 补全: complete the input to the highlighted row's
              // label (no highlight / a disabled placeholder → default Tab).
              if (event.key === 'Tab' && !event.shiftKey && !event.altKey) {
                const completed = tabCompletionValue(highlightedItemRef.current, search)

                if (completed !== null) {
                  event.preventDefault()
                  event.stopPropagation()
                  setSearch(completed)
                }

                return
              }

              if (!activePage) {
                return
              }

              // In a submenu: Esc and empty-input Backspace step back out
              // instead of closing the whole palette.
              if (event.key === 'Escape' || (event.key === 'Backspace' && search === '')) {
                event.preventDefault()
                event.stopPropagation()
                goBack()

                return
              }
            }}
            onValueChange={setSearch}
            placeholder={placeholder}
            ref={inputRef}
            right={page === 'pets' ? <PetInlineToggle /> : undefined}
            value={search}
          />
          <CommandList className="dt-portal-scrollbar max-h-[min(20rem,56vh)]">
            {/* Server-driven pages render their own list; the rest show groups. */}
            {page === 'pets' ? (
              <PetPalettePage
                onGenerate={() => {
                  closeCommandPalette()
                  openPetGenerate()
                }}
                search={search}
              />
            ) : page === 'install-theme' ? (
              <MarketplaceThemePage onPickTheme={setTheme} search={search} />
            ) : (
              <PaletteGroups
                bindings={bindings}
                groups={visibleGroups}
                modHeld={modHeld}
                noResultsLabel={noResultsLabel}
                onSelectItem={handleSelect}
                onSelectMods={noteSelectMods}
                search={search}
              />
            )}
          </CommandList>
        </Command>
        {/* T8 keyboard-convention footer (preview 05): the four gestures the
            palette answers to, always visible — including the Ctrl 1-9 zone
            jump that only exists while the palette is up. */}
        <div
          className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground"
          data-slot="palette-footer"
        >
          <span className="flex items-center gap-1">
            <KbdGroup keys={['↑', '↓']} size="sm" />
            {t.commandCenter.paletteFooter.select}
          </span>
          <span className="flex items-center gap-1">
            <KbdGroup keys={['↵']} size="sm" />
            {t.commandCenter.paletteFooter.run}
          </span>
          <span className="flex items-center gap-1">
            <KbdGroup keys={['Tab']} size="sm" />
            {t.commandCenter.paletteFooter.complete}
          </span>
          <span className="flex items-center gap-1">
            <KbdGroup keys={['Ctrl', '1-9']} size="sm" />
            {t.commandCenter.paletteFooter.jump}
          </span>
          <span className="ml-auto hidden truncate sm:block">{t.commandCenter.paletteTitle}</span>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
