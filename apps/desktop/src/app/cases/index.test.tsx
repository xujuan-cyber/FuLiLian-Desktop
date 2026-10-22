// Cases overview page tests (step 16 · T14, 方案 §5-T14).
//
// Mounted-page assertions for the honesty contract: two-group filter over
// real cards, both empty states, archived cards READ-ONLY (no new-session
// entry — the A5-① assertion), and the card → timeline navigation (T14-4).

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $cronSessions, $messagingSessions, $sessions } from '@/store/session'
import { $archivedSessions } from '@/store/sidebar-archive'
import type { SessionInfo } from '@/types/fulilian'

import { caseTimelineRoute } from '../routes'

import { CasesOverviewView } from './index'

const session = (overrides: Partial<SessionInfo>): SessionInfo =>
  ({
    cwd: 'E:/work/repo',
    ended_at: null,
    git_repo_root: 'E:/work/repo',
    id: 'sess-1',
    input_tokens: 0,
    is_active: false,
    last_active: Date.now() - 60_000,
    message_count: 2,
    model: null,
    output_tokens: 0,
    preview: 'a preview',
    started_at: 500,
    title: 'A session',
    tool_call_count: 0,
    ...overrides
  }) as SessionInfo

function seed({
  archived = [],
  cron = [],
  live = [],
  messaging = []
}: {
  archived?: SessionInfo[]
  cron?: SessionInfo[]
  live?: SessionInfo[]
  messaging?: SessionInfo[]
}): void {
  $sessions.set(live)
  $archivedSessions.set(archived)
  $cronSessions.set(cron)
  $messagingSessions.set(messaging)
}

function mountCases() {
  return render(
    <MemoryRouter initialEntries={['/cases']}>
      <I18nProvider>
        <Routes>
          <Route element={<CasesOverviewView />} path="cases" />
          {/* The timeline destination is stubbed; the assertion is that the
              card navigates to its REAL route shape (T14-4). */}
          <Route element={<div data-testid="timeline-stub">TIMELINE</div>} path="cases/:caseId/timeline" />
          <Route element={<div data-testid="fallback">FALLBACK</div>} path="*" />
        </Routes>
      </I18nProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  seed({})
})

// ── Empty states (T14-5 两态齐备) ────────────────────────────────────────────

describe('CasesOverviewView empty states', () => {
  it('no cases at all renders the honest empty state — no fabricated rows', () => {
    mountCases()

    expect(screen.getByTestId('cases-empty')).toBeTruthy()
    expect(screen.queryByTestId('cases-card')).toBeNull()
  })

  it('a filter matching nothing renders the no-match state, not the generic one', () => {
    seed({ live: [session({})] })
    mountCases()

    expect(screen.getByTestId('cases-grid')).toBeTruthy()

    // The archive group is empty — switching to it must show the no-match
    // state and NOT keep listing the live card.
    fireEvent.click(screen.getByTestId('cases-filter-archived'))

    expect(screen.getByTestId('cases-empty-filtered')).toBeTruthy()
    expect(screen.queryByTestId('cases-card')).toBeNull()
  })
})

// ── Cards from REAL data (T14-1) ────────────────────────────────────────────

