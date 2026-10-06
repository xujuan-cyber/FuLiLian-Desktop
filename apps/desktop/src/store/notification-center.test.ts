import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $cronSessions, $unreadFinishedSessionIds, $sessions } from './session'
import { clearAllSessionStates, publishSessionState } from './session-states'
import { $trayCounts } from './tray-state'
import {
  $centerGroups,
  $notificationCenterReadIds,
  $notificationCenterUnread,
  $notificationEntries,
  automationRowsFrom,
  approvalRowsFrom,
  centerGroups,
  clearNotificationCenter,
  groupForNotifyKind,
  ingestNotificationEntry,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_CENTER_LIMIT,
  systemRowsFrom,
  updateProgressToEntry,
  type NotificationCenterEntry
} from './notification-center'

const entry = (id: string, group: NotificationCenterEntry['group'], at = 1_000): NotificationCenterEntry => ({
  at,
  body: `body of ${id}`,
  group,
  id,
  title: `Title ${id}`
})

describe('未读数与托盘聚合同源 (A5-④)', () => {
  beforeEach(() => {
    clearNotificationCenter()
    clearAllSessionStates()
    $sessions.set([])
  })

  afterEach(() => {
    clearNotificationCenter()
    clearAllSessionStates()
    $sessions.set([])
  })

  it('approval unread IS the tray needsInput count — one source, no second aggregation', () => {
    $sessions.set([{ id: 's1', title: 'Blocked run' }, { id: 's2', title: 'Also blocked' }] as never)
    // needs-input via the SAME session-state machinery the tray dot reads.
    publishSessionState('runtime-1', { busy: false, messages: [], needsInput: true, storedSessionId: 's1' } as never)
    publishSessionState('runtime-2', { busy: false, messages: [], needsInput: true, storedSessionId: 's2' } as never)

    const unread = $notificationCenterUnread.get()

    // The same number the tray badge paints — mutating one side to diverge
    // (e.g. hardcoding approval = 0) must fail this comparison.
    expect(unread.approval).toBe($trayCounts.get().needsInput)
    expect(unread.approval).toBe(2)
    expect(unread.total).toBe(2)
  })
})

describe('groupForNotifyKind (方案 §5-T15 判据表)', () => {
  it('maps approval + input kinds onto the 需审批 group', () => {
    expect(groupForNotifyKind('approval')).toBe('approval')
    expect(groupForNotifyKind('input')).toBe('approval')
  })

  it('maps background/completion/plugin kinds onto the 自动化结果 group', () => {
    expect(groupForNotifyKind('backgroundDone')).toBe('automation')
    expect(groupForNotifyKind('turnDone')).toBe('automation')
    expect(groupForNotifyKind('turnError')).toBe('automation')
    expect(groupForNotifyKind('credits')).toBe('automation')
    expect(groupForNotifyKind('plugin')).toBe('automation')
  })

  it('degrades unknown kinds to 系统 (宁缺勿假)', () => {
    expect(groupForNotifyKind('something-new')).toBe('system')
    expect(groupForNotifyKind(undefined)).toBe('system')
    expect(groupForNotifyKind('')).toBe('system')
  })
})

describe('ingestNotificationEntry', () => {
  beforeEach(() => {
    clearNotificationCenter()
  })

  afterEach(() => {
    clearNotificationCenter()
    window.localStorage.removeItem('fulilian:notification-center:read-ids:v1')
  })

  it('prepends newest first and keeps the feed bounded (oldest evicted)', () => {
    ingestNotificationEntry(entry('a', 'automation', 1))
    ingestNotificationEntry(entry('b', 'automation', 2))

    expect($notificationEntries.get().map(item => item.id)).toEqual(['b', 'a'])

    for (let index = 0; index < NOTIFICATION_CENTER_LIMIT + 10; index += 1) {
      ingestNotificationEntry(entry(`n${index}`, 'system', index))
    }

    const stored = $notificationEntries.get()

    expect(stored).toHaveLength(NOTIFICATION_CENTER_LIMIT)
    expect(stored[0]!.id).toBe(`n${NOTIFICATION_CENTER_LIMIT + 9}`)
    expect(stored.at(-1)!.id).toBe(`n${10}`)
  })

  it('ignores a replayed push with an id already stored', () => {
    ingestNotificationEntry(entry('dup', 'automation'))
    ingestNotificationEntry(entry('dup', 'automation'))

    expect($notificationEntries.get().map(item => item.id)).toEqual(['dup'])
  })
})

