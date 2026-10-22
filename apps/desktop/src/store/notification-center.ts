/**
 * Notification center (step 16 · T15, 方案 §5-T15) — the persisted feed behind
 * the titlebar bell.
 *
 * TWO DIFFERENT CHANNELS, one surface:
 *
 * 1. The in-app toast feed (`store/notifications.ts` + `components/
 *    notifications.tsx`) is EPHEMERAL — entries expire and are gone. This
 *    store is the PERSISTENT log: main double-writes every OS notification it
 *    accepts (`electron/notification-center.ts`, fed from the SAME
 *    `fulilian:notify` dedupe choke point) into `fulilian:notification-center`
 *    pushes, and the renderer folds them in here. Nothing about the toast or
 *    OS-notification semantics changes — this is strictly a second write path.
 *
 * 2. Derived rows join from EXISTING atoms — never re-derived, never a second
 *    source of truth:
 *      - 需审批 (needs approval): projected from the tray aggregation
 *        (`$traySnapshot.needsInput`), the SAME needs-input grouping the tray
 *        dot paints — T6 同源 discipline.
 *      - 自动化结果 (automation results): cron runs marked unread by the
 *        watermark/live-edge machinery (`$unreadFinishedSessionIds ∩
 *        $cronSessions`), the same signal the sidebar's cron section paints.
 *      - 更新 (updates): replayed from `updates.onProgress` push events.
 *
 * 已读标记: read IDs persist in localStorage (same mechanism as T13's case
 *  timeline stars / T7's quick-capture notes). The quick-capture 速记 inbox
 *  (`store/quick-capture-inbox.ts`) joins the 系统 group read-only — the
 *  DESIGN_PROPOSAL's "P2 通知中心展示" commitment, without re-owning its data.
 *
 * 护栏语义: this center DISPLAYS and NAVIGATES only. No approval is ever
 *  executed here — approvals still resolve through the in-app bar /
 *  `approval.tsx` primitives (the OS-notification action path already routes
 *  there via `respondToApprovalAction`).
 */

import { atom, computed } from 'nanostores'

import { persistStringArray, storedStringArray } from '@/lib/storage'

import { $quickCaptureNotes } from './quick-capture-inbox'
import { $cronSessions, $unreadFinishedSessionIds } from './session'
import { $traySnapshot } from './tray-state'

// ── Wire shapes (mirrors electron/notification-center.ts) ───────────────────

/** The three 方案 §5-T15 groups. Anything unclassifiable lands in `system`. */
export type NotificationCenterGroup = 'approval' | 'automation' | 'system'

/** A pushed OS-notification record (the main-process double-write). */
export interface NotificationCenterEntry {
  id: string
  group: NotificationCenterGroup
  title: string
  body: string
  at: number
  /** Dedupe/session key — a matching tray session focuses that session. */
  sessionId?: string
}

// ── Feed store ──────────────────────────────────────────────────────────────

/** Bounded like every log the renderer keeps: oldest entries evicted first. */
export const NOTIFICATION_CENTER_LIMIT = 200

const READ_IDS_KEY = 'fulilian:notification-center:read-ids:v1'
/** Read-marker cap — past it, oldest markers are dropped (they only mute). */
const READ_IDS_LIMIT = 500

export const $notificationEntries = atom<NotificationCenterEntry[]>([])

/** Read markers, localStorage-persisted (T13 star mechanism). */
export const $notificationCenterReadIds = atom<ReadonlySet<string>>(readStoredReadIds())

function readStoredReadIds(): ReadonlySet<string> {
  const ids = typeof window === 'undefined' ? [] : storedStringArray(READ_IDS_KEY)

  return new Set(ids)
}

function persistReadIds(ids: ReadonlySet<string>): void {
  // Keep the NEWEST markers: evict from the front (insertion order = oldest first).
  persistStringArray(READ_IDS_KEY, [...ids].slice(-READ_IDS_LIMIT))
}

/** Fold one pushed entry in. Newest first; the cap evicts the OLDEST. No-op
 *  when an entry with the same id is already stored (main already deduped by
 *  kind+session within its window; the id guard covers replayed pushes).
 *  Returns the stored list (for tests). */
export function ingestNotificationEntry(entry: NotificationCenterEntry): NotificationCenterEntry[] {
  const existing = $notificationEntries.get()

  if (existing.some(candidate => candidate.id === entry.id)) {
    return existing
  }

  const next = [entry, ...existing].slice(0, NOTIFICATION_CENTER_LIMIT)

  $notificationEntries.set(next)

  return next
}

/** Test/teardown reset — clears the feed and the in-memory read markers. */
export function clearNotificationCenter(): void {
  $notificationEntries.set([])
  $notificationCenterReadIds.set(new Set())
}

/** Mark one entry read and persist the marker (localStorage, T13 mechanism). */
export function markNotificationRead(id: string): void {
  const ids = $notificationCenterReadIds.get()

  if (ids.has(id)) {
    return
  }

  const next = new Set(ids)

  next.add(id)
  persistReadIds(next)
  $notificationCenterReadIds.set(next)
}

