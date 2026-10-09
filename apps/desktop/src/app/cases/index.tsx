// Cases overview page (step 16 · T14, 方案 §5-T14; openrelik-ui 列表形态参照).
//
// Layout: page head (title + 进行中/已归档 two-group status filter) → card
// grid. Each card: 案号 mono (the container key) + StatusDot (the ONE §3.5
// primitive, working=blue / idle=hollow via the shared dot-state seam) +
// sessions count + evidence/audit/report lines (「—」 honest empty — no data
// layer yet) + 最近活动 (compact age, sidebar's coarseElapsed contract).
//
// 诚实落地（T14-5）：无案件空态 / 过滤后无匹配空态两态齐备；卡片数据全部来自
// 真实会话/容器聚合（cases-overview store），证据数/留痕数/报告状态未落 ⇒
// 「—」。归档卡片只读（T14-2）：无新建会话入口，进入时间线仍可达（只读分析）。
//
// 卡片点击 = 进入该案件的时间线（T14-4：现有可达面 = /cases/:id/timeline）。
// The timeline page serves its deterministic mock dataset per case id; the id
// passed is the REAL container key (or the no-container bucket), so T13's
// seeded timeline stays keyed by the same id the overview lists — no
// fabricated case numbers on either side.

import { useStore } from '@nanostores/react'
import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router'

import { StatusDot } from '@/components/status-dot'
import { EmptyState } from '@/components/ui/empty-state'
import { type Translations, useI18n } from '@/i18n'
import { Archive, Clipboard, FileText, Search } from '@/lib/icons'
import { coarseElapsed } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  $casesCards,
  $casesFilter,
  $filteredCaseCards,
  type CaseCard,
  CASES_FILTERS,
  type CasesFilter,
  clearCasesOverviewState,
  setCasesFilter
} from '@/store/cases-overview'

import { caseTimelineRoute } from '../routes'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

/** Compact age under the sidebar's contract: "now" under a minute, then
 *  value+unit suffix (sidebar.row ageDay/ageHour/ageMin labels). */
function formatAge(ms: number, r: Translations['sidebar']['row']): string {
  if (!ms) {
    return '—'
  }

  const { unit, value } = coarseElapsed(Date.now() - ms)

  return unit === 'second' ? r.ageNow : `${value}${r[AGE_KEY[unit]]}`
}

const AGE_KEY = { day: 'ageDay', hour: 'ageHour', minute: 'ageMin' } as const

/** The overview's two-group filter row (方案 §5-T14: 进行中/已归档). Local
 *  state only — no backend round-trip, the groups ride the derived store. */
function FilterRow({ filter, counts }: { filter: CasesFilter; counts: { active: number; archived: number } }) {
  const { t } = useI18n()
  const a = t.casesOverview

  const label = (group: CasesFilter): string =>
    group === 'active' ? a.filterActive : a.filterArchived

  const count = (group: CasesFilter): number => counts[group]

  return (
    <div className="flex items-center gap-1" data-testid="cases-filter-row" role="tablist">
      {CASES_FILTERS.map(group => (
        <button
          aria-selected={filter === group}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs transition-colors duration-100',
            filter === group
              ? 'bg-(--ui-bg-quaternary) font-medium text-(--ui-text-primary)'
              : 'text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)'
          )}
          data-testid={`cases-filter-${group}`}
          key={group}
          onClick={() => setCasesFilter(group)}
          role="tab"
          type="button"
        >
          {label(group)}
          <span className="ml-1.5 font-mono text-[10.5px] text-(--ui-text-tertiary)">{count(group)}</span>
        </button>
      ))}
    </div>
  )
}

/** One card of the grid. Archived cards render the archive glyph and NO
 *  new-session entry (T14-2 归档只读); the timeline link stays (read-only
 *  analysis is still reachable). */