describe('已读标记 (localStorage persistence, T13 mechanism)', () => {
  beforeEach(() => {
    clearNotificationCenter()
    window.localStorage.removeItem('fulilian:notification-center:read-ids:v1')
  })

  afterEach(() => {
    clearNotificationCenter()
    window.localStorage.removeItem('fulilian:notification-center:read-ids:v1')
  })

  it('persists a read marker to localStorage and re-reads it', async () => {
    markNotificationRead('entry-1')

    expect($notificationCenterReadIds.get().has('entry-1')).toBe(true)

    const stored = JSON.parse(window.localStorage.getItem('fulilian:notification-center:read-ids:v1') ?? '[]')

    expect(stored).toEqual(['entry-1'])

    // The atom seeds itself from the SAME key at import time; re-importing the
    // module (same URL, cached instance) still observes the persisted write.
    expect((await reimportReadIds()).get().has('entry-1')).toBe(true)
  })

  it('marks every visible feed entry read at once', () => {
    ingestNotificationEntry(entry('a', 'automation'))
    ingestNotificationEntry(entry('b', 'system'))
    markAllNotificationsRead()

    expect($notificationCenterReadIds.get().has('a')).toBe(true)
    expect($notificationCenterReadIds.get().has('b')).toBe(true)
  })

  it('survives a hand-edited/truncated blob without breaking', async () => {
    window.localStorage.setItem('fulilian:notification-center:read-ids:v1', '{not json')

    expect((await reimportReadIds()).get().size).toBe(0)
  })
})

describe('derived rows (同源 projections)', () => {
  it('approval rows mirror the tray needsInput rows exactly (T6 同源)', () => {
    const rows = approvalRowsFrom([
      { id: 's1', title: 'Fix login' },
      { id: 's2', title: '  ' }
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ group: 'approval', id: 'approval:s1', sessionId: 's1', title: 'Fix login' })
    // Same untitled fallback vocabulary as the tray itself.
    expect(rows[1]!.title).toBe('s2')
    // Always-unread by definition: a resolved approval row disappears.
    expect(rows.every(row => !row.read)).toBe(true)
  })

  it('automation rows join unreadFinished ∩ cronSessions (no re-aggregation)', () => {
    const rows = automationRowsFrom(['c1', 'c2', 'chat-9'], [
      { id: 'c1', title: 'Nightly backup' },
      { id: 'c2', title: null }
    ])

    // 'chat-9' is unread but NOT a cron session → the intersection drops it.
    expect(rows.map(row => row.id)).toEqual(['cron:c1', 'cron:c2'])
    expect(rows[0]!.title).toBe('Nightly backup')
    expect(rows[1]!.title).toBe('c2')
    expect(rows.every(row => row.group === 'automation')).toBe(true)
  })

  it('system rows surface quick-capture notes read-only', () => {
    const rows = systemRowsFrom(
      [{ id: 'n1', text: 'Check the OneDrive key', at: '2026-01-01T00:00:00.000Z' }],
      new Set(['note:n1'])
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ group: 'system', id: 'note:n1', title: 'Check the OneDrive key' })
    expect(rows[0]!.read).toBe(true)
  })
})

describe('centerGroups (panel projection)', () => {
  it('groups pushed entries and prefixes derived rows per group', () => {
    const grouped = centerGroups(
      [entry('push-1', 'approval'), entry('push-2', 'automation'), entry('push-3', 'system'), entry('push-4', 'approval')],
      {
        approval: approvalRowsFrom([{ id: 's1', title: 'Tray row' }]),
        automation: automationRowsFrom(['c1'], [{ id: 'c1', title: 'Cron row' }]),
        system: systemRowsFrom([{ id: 'n1', text: 'note', at: '2026-01-01T00:00:00.000Z' }], new Set())
      },
      new Set(['push-1'])
    )

    expect(grouped.approval.map(row => row.id)).toEqual(['approval:s1', 'push-1', 'push-4'])
    expect(grouped.automation.map(row => row.id)).toEqual(['cron:c1', 'push-2'])
    expect(grouped.system.map(row => row.id)).toEqual(['note:n1', 'push-3'])
    expect(grouped.approval.find(row => row.id === 'push-1')!.read).toBe(true)
    expect(grouped.approval.find(row => row.id === 'push-4')!.read).toBe(false)
  })
})

