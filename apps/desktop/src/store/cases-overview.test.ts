// Cases overview store tests (step 16 · T14, 方案 §5-T14).
//
// The honesty contract lives here: cards aggregate REAL sessions only, the
// status filter narrows to the two groups, archived containers are read-only
// (no live session inside), and every count without a data layer stays null —
// a number appearing out of nowhere is a bug, not a feature.

import { beforeEach, describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/fulilian'

import {
  aggregateCaseCards,
  CASES_FILTERS,
  clearCasesOverviewState,
  $casesFilter,
  $filteredCaseCards,
  filterCaseCards,
  NO_CONTAINER_KEY,
  sessionContainerKey,
  setCasesFilter
} from './cases-overview'

const session = (overrides: Partial<SessionInfo>): SessionInfo =>
  ({
    cwd: 'E:/work/repo',
    ended_at: null,
    git_repo_root: null,
    id: 'sess-1',
    input_tokens: 0,
    is_active: false,
    last_active: 1_000,
    message_count: 2,
    model: null,
    output_tokens: 0,
    preview: 'a preview',
    started_at: 500,
    title: 'A session',
    tool_call_count: 0,
    ...overrides
  }) as SessionInfo

beforeEach(() => {
  clearCasesOverviewState()
})

// ── Container keys (the 案号 data source) ────────────────────────────────────

describe('sessionContainerKey', () => {
  it('prefers the git repo root — the authoritative project key', () => {
    expect(sessionContainerKey({ cwd: 'E:/work/repo/sub', git_repo_root: 'E:/work/repo' })).toBe('E:/work/repo')
  })

  it('falls back to cwd, then the no-container bucket', () => {
    expect(sessionContainerKey({ cwd: 'E:/work/repo', git_repo_root: null })).toBe('E:/work/repo')
    expect(sessionContainerKey({ cwd: null, git_repo_root: null })).toBe(NO_CONTAINER_KEY)
  })
})

// ── Aggregation (卡片数据源真实性, A5-③) ─────────────────────────────────────

describe('aggregateCaseCards', () => {
  it('builds one card per real container, newest activity first', () => {
    const cards = aggregateCaseCards({
      sessions: [
        session({ git_repo_root: 'E:/work/alpha', id: 's1', last_active: 100 }),
        session({ git_repo_root: 'E:/work/beta', id: 's2', last_active: 300 }),
        session({ git_repo_root: 'E:/work/alpha', id: 's3', last_active: 200 })
      ]
    })

    expect(cards).toHaveLength(2)
    expect(cards[0]!.caseId).toBe('E:/work/beta')
    expect(cards[1]!.caseId).toBe('E:/work/alpha')
    expect(cards[1]!.sessionCount).toBe(2)
    expect(cards[1]!.lastActive).toBe(200)
  })

  it('rolls the representative title up from the newest session', () => {
    const cards = aggregateCaseCards({
      sessions: [
        session({ git_repo_root: 'E:/w', id: 's1', last_active: 100, title: 'Older' }),
        session({ git_repo_root: 'E:/w', id: 's2', last_active: 200, title: 'Newer' })
      ]
    })

    expect(cards[0]!.label).toBe('Newer')
  })

  it('aggregates the no-container bucket without inventing a case id', () => {
    const cards = aggregateCaseCards({ sessions: [session({ cwd: null, git_repo_root: null, id: 's1' })] })

    expect(cards).toHaveLength(1)
    expect(cards[0]!.caseId).toBeNull()
  })

  it('paints the working dot only when a session is mid-turn', () => {
    const cards = aggregateCaseCards({
      sessions: [session({ git_repo_root: 'E:/w', id: 'live' }), session({ git_repo_root: 'E:/q', id: 'calm' })],
      workingSessionIds: new Set(['live'])
    })

    expect(cards.find(card => card.caseId === 'E:/w')!.dotState).toBe('working')
    expect(cards.find(card => card.caseId === 'E:/q')!.dotState).toBe('idle')
  })

  it('never fabricates evidence/audit/report numbers — the seams stay null (T14-5)', () => {
    const cards = aggregateCaseCards({ sessions: [session({})] })

    expect(cards[0]!.evidenceCount).toBeNull()
    expect(cards[0]!.auditCount).toBeNull()
    expect(cards[0]!.reportStatus).toBeNull()
  })

  it('counts a container archived only when EVERY session in it is archived (T14-2)', () => {
    const cards = aggregateCaseCards({
      archivedSessions: [session({ archived: true, git_repo_root: 'E:/gone', id: 'gone-1' })],
      sessions: [
        session({ archived: true, git_repo_root: 'E:/mixed', id: 'm-a' }),
        session({ git_repo_root: 'E:/mixed', id: 'm-b' })
      ]
    })

    expect(cards.find(card => card.caseId === 'E:/mixed')!.archived).toBe(false)
    expect(cards.find(card => card.caseId === 'E:/gone')!.archived).toBe(true)
  })

  it('returns no cards from no sessions — the store never invents a row', () => {
    expect(aggregateCaseCards({})).toEqual([])
    expect(aggregateCaseCards({ sessions: [], archivedSessions: [] })).toEqual([])
  })
})

// ── Status filter (状态过滤, A5-②) ───────────────────────────────────────────

describe('filterCaseCards / $casesFilter', () => {
  const cards = [
    { archived: false, caseId: 'live' },
    { archived: true, caseId: 'gone' }
  ] as never[]

  it('narrows to the two groups (进行中/已归档) with no third state', () => {
    expect(CASES_FILTERS).toEqual(['active', 'archived'])
    expect(filterCaseCards(cards, 'active')).toEqual([cards[0]])
    expect(filterCaseCards(cards, 'archived')).toEqual([cards[1]])
  })

  it('active group never leaks an archived card and vice versa', () => {
    const mixed = [
      ...aggregateCaseCards({ archivedSessions: [session({ archived: true, id: 'a1' })] }),
      ...aggregateCaseCards({ sessions: [session({ id: 'v1' })] })
    ]

    for (const card of filterCaseCards(mixed, 'active')) {
      expect(card.archived).toBe(false)
    }

    for (const card of filterCaseCards(mixed, 'archived')) {
      expect(card.archived).toBe(true)
    }
  })

  it('the filter atom carries the group and resets to active', () => {
    setCasesFilter('archived')
    expect($casesFilter.get()).toBe('archived')

    clearCasesOverviewState()
    expect($casesFilter.get()).toBe('active')
  })

  it('an empty group filters to NOTHING — an honest no-match, not a fabricated row', () => {
    expect(filterCaseCards([], 'archived')).toEqual([])
    expect(filterCaseCards([], 'active')).toEqual([])
  })
})

// ── Derived stores ───────────────────────────────────────────────────────────

describe('$filteredCaseCards', () => {
  it('follows the filter atom', () => {
    $casesFilter.set('archived')
    expect($filteredCaseCards.get()).toEqual([])

    setCasesFilter('active')
    expect($filteredCaseCards.get()).toEqual([])
  })
})
