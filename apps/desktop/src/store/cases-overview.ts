// Cases overview state (step 16 · T14, 方案 §5-T14).
//
// nanostores mirror of the /cases page: the container cards derived from the
// REAL session data the app already holds ($sessions + $archivedSessions), the
// two-group status filter (active / archived), and the honesty rules the plan
// pins — 证据数/留痕数/报告状态 have no data layer yet (T13's timeline store
// only fills per-case on open, T16's report pipeline does not exist), so a
// card that has no number shows 「—」, never a fabricated count.
//
// 案件口径（与 T13/T8 一致，不伪造）：the kind data layer is missing
// (`container-kind.ts` answers 'project' for everything), so there are no
// kind-forensics containers to list and NO card pretends otherwise. What IS
// real today is the session's container — the project/workspace a session
// belongs to (git_repo_root, else cwd, else the no-container bucket). Each
// container aggregates to one card: case no. = the container key (mono per
// DESIGN_PROPOSAL §3.6 路径/案号等宽), session count and last activity roll
// up from its sessions, archived rides the session's own archived flag. When
// the kind column lands, forensics containers join through the same
// aggregation with no page change.

import { atom, computed } from 'nanostores'

import type { SessionInfo } from '@/types/fulilian'

import { $cronSessions, $messagingSessions, $sessions } from './session'
import { $archivedSessions } from './sidebar-archive'

// ── Data shape ───────────────────────────────────────────────────────────────

/** One card of the overview grid (方案 §5-T14: 案号 mono + StatusDot + 证据数/
 *  留痕数/报告状态 + 最近活动). Fields without a data layer stay `null` and the
 *  card renders 「—」 — the honest-empty contract (T14-5). */
export interface CaseCard {
  /** The container key this card aggregates: git repo root, else cwd, else
   *  the no-container bucket id. Rendered mono like the 案号 it stands in for.
   *  `null` for the no-container bucket — the card then leads with the
   *  localized no-container label instead of a path. */
  caseId: null | string
  /** Live status for the StatusDot: a container is "working" while ANY of its
   *  sessions is mid-turn (the shared $workingSessionIds seam), else idle. */
  dotState: 'idle' | 'working'
  /** Evidence count — NO data layer yet (T13 fills per-case on open, the
   *  overview never fabricates). Always null this round. */
  evidenceCount: null
  /** Whether the container's newest session is archived. Archived containers
   *  are READ-ONLY on the card (no new-session entry, T14-2). */
  archived: boolean
  /** Audit-trail count — no audit store exists (T8 已证缺口). Always null. */
  auditCount: null
  /** Report status — the T16 pipeline does not exist. Always null. */
  reportStatus: null
  /** Sessions aggregated into this container. */
  sessionCount: number
  /** Newest session activity (epoch ms), driving the 最近活动 line. */
  lastActive: number
  /** Display title of the container (the newest session's title), so the card
   *  carries something real to read before any naming layer exists. */
  label: string
}

/** The overview's status filter (方案 §5-T14: 进行中/已归档两组). */
export type CasesFilter = 'active' | 'archived'

export const CASES_FILTERS: readonly CasesFilter[] = ['active', 'archived']

export const $casesFilter = atom<CasesFilter>('active')

export function setCasesFilter(filter: CasesFilter): void {
  $casesFilter.set(filter)
}

// ── Pure aggregation (unit-tested directly, A5-②/③) ────────────────────────

/** The no-container bucket id: sessions without any workspace still belong to
 *  a REAL bucket the sidebar also renders — they are never dropped, and never
 *  dressed up as a named case. */
export const NO_CONTAINER_KEY = '(no-container)'

/** The container key a session belongs to (pure so tests drive it without a
 *  store mount): git repo root — the authoritative project key — else cwd,
 *  else the no-container bucket. Mirrors the sidebar's grouping key chain. */
export function sessionContainerKey(session: Pick<SessionInfo, 'cwd' | 'git_repo_root'>): string {
  return session.git_repo_root || session.cwd || NO_CONTAINER_KEY
}

export interface CasesOverviewOptions {
  archivedSessions?: readonly SessionInfo[]
  sessions?: readonly SessionInfo[]
  /** Working-session ids (stored ids) from the shared dot-state seam. */
  workingSessionIds?: ReadonlySet<string>
}

/** Aggregate real sessions into overview cards, newest activity first. Pure:
 *  the page subscribes through `$casesCards`, tests call it directly.
 *
 *  Recency picks the representative title; archived is majority-voted (a
 *  container counts as archived only when EVERY session in it is archived —
 *  one live session keeps the container actionable). */
export function aggregateCaseCards({
  archivedSessions = [],
  sessions = [],
  workingSessionIds = new Set<string>()
}: CasesOverviewOptions = {}): CaseCard[] {
  interface Bucket {
    archived: boolean
    lastActive: number
    sessions: number
    title: string
    working: boolean
  }

  const buckets = new Map<string, Bucket>()

  const absorb = (session: SessionInfo, archived: boolean): void => {
    const key = sessionContainerKey(session)

    const bucket = buckets.get(key) ?? {
      archived: true,
      lastActive: 0,
      sessions: 0,
      title: '',
      working: false
    }

    bucket.sessions += 1
    bucket.working = bucket.working || workingSessionIds.has(session.id)
    // A container stays actionable while ANY of its sessions is live.
    bucket.archived = bucket.archived && archived

    const active = session.last_active || session.started_at || 0

    if (active >= bucket.lastActive) {
      bucket.lastActive = active
      bucket.title = session.title?.trim() || session.preview?.trim() || ''
    }

    buckets.set(key, bucket)
  }

  for (const session of sessions) {
    absorb(session, session.archived === true)
  }

  for (const session of archivedSessions) {
    absorb(session, true)
  }

  const cards: CaseCard[] = []

  for (const [key, bucket] of buckets) {
    cards.push({
      archived: bucket.archived,
      auditCount: null,
      caseId: key === NO_CONTAINER_KEY ? null : key,
      dotState: bucket.working ? 'working' : 'idle',
      evidenceCount: null,
      label: bucket.title,
      lastActive: bucket.lastActive,
      reportStatus: null,
      sessionCount: bucket.sessions
    })
  }

  return cards.sort((a, b) => b.lastActive - a.lastActive)
}

/** Filter the cards by the overview's two groups (方案 §5-T14). Pure. */
export function filterCaseCards(cards: readonly CaseCard[], filter: CasesFilter): CaseCard[] {
  return cards.filter(card => (filter === 'archived' ? card.archived : !card.archived))
}

// ── Derived stores ───────────────────────────────────────────────────────────

/** The overview's cards from the REAL session slices the app already fetched:
 *  live recents (cron/messaging slices excluded — those are not containers)
 *  plus the archived lookup the Archived view fetches. */
export const $casesCards = computed(
  [$sessions, $archivedSessions, $cronSessions, $messagingSessions],
  (sessions, archivedSessions, cronSessions, messagingSessions) => {
    const excluded = new Set([...cronSessions, ...messagingSessions].map(session => session.id))
    const live = sessions.filter(session => !excluded.has(session.id))

    return aggregateCaseCards({ archivedSessions, sessions: live })
  }
)

/** Cards narrowed by the current filter group. */
export const $filteredCaseCards = computed([$casesCards, $casesFilter], (cards, filter) =>
  filterCaseCards(cards, filter)
)

/** Reset to the default group (page unmount hygiene, mirrors clearTimelineState). */
export function clearCasesOverviewState(): void {
  $casesFilter.set('active')
}
