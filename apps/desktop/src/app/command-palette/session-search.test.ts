import { describe, expect, it, vi } from 'vitest'

import type { SessionSearchResult } from '@/types/fulilian'

import { buildSessionSearchGroups } from './index'

// A5 fixture assertions (step14 R6): ≥3 historical sessions, title hit,
// keyword hit, and the no-match empty shape — against the REAL grouping the
// palette page renders, not a mock of it.

const t = {
  sidebar: { row: { ageDay: 'd', ageHour: 'h', ageMin: 'm', ageNow: 'now' } },
  commandCenter: { sections: { sessions: 'Sessions' }, sessionSearchRemote: 'Deep search results' }
} as unknown as Parameters<typeof buildSessionSearchGroups>[0]['t']

const openSession = vi.fn((sessionId: string) => vi.fn())

const sessions = [
  { git_branch: null, id: '20260101_000001_abc123', preview: undefined, title: 'Alpha design review' },
  { git_branch: 'feat/auth', id: '20260102_000001_def456', preview: 'fix the login redirect loop', title: 'Auth bugfix' },
  { git_branch: null, id: '20260103_000001_ghi789', preview: undefined, title: 'Refactor the sidebar cards' }
]

const groupItemLabels = (groups: ReturnType<typeof buildSessionSearchGroups>) =>
  groups.flatMap(group => group.items.map(item => item.label))

describe('buildSessionSearchGroups (R6 deep search)', () => {
  it('matches a session by title', () => {
    const groups = buildSessionSearchGroups({ needle: 'alpha', openSession, sessions, t })

    expect(groupItemLabels(groups)).toContain('Alpha design review')
  })

  it('matches a session by preview/branch keyword', () => {
    const groups = buildSessionSearchGroups({ needle: 'redirect loop', openSession, sessions, t })

    expect(groupItemLabels(groups)).toContain('Auth bugfix')
  })

  it('returns no groups when nothing matches (empty state)', () => {
    const groups = buildSessionSearchGroups({ needle: 'quantum flux capacitor', openSession, sessions, t })

    expect(groups).toEqual([])
  })

  it('unions deep-search results the local list does not hold, deduped', () => {
    const remote: SessionSearchResult[] = [
      {
        lineage_root: null,
        model: null,
        role: 'user',
        session_id: '20251201_000001_old111',
        session_started: 1_700_000_000,
        snippet: 'an old conversation about deployment scripts',
        source: null
      },
      // Already matched locally — must NOT appear a second time.
      {
        lineage_root: null,
        model: null,
        role: 'user',
        session_id: '20260101_000001_abc123',
        session_started: null,
        snippet: 'Alpha design review',
        source: null
      }
    ]

    const groups = buildSessionSearchGroups({ needle: '', openSession, results: remote, sessions, t })

    const labels = groupItemLabels(groups)

    expect(labels).toContain('an old conversation about deployment scripts')
    expect(labels.filter(label => label === 'Alpha design review')).toHaveLength(1)
  })

  it('opens the matched session through openSession', () => {
    const groups = buildSessionSearchGroups({ needle: 'alpha', openSession, sessions, t })
    const item = groups[0]!.items[0]!

    expect(item.runWithEvent).toBeTruthy()

    item.runWithEvent!({})

    expect(openSession).toHaveBeenCalledWith('20260101_000001_abc123')
  })
})