describe('CasesOverviewView cards', () => {
  it('renders one card per real container with mono case id and session count', () => {
    seed({ live: [session({ git_repo_root: 'E:/work/alpha' }), session({ git_repo_root: 'E:/work/beta' })] })
    mountCases()

    const cards = screen.getAllByTestId('cases-card')

    expect(cards).toHaveLength(2)
    expect(screen.getAllByTestId('cases-card-sessions')).toHaveLength(2)
  })

  it('shows the honest 「—」 for evidence/audit/report — never a fabricated number', () => {
    seed({ live: [session({})] })
    mountCases()

    expect(screen.getByTestId('cases-card-evidence').textContent).toContain('—')
    expect(screen.getByTestId('cases-card-audit').textContent).toContain('—')
    expect(screen.getByTestId('cases-card-report').textContent).toContain('—')
  })

  it('excludes cron and messaging slices from the container aggregation', () => {
    seed({ cron: [session({ id: 'cron-1', source: 'cron' })], live: [session({})] })
    mountCases()

    expect(screen.getAllByTestId('cases-card')).toHaveLength(1)
  })

  it('routes the card to its case timeline at the classified route shape (T14-4)', async () => {
    seed({ live: [session({ git_repo_root: 'E:/work/alpha' })] })
    mountCases()

    fireEvent.click(screen.getAllByTestId('cases-card')[0]!.querySelector('button')!)

    await waitFor(() => expect(screen.getByTestId('timeline-stub')).toBeTruthy())
    expect(screen.queryByTestId('fallback')).toBeNull()
  })
})

// ── Status filter (T14-2) ───────────────────────────────────────────────────

describe('CasesOverviewView filter', () => {
  it('narrows to archived containers and back', () => {
    seed({
      archived: [session({ archived: true, git_repo_root: 'E:/gone', id: 'gone-1' })],
      live: [session({ git_repo_root: 'E:/live', id: 'live-1' })]
    })
    mountCases()

    expect(screen.getAllByTestId('cases-card')).toHaveLength(1)
    expect(screen.getByTestId('cases-filter-active').getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByTestId('cases-filter-archived'))

    expect(screen.getAllByTestId('cases-card')).toHaveLength(1)
    expect(screen.getByText('E:/gone')).toBeTruthy()
    expect(screen.queryByText('E:/live')).toBeNull()

    fireEvent.click(screen.getByTestId('cases-filter-active'))
    expect(screen.getByText('E:/live')).toBeTruthy()
    expect(screen.queryByText('E:/gone')).toBeNull()
  })
})

// ── 归档只读 (A5-①: archived cards are read-only) ───────────────────────────

describe('archived cards are read-only (T14-2)', () => {
  it('an archived card carries NO new-session entry — the action is disabled/absent', () => {
    seed({ archived: [session({ archived: true, git_repo_root: 'E:/gone', id: 'gone-1' })] })
    mountCases()

    fireEvent.click(screen.getByTestId('cases-filter-archived'))

    const card = screen.getAllByTestId('cases-card')[0]!

    expect(card.getAttribute('data-cases-card-archived')).toBe('true')
    // The ONLY affordance inside an archived card is the read-only timeline
    // link; no "new session" button can exist on it.
    const buttons = [...card.querySelectorAll('button')]
    expect(buttons).toHaveLength(1)
    expect(screen.queryByTestId('cases-card-new-session')).toBeNull()
  })

  it('a live card also has no new-session seam this round (kind data layer missing) — but is not marked archived', () => {
    seed({ live: [session({})] })
    mountCases()

    const card = screen.getAllByTestId('cases-card')[0]!

    expect(card.getAttribute('data-cases-card-archived')).toBe('false')
  })

  it('archived cards keep the read-only timeline entry (analysis stays reachable)', async () => {
    seed({ archived: [session({ archived: true, git_repo_root: 'E:/gone', id: 'gone-1' })] })
    mountCases()

    fireEvent.click(screen.getByTestId('cases-filter-archived'))
    fireEvent.click(screen.getAllByTestId('cases-card')[0]!.querySelector('button')!)

    await waitFor(() => expect(screen.getByTestId('timeline-stub')).toBeTruthy())
  })
})

// ── Route shape mirror (mount integration, T13 mount.test 先例) ─────────────

describe('cases route shape', () => {
  it('the timeline route built from a container key matches the classified three-segment shape', () => {
    // The overview navigates with caseTimelineRoute — same builder the
    // routes classifier recognizes. A drift on either side breaks the card.
    expect(caseTimelineRoute('E:/work/alpha')).toBe(
      `/cases/${encodeURIComponent('E:/work/alpha')}/timeline`
    )
  })
})