describe('三类事件端到端链 (A5-①: 注入 → 分组 → 未读 → 已读)', () => {
  beforeEach(() => {
    clearNotificationCenter()
    clearAllSessionStates()
    $sessions.set([])
    $cronSessions.set([])
    $unreadFinishedSessionIds.set([])
  })

  afterEach(() => {
    clearNotificationCenter()
    clearAllSessionStates()
    $sessions.set([])
    $cronSessions.set([])
    $unreadFinishedSessionIds.set([])
    window.localStorage.removeItem('fulilian:notification-center:read-ids:v1')
  })

  it('审批请求: gateway needs-input → tray 同源行 → 未读计数 → 消解即消失', () => {
    // 1) 事件注入 — the gateway's approval.request parks the session in
    //    needs-input via the SAME session-state machinery the tray reads.
    $sessions.set([{ id: 's1', title: 'Deploy run' }] as never)
    publishSessionState('runtime-1', { busy: false, messages: [], needsInput: true, storedSessionId: 's1' } as never)

    // 2) 分组 — approval row derived from the tray snapshot.
    const groups = $centerGroups.get()
    expect(groups.approval.map(row => row.sessionId)).toContain('s1')

    // 3) 未读 — counted WITHOUT any read marker (existence-based).
    expect($notificationCenterUnread.get().approval).toBe(1)

    // 4) 消解 — the user answers in the approval bar; the row disappears
    //    (no stale entry: display-only, execution stays in approval.tsx).
    publishSessionState('runtime-1', { busy: false, messages: [], needsInput: false, storedSessionId: 's1' } as never)
    expect($centerGroups.get().approval).toHaveLength(0)
    expect($notificationCenterUnread.get().approval).toBe(0)
  })

  it('cron 结果: 运行结束标记 ∩ cron 会话 → 自动化结果 → 已读标记持久化', () => {
    // 1) 事件注入 — a cron run finished while unwatched.
    $cronSessions.set([{ id: 'c1', title: 'Nightly sync' }] as never)
    $unreadFinishedSessionIds.set(['c1'])

    // 2) 分组 — automation row via the unreadFinished ∩ cron join.
    expect($centerGroups.get().automation.map(row => row.id)).toEqual(['cron:c1'])
    expect($notificationCenterUnread.get().automation).toBe(1)

    // 3) 已读 — mark read; the marker persists for a cold launch.
    markNotificationRead('cron:c1')
    expect($notificationCenterUnread.get().automation).toBe(0)
    expect(JSON.parse(window.localStorage.getItem('fulilian:notification-center:read-ids:v1') ?? '[]')).toContain('cron:c1')
  })

  it('更新: 终态 stage → 系统组 entry → 未读 → 已读全链', () => {
    // 1) 事件注入 — the update pipeline streams a terminal stage.
    const entry = updateProgressToEntry({ at: 5_000, message: 'Update finished — restart to apply.', stage: 'done' })
    expect(entry).not.toBeNull()
    expect(entry!.group).toBe('system')

    // Non-terminal stages never enter the bell (live progress stays in the
    // apply overlay).
    expect(updateProgressToEntry({ at: 4_000, message: 'pulling', stage: 'pull' })).toBeNull()

    // 2) 入库 + 分组.
    ingestNotificationEntry(entry!)

    // 3) 未读 → 4) 已读.
    expect($notificationCenterUnread.get().system).toBe(1)
    markNotificationRead(entry!.id)
    expect($notificationCenterUnread.get().system).toBe(0)
    expect($centerGroups.get().system[0]!.read).toBe(true)
  })
})

describe('reimport parity guard', () => {
  it('keeps the read-set atom re-readable across imports (cold-launch shape)', async () => {
    expect((await reimportReadIds()).get()).toBeInstanceOf(Set)
  })
})

// Re-import under a fresh module URL so the read-set atom re-reads storage the
// way a cold launch would (the store seeds its atom at import time).
async function reimportReadIds(): Promise<typeof import('./notification-center')['$notificationCenterReadIds']> {
  const mod = (await import('./notification-center')) as typeof import('./notification-center')

  return mod.$notificationCenterReadIds
}
