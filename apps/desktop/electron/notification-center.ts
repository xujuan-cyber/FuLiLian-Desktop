// Notification-center double-write bridge (step 16 · T15, 方案 §5-T15).
//
// The renderer asks main to raise an OS notification over `fulilian:notify`;
// `notifications.ts` owns the dedupe + dispatch contract. T15 adds a SECOND
// WRITE PATH, not a second authority: after (and only after) a notification
// actually passes the existing gate + dedupe choke point, the same payload is
// mirrored to the notification center feed over `fulilian:notification-center`
// so the titlebar bell can show a persistent history. The OS-notification
// semantics — return values, dedupe window, click/action dispatch — are
// untouched; notifications.ts is not modified by T15 at all.
//
// Grouping table (方案 §5-T15: 需审批 / 自动化结果 / 系统; 宁缺勿假):
//   approval | input        → 'approval'   (审批、澄清、sudo、secret 请求)
//   backgroundDone | turnDone | turnError | credits | plugin → 'automation'
//   anything else           → 'system'     (unknown kinds degrade here)
//
// Like notifications.ts, everything Electron-specific is injected, so the
// mapping + fan-out is unit-testable without booting a BrowserWindow.

import { BrowserWindow } from 'electron'

import type { NotifyPayload } from './notifications'

/** The three 方案 §5-T15 groups an entry can land in. */
export type NotificationCenterGroup = 'approval' | 'automation' | 'system'

/** The record pushed to renderers over `fulilian:notification-center`. */
export interface NotificationCenterEntry {
  id: string
  group: NotificationCenterGroup
  title: string
  body: string
  at: number
  sessionId?: string
}

/** Minimal window surface the bridge fans out through. */
export interface NotificationCenterWindow {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

export interface NotificationCenterSinkDeps {
  /** Enumerate the windows to fan out to — injectable (tests pass a fake list). */
  getWindows?: () => NotificationCenterWindow[]
  /** Monotonic id source — injectable for tests. */
  nextId?: () => string
  /** Wall clock — injectable for tests. */
  now?: () => number
}

/** The main → renderer push channel. */
export const NOTIFICATION_CENTER_CHANNEL = 'fulilian:notification-center'

/** Map a notify payload onto a center group. Unknown kinds degrade to
 *  `system` (宁缺勿假 — never guess a group the event vocabulary doesn't name). */
export function groupForNotifyPayload(payload: NotifyPayload | null | undefined): NotificationCenterGroup {
  switch (payload?.kind) {
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

/** Build the double-write sink. The returned fn is called EXACTLY when the
 *  existing notify handler decided to show a notification (post-gate,
 *  post-dedupe) — main.ts wires it in one line without touching that flow. */
export function createNotificationCenterSink(deps: NotificationCenterSinkDeps = {}): (payload: NotifyPayload) => void {
  const getWindows = deps.getWindows ?? (() => BrowserWindow.getAllWindows())
  const nextId = deps.nextId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  const now = deps.now ?? (() => Date.now())

  return function recordNotification(payload) {
    const entry: NotificationCenterEntry = {
      at: now(),
      body: typeof payload?.body === 'string' ? payload.body : '',
      group: groupForNotifyPayload(payload),
      id: `nc:${nextId()}`,
      sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
      title: typeof payload?.title === 'string' && payload.title.trim() ? payload.title : 'Fulilian'
    }

    for (const win of getWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(NOTIFICATION_CENTER_CHANNEL, entry)
      }
    }
  }
}