/** Mark every currently visible feed entry read (panel footer affordance). */
export function markAllNotificationsRead(): void {
  const ids = new Set($notificationCenterReadIds.get())
  let changed = false

  for (const entry of $notificationEntries.get()) {
    if (!ids.has(entry.id)) {
      ids.add(entry.id)
      changed = true
    }
  }

  if (!changed) {
    return
  }

  persistReadIds(ids)
  $notificationCenterReadIds.set(new Set(ids))
}

// ── Grouping (方案 §5-T15 判据表, 与既有事件类型对齐) ────────────────────────
//
// The main process maps a `fulilian:notify` payload onto ONE of the three
// groups before pushing (electron/notification-center.ts). The renderer
// re-derives nothing: it renders `entry.group` as pushed. This side is pure so
// the mapping table is unit-testable without Electron.
//
// | 事件 (payload.kind)                              | 组          |
// |--------------------------------------------------|-------------|
// | approval / input（审批、澄清、sudo、secret 请求） | approval    |
// | backgroundDone / turnDone / turnError /
//   credits / plugin（后台与自动化结果）              | automation  |
// | 更新流 stage ≠ idle（fulilian:updates 推送）      | automation  |
// | 未知类型（宁缺勿假）                              | system      |

/** Map a notify kind onto a center group. Unknown kinds degrade to `system`. */
export function groupForNotifyKind(kind: string | undefined): NotificationCenterGroup {
  switch (kind) {
    case 'approval':

    case 'input':
      return 'approval'

    case 'backgroundDone':

    case 'turnDone':

    case 'turnError':

    case 'credits':

    case 'plugin':
      return 'automation'

    default:
      return 'system'
  }
}

// ── Derived rows (同源 projections — no second aggregation anywhere) ────────

export interface NotificationCenterRow {
  id: string
  group: NotificationCenterGroup
  title: string
  body: string
  at: number
  /** Navigation payload (session id) — display + jump only, never an action. */
  sessionId?: string
  read: boolean
}

/** Derived 需审批 rows — THE tray needsInput snapshot, reshaped for the panel.
 *  Same rows, same grouping, zero re-aggregation (T6 同源). A blank title
 *  falls back to the id — the SAME vocabulary `traySnapshotFrom` paints. */
export function approvalRowsFrom(
  needsInput: readonly { id: string; title: string }[]
): NotificationCenterRow[] {
  return needsInput.map(session => ({
    id: `approval:${session.id}`,
    group: 'approval' as const,
    title: session.title.trim() || session.id,
    body: '',
    at: 0,
    sessionId: session.id,
    read: false
  }))
}

/** Derived 自动化结果 rows — cron sessions flagged unread by the EXISTING
 *  watermark/live-edge machinery. Their unread state IS the result marker. */
export function automationRowsFrom(
  unreadFinished: readonly string[],
  cronSessions: readonly { id: string; title?: null | string }[]
): NotificationCenterRow[] {
  const cronById = new Map(cronSessions.map(session => [session.id, session]))

  return unreadFinished
    .filter(id => cronById.has(id))
    .map(id => {
      const session = cronById.get(id)!

      return {
        id: `cron:${id}`,
        group: 'automation' as const,
        title: session.title?.trim() || id,
        body: '',
        at: 0,
        sessionId: id,
        read: false
      }
    })
}

/** Derived 系统 rows — the quick-capture 速记 inbox (T7's P2 seam), surfaced
 *  read-only. Its data stays owned by quick-capture-inbox.ts. */
export function systemRowsFrom(
  notes: readonly { id: string; text: string; at: string }[],
  readIds: ReadonlySet<string>
): NotificationCenterRow[] {
  return notes.map(note => ({
    id: `note:${note.id}`,
    group: 'system' as const,
    title: note.text,
    body: '',
    at: Date.parse(note.at) || 0,
    read: readIds.has(`note:${note.id}`)
  }))
}

// ── Panel projection ────────────────────────────────────────────────────────

export interface NotificationCenterGroups {
  approval: NotificationCenterRow[]
  automation: NotificationCenterRow[]
  system: NotificationCenterRow[]
}

/** Pure panel projection: pushed entries grouped + every derived row joined. */
export function centerGroups(
  entries: readonly NotificationCenterEntry[],
  derived: {
    approval: NotificationCenterRow[]
    automation: NotificationCenterRow[]
    system: NotificationCenterRow[]
  },
  readIds: ReadonlySet<string>
): NotificationCenterGroups {
  const byGroup: NotificationCenterGroups = { approval: [], automation: [], system: [] }

  for (const entry of entries) {
    byGroup[entry.group].push({
      id: entry.id,
      group: entry.group,
      title: entry.title,
      body: entry.body,
      at: entry.at,
      sessionId: entry.sessionId,
      read: readIds.has(entry.id)
    })
  }

  return {
    // Derived rows (approval/cron) honor the read markers too — marking a cron
    // run read keeps it muted until its state resolves.
    approval: [...derived.approval, ...byGroup.approval],
    automation: [
      ...derived.automation.map(row => ({ ...row, read: readIds.has(row.id) })),
      ...byGroup.automation
    ],
    system: [...derived.system, ...byGroup.system]
  }
}