function CaseCardTile({ card, onOpen }: { card: CaseCard; onOpen: (card: CaseCard) => void }) {
  const { t } = useI18n()
  const a = t.casesOverview
  const r = t.sidebar.row

  const age = formatAge(card.lastActive, r)

  const stats = [
    { icon: Search, label: a.cardEvidence, testid: 'cases-card-evidence', value: card.evidenceCount },
    { icon: Clipboard, label: a.cardAudit, testid: 'cases-card-audit', value: card.auditCount },
    { icon: FileText, label: a.cardReport, testid: 'cases-card-report', value: card.reportStatus }
  ] as const

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors duration-100 hover:border-(--ui-stroke-strong)',
        card.archived && 'opacity-80'
      )}
      data-cases-card-archived={card.archived ? 'true' : 'false'}
      data-testid="cases-card"
    >
      <div className="flex items-center gap-2">
        <StatusDot
          aria-hidden="true"
          className="shrink-0"
          state={card.dotState === 'working' ? 'running' : 'stalled'}
        />
        <button
          className="min-w-0 truncate font-mono text-[13px] text-(--ui-text-secondary) hover:text-(--ui-text-primary)"
          onClick={() => onOpen(card)}
          title={card.caseId ?? card.label}
          type="button"
        >
          {(card.caseId ?? card.label) || a.noContainer}
        </button>
        {card.archived && <Archive aria-label={a.filterArchived} className="ml-auto size-3.5 shrink-0 text-(--ui-text-quaternary)" />}
      </div>

      <div className="truncate text-xs text-(--ui-text-tertiary)">{card.label || a.untitledCase}</div>

      <div className="mt-auto flex flex-col gap-1 text-[11px] text-(--ui-text-tertiary)">
        <div className="flex items-center gap-1.5" data-testid="cases-card-sessions">
          <span className="font-mono">{card.sessionCount}</span>
          <span>{a.cardSessions}</span>
        </div>
        {stats.map(({ icon: Icon, label, testid, value }) => (
          <div className="flex items-center gap-1.5" data-testid={testid} key={label}>
            <Icon aria-hidden="true" className="size-3 shrink-0" />
            <span>{label}</span>
            {/* Honest empty (T14-5): a count with no data layer renders 「—」,
                never a fabricated number. */}
            <span className="ml-auto font-mono">{value === null ? '—' : value}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-(--ui-text-quaternary)">
          <span>{a.cardLastActive}</span>
          <span className="ml-auto font-mono" data-testid="cases-card-age">
            {age}
          </span>
        </div>
      </div>
    </div>
  )
}

export function CasesOverviewView({
  setStatusbarItemGroup: _setStatusbarItemGroup
}: {
  setStatusbarItemGroup?: SetStatusbarItemGroup
} = {}) {
  const { t } = useI18n()
  const a = t.casesOverview
  const navigate = useNavigate()

  const filter = useStore($casesFilter)
  const cards = useStore($filteredCaseCards)
  // Group counts ride the UNFILTERED card list so a tab shows how much the
  // other group holds before you switch to it.
  const allCards = useStore($casesCards)

  // Page-local state resets on leave (T13 clearTimelineState hygiene).
  useEffect(() => clearCasesOverviewState(), [])

  const counts = {
    active: allCards.filter(card => !card.archived).length,
    archived: allCards.filter(card => card.archived).length
  }

  const openCard = useCallback(
    (card: CaseCard) => {
      // T14-4: the card's one destination is the case timeline at
      // /cases/:id/timeline — the id is the REAL container key the card
      // aggregates (T13's timeline keys its dataset by the same id).
      navigate(caseTimelineRoute(card.caseId ?? ''))
    },
    [navigate]
  )

  return (
    <section aria-label={a.title} className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-none items-center gap-3 border-b px-5 py-3" data-testid="cases-head">
        <h1 className="text-[16px] font-bold">{a.title}</h1>
        <span className="text-xs text-(--ui-text-tertiary)">{a.subtitle}</span>
        <div className="ml-auto">
          <FilterRow counts={counts} filter={filter} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {cards.length === 0 ? (
          // The two honesty states (T14-5): no cases at all / the group
          // matches nothing. EmptyState takes no data-testid, so the wrapper
          // carries it.
          <div data-testid={filter === 'archived' ? 'cases-empty-filtered' : 'cases-empty'}>
            <EmptyState
              description={filter === 'archived' ? a.emptyArchivedDesc : a.emptyDesc}
              title={filter === 'archived' ? a.emptyArchived : a.empty}
            />
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3" data-testid="cases-grid">
            {cards.map(card => (
              <CaseCardTile card={card} key={card.caseId ?? '(no-container)'} onOpen={openCard} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
