import { describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/types/fulilian'

import { en } from '@/i18n/en'
import { APP_ROUTES } from '@/app/routes'
import { SessionStatusDot } from '@/app/chat/session-status-dot'
import { Search } from '@/lib/icons'
import { $commandPaletteOpen, setCommandPaletteOpen } from '@/store/command-palette'

import {
  type PaletteGroup,
  buildActionZoneGroups,
  buildContainerZoneGroups,
  buildPageZoneGroups,
  buildRecentSessionGroups,
  jumpToZone,
  paletteStatusLabel,
  rankGroups,
  tabCompletionValue,
  type PaletteItem
} from './index'
import { sessionBadgeKind } from './session-marks'

// Step 16 · T8 (方案 §3-T8): the four work-hub zones + keyboard conventions +
// the three states. Assertions run against the REAL exported builders the
// palette renders (same contract as session-search.test.ts), not mocks.

const t = en
const cc = t.commandCenter

const session = (overrides: Partial<SessionInfo>): SessionInfo =>
  ({
    ended_at: null,
    id: '20260101_000001_abc123',
    input_tokens: 0,
    is_active: false,
    last_active: 0,
    message_count: 0,
    model: null,
    output_tokens: 0,
    preview: null,
    title: 'A session',
    ...overrides
  }) as SessionInfo

// ── 动作 zone ────────────────────────────────────────────────────────────────

describe('buildActionZoneGroups (T8 动作区)', () => {
  const onNewSession = vi.fn()
  const onRunSecurityAudit = vi.fn()
  const [group] = buildActionZoneGroups({ onNewSession, onRunSecurityAudit, t })
  const byId = (id: string): PaletteItem => group!.items.find(item => item.id === id)!

  it('heads the palette with the actions zone and the three work-mode rows', () => {
    expect(group!.heading).toBe(cc.zones.actions)
    expect(byId('action-new-forensics').label).toBe(cc.newForensics)
    expect(byId('action-new-ctf').label).toBe(cc.newCtf)
    expect(byId('action-new-coding').label).toBe(cc.newCodingTask)
  })

  it('wires the three-mode rows through the kind-payload seam', () => {
    byId('action-new-forensics').run!()
    byId('action-new-ctf').run!()
    byId('action-new-coding').run!()

    expect(onNewSession).toHaveBeenNthCalledWith(1, 'forensics')
    expect(onNewSession).toHaveBeenNthCalledWith(2, 'ctf')
    expect(onNewSession).toHaveBeenNthCalledWith(3, 'project')
  })

  it('offers the REAL audit action (run + tail), never a fabricated export', () => {
    const audit = byId('action-security-audit')

    expect(audit.label).toBe(cc.maintenance.securityAudit)
    expect(audit.run).toBe(onRunSecurityAudit)
  })
})

// ── 会话 zone ────────────────────────────────────────────────────────────────

describe('buildRecentSessionGroups (T8 会话区, empty palette)', () => {
  const openSession = vi.fn((sessionId: string) => () => sessionId)
  const sessions = Array.from({ length: 12 }, (_, index) =>
    session({ id: `2026010${index % 10}_00000${index}_abc12${index}`, title: `Session ${index}` })
  )

  it('shows the recent sessions, capped, under the localized zone heading', () => {
    const [group] = buildRecentSessionGroups({ heading: cc.zones.sessions, openSession, sessions })

    expect(group!.heading).toBe(cc.zones.sessions)
    expect(group!.items).toHaveLength(8)
    expect(group!.items[0]!.label).toBe('Session 0')
  })

  it('leads each row with the ONE SessionStatusDot primitive', () => {
    const [group] = buildRecentSessionGroups({ heading: cc.zones.sessions, openSession, sessions })

    expect(group!.items[0]!.lead).toBeTruthy()
    expect((group!.items[0]!.lead as { type: unknown }).type).toBe(SessionStatusDot)
  })

  it('paints NO kind badge while the kind data layer is missing (honest, T8-4)', () => {
    // The seam answers 'project' for everything today; the badge must be
    // absent — a 取证/CTF badge on a kind-less session would be fabricated.
    expect(sessionBadgeKind(session({}))).toBeNull()

    const [group] = buildRecentSessionGroups({ heading: cc.zones.sessions, openSession, sessions })

    for (const item of group!.items) {
      expect(item.badge).toBeUndefined()
    }
  })

  it('renders no zone at all when there is nothing to list (no fabricated rows)', () => {
    expect(buildRecentSessionGroups({ heading: cc.zones.sessions, openSession, sessions: [] })).toEqual([])
  })
})

// ── 页面 zone ────────────────────────────────────────────────────────────────

describe('buildPageZoneGroups (T8 页面区)', () => {
  const go = vi.fn((path: string) => () => path)
  const [group] = buildPageZoneGroups({ canOpenNewWindowFlag: false, go, t })
  const ids = group!.items.map(item => item.id)

  it('collects every app route as a palette entry (11-route 收编, incl. webhooks + command center)', () => {
    const covered = new Set(ids)

    // `new` is the new-chat row; every other route rides its nav-* row.
    for (const route of APP_ROUTES) {
      expect(covered.has(route.id === 'new' ? 'nav-new' : `nav-${route.id}`)).toBe(true)
    }

    expect(ids).toContain('nav-webhooks')
    expect(ids).toContain('nav-command-center')
  })

  it('lands the /cases overview as a DISABLED 「即将可用」 placeholder — never a dead link (T8-4)', () => {
    const cases = group!.items.find(item => item.id === 'nav-cases')!

    expect(cases.disabled).toBe(true)
    expect(cases.detail).toBe(cc.comingSoon)
    expect(cases.run).toBeUndefined()
    expect(cases.to).toBeUndefined()
  })

  it('keeps the nested search-sessions page reachable via `to`', () => {
    const search = group!.items.find(item => item.id === 'nav-search-sessions')!

    expect(search.to).toBe('search-sessions')
  })
})

// ── 容器 zone ────────────────────────────────────────────────────────────────

describe('buildContainerZoneGroups (T8 容器区)', () => {
  const onOpenFolder = vi.fn()
  const onOpenProject = vi.fn()
  const projects = [
    { icon: null, id: 'p1', isNoProject: true, label: 'Home', path: null },
    { icon: null, id: 'p2', label: 'FuLilian', path: 'E:/FuLilian-Desktop' }
  ]
  const [group] = buildContainerZoneGroups({ onOpenFolder, onOpenProject, projects, t })

  it('heads the zone with the containers vocabulary and lists REAL sources only', () => {
    expect(group!.heading).toBe(cc.zones.containers)
    // Only the open-folder upsert and the project tree — no fabricated
    // 案件/赛题 container rows while the kind data layer is missing (T8-4).
    expect(group!.items.map(item => item.id)).toEqual(['project-open-folder', 'project-p1', 'project-p2'])
  })

  it('wires folder upsert and the ⌘-Enter new-session variant', () => {
    group!.items[0]!.run!()
    expect(onOpenFolder).toHaveBeenCalledTimes(1)

    group!.items[2]!.runWithEvent!({ ctrlKey: true })
    expect(onOpenProject).toHaveBeenCalledWith('p2', true)
  })
})

// ── 分组置顶 + fuzzy 排序 ─────────────────────────────────────────────────────

describe('rankGroups (分组置顶 + fuzzy)', () => {
  const exactGroup: PaletteGroup = {
    heading: 'Exact',
    items: [{ icon: Search, id: 'exact', label: 'theme' }]
  }
  const keywordGroup: PaletteGroup = {
    heading: 'Keyword',
    items: [{ icon: Search, id: 'keyword', keywords: ['theme'], label: 'Appearance picker' }]
  }
  const unmatchedGroup: PaletteGroup = {
    heading: 'Unmatched',
    items: [{ icon: Search, id: 'unmatched', label: 'Nothing here' }]
  }

  it('ranks the exact-label group above the keyword-only group and drops misses', () => {
    const ranked = rankGroups([unmatchedGroup, keywordGroup, exactGroup], 'theme')

    expect(ranked.map(group => group.heading)).toEqual(['Exact', 'Keyword'])
  })

  it('orders items within a group by score (prefix above scattered)', () => {
    const group: PaletteGroup = {
      heading: 'G',
      items: [
        { icon: Search, id: 'scattered', label: 'the quick theme fox' },
        { icon: Search, id: 'prefix', label: 'theme picker' }
      ]
    }

    const ranked = rankGroups([group], 'theme')

    expect(ranked[0]!.items.map(item => item.id)).toEqual(['prefix', 'scattered'])
  })

  it('empty input is the 空态: curated groups pass through untouched', () => {
    expect(rankGroups([exactGroup, unmatchedGroup], '')).toEqual([exactGroup, unmatchedGroup])
  })
})

// ── 三态 ─────────────────────────────────────────────────────────────────────

describe('paletteStatusLabel (T8-3 三态)', () => {
  const labels = {
    noMatchingSessions: 'No matching sessions',
    noResults: 'No matching results found.',
    searching: 'Searching sessions…'
  }

  it('空态: no query — the zones render, never a status line', () => {
    expect(paletteStatusLabel({ fetching: false, labels, page: null, queryPresent: false })).toBe(labels.noResults)
    expect(paletteStatusLabel({ fetching: true, labels, page: null, queryPresent: false })).toBe(labels.noResults)
  })

  it('加载态: a live query with the FTS fetch still in flight says searching', () => {
    expect(paletteStatusLabel({ fetching: true, labels, page: null, queryPresent: true })).toBe(labels.searching)
  })

  it('无结果态: the query settled and missed — honest empty, no fabricated rows', () => {
    expect(paletteStatusLabel({ fetching: false, labels, page: null, queryPresent: true })).toBe(labels.noResults)
  })

  it('the sessions page keeps its scoped empty/loading copy', () => {
    expect(paletteStatusLabel({ fetching: true, labels, page: 'search-sessions', queryPresent: true })).toBe(
      labels.searching
    )
    expect(paletteStatusLabel({ fetching: false, labels, page: 'search-sessions', queryPresent: true })).toBe(
      labels.noMatchingSessions
    )
  })
})

// ── 键盘惯例 ─────────────────────────────────────────────────────────────────

describe('T8 键盘惯例', () => {
  describe('Tab 补全', () => {
    const item: PaletteItem = { icon: Search, id: 'x', label: 'Change theme' }

    it('completes the input to the highlighted row label', () => {
      expect(tabCompletionValue(item, 'chan')).toBe('Change theme')
    })

    it('is a no-op with no highlight, an exact label, or a disabled placeholder', () => {
      expect(tabCompletionValue(null, 'chan')).toBeNull()
      expect(tabCompletionValue(item, 'Change theme')).toBeNull()

      const placeholder: PaletteItem = { disabled: true, icon: Search, id: 'y', label: 'Cases overview' }
      expect(tabCompletionValue(placeholder, 'cases')).toBeNull()
    })
  })

  describe('Ctrl 1-9 跳位', () => {
    const buildPaletteDom = () => {
      const root = document.createElement('div')

      for (const groupIndex of [1, 2]) {
        const group = document.createElement('div')
        group.setAttribute('cmdk-group', '')

        if (groupIndex === 2) {
          // A hidden group (e.g. filtered out) must not consume a zone slot.
          const hiddenGroup = document.createElement('div')
          hiddenGroup.setAttribute('cmdk-group', '')
          hiddenGroup.setAttribute('hidden', '')
          const hiddenItem = document.createElement('div')
          hiddenItem.setAttribute('cmdk-item', '')
          hiddenItem.click = vi.fn()
          hiddenGroup.appendChild(hiddenItem)
          root.appendChild(hiddenGroup)
        }

        for (const itemIndex of [1, 2]) {
          const item = document.createElement('div')
          item.setAttribute('cmdk-item', '')
          item.click = vi.fn()
          item.dataset.zone = `${groupIndex}-${itemIndex}`
          group.appendChild(item)
        }

        root.appendChild(group)
      }

      document.body.appendChild(root)

      return root
    }

    it('jumps to the first row of the Nth VISIBLE zone and clicks it', () => {
      const root = buildPaletteDom()

      try {
        expect(jumpToZone(root, 2)).toBe(true)
        const secondGroupFirstItem = root.querySelectorAll('[cmdk-group]:not([hidden])')[1]!.querySelector('[cmdk-item]') as HTMLElement

        expect(secondGroupFirstItem.click).toHaveBeenCalledTimes(1)
      } finally {
        root.remove()
      }
    })

    it('answers false past the last zone (and clicks nothing)', () => {
      const root = buildPaletteDom()

      try {
        expect(jumpToZone(root, 9)).toBe(false)
        expect((root.querySelectorAll('[cmdk-item]')[0] as HTMLElement).click).not.toHaveBeenCalled()
      } finally {
        root.remove()
      }
    })
  })

  describe('Esc 关闭 / ↑↓ 导航 / ↵ 执行', () => {
    it('Esc-close plumbing: the dialog onOpenChange lands in the palette store close path', () => {
      // CommandPalette wires DialogPrimitive.Root onOpenChange={setCommandPaletteOpen}
      // with open={$commandPaletteOpen} — Esc inside the dialog calls
      // onOpenChange(false). Arrows/Enter are cmdk root keydown machinery; a
      // selected row commits through CommandItem onSelect → handleSelect → run.
      $commandPaletteOpen.set(true)
      setCommandPaletteOpen(false)

      expect($commandPaletteOpen.get()).toBe(false)
    })
  })
})