// ── Reactivity ──────────────────────────────────────────────────────────────

export const $centerApprovalRows = computed($traySnapshot, snapshot => approvalRowsFrom(snapshot.needsInput))

export const $centerAutomationRows = computed([$unreadFinishedSessionIds, $cronSessions], (unreadFinished, cronSessions) =>
  automationRowsFrom(unreadFinished, cronSessions)
)

export const $centerSystemRows = computed([$quickCaptureNotes, $notificationCenterReadIds], (notes, readIds) =>
  systemRowsFrom(notes, readIds)
)

export const $centerGroups = computed(
  [$notificationEntries, $centerApprovalRows, $centerAutomationRows, $centerSystemRows, $notificationCenterReadIds],
  (entries, approval, automation, system, readIds) => centerGroups(entries, { approval, automation, system }, readIds)
)

/** Unread badge, per group. Derived rows (approval/cron) are always-unread BY
 *  DEFINITION — they disappear the moment their state resolves, so their count
 *  is their existence, not a marker. The approval count IS
 *  `$trayCounts.needsInput` (same rows through `$traySnapshot`), so the badge
 *  and the tray dot can never disagree. */
export const $notificationCenterUnread = computed($centerGroups, groups => {
  const approval = groups.approval.length
  const automation = groups.automation.filter(row => !row.read).length
  const system = groups.system.filter(row => !row.read).length

  return { approval, automation, system, total: approval + automation + system }
})

// ── Bridge to the pushed feed (main → renderer) ─────────────────────────────

interface NotificationCenterBridge {
  onEntry?: (callback: (entry: NotificationCenterEntry) => void) => () => void
}

function centerBridge(): NotificationCenterBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return (window.fulilianDesktop as unknown as { notificationCenter?: NotificationCenterBridge } | undefined)
    ?.notificationCenter
}

/** Wire the pushed feed. Idempotent-safe; returns a disposer (tests/teardown).
 *  Malformed payloads are dropped — the feed is decoration, never trusted. */
export function startNotificationCenterFeed(): () => void {
  const bridge = centerBridge()

  if (!bridge?.onEntry) {
    return () => undefined
  }

  return bridge.onEntry(entry => {
    if (
      entry &&
      typeof entry.id === 'string' &&
      typeof entry.title === 'string' &&
      typeof entry.body === 'string' &&
      typeof entry.at === 'number' &&
      (entry.group === 'approval' || entry.group === 'automation' || entry.group === 'system')
    ) {
      ingestNotificationEntry(entry)
    }
  })
}

// ── 更新 (updates) end-to-end seam ──────────────────────────────────────────
//
// The update pipeline already streams progress to every renderer over
// `fulilianDesktop.updates.onProgress` (store/updates.ts subscribes for the
// apply-overlay). T15 adds a SECOND, read-only consumer here: terminal stages
// land in the center as system-group rows so an update that finished (or
// failed / needs a manual `fulilian update`) outlives its toast. The
// progress-feed semantics in store/updates.ts are untouched — mirroring the
// main-process double-write discipline on the renderer side.

interface UpdateProgressLike {
  at?: number
  error?: null | string
  message?: string
  stage?: string
}

const UPDATE_TERMINAL_STAGES = new Set(['done', 'error', 'guiSkew', 'manual', 'restart'])

/** Project an update-progress push onto a center entry. Non-terminal stages
 *  return null (live progress stays in the apply overlay, not the bell). */
export function updateProgressToEntry(payload: UpdateProgressLike): NotificationCenterEntry | null {
  const stage = typeof payload?.stage === 'string' ? payload.stage : ''

  if (!UPDATE_TERMINAL_STAGES.has(stage)) {
    return null
  }

  return {
    at: typeof payload?.at === 'number' ? payload.at : Date.now(),
    body: typeof payload?.message === 'string' ? payload.message : '',
    group: 'system',
    id: `update:${stage}:${typeof payload?.at === 'number' ? payload.at : Date.now()}`,
    title: stage === 'error' ? payload?.error || payload?.message || stage : payload?.message || stage
  }
}

/** Subscribe the update stream into the center. Returns a disposer. */
export function startNotificationCenterUpdateFeed(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const onProgress = (window.fulilianDesktop as unknown as
    | { updates?: { onProgress?: (cb: (payload: UpdateProgressLike) => void) => () => void } }
    | undefined)?.updates?.onProgress

  if (!onProgress) {
    return () => undefined
  }

  return onProgress(payload => {
    const entry = updateProgressToEntry(payload)

    if (entry) {
      ingestNotificationEntry(entry)
    }
  })
}
