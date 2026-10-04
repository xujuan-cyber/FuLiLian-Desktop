// System-notification bridge for the desktop main process.
//
// The renderer asks main to raise an OS notification over the
// `fulilian:notify` IPC channel. Main is the single choke point every window
// shares, so it also owns cross-window de-duplication (see event-dedupe.ts):
// two full windows each run their own renderer-side throttle and can deliver
// the same kind+session twice — the first window to claim the key wins.
//
// Extracted from main.ts (T12 "progressive split", first cut). Every
// Electron-specific bit is injected — `isSupported`, the Notification
// constructor, the window accessor and `focusWindow` — so the option shaping,
// de-dupe key assembly and click/action dispatch are unit-testable without
// booting a BrowserWindow. main.ts keeps only the wiring (import + one
// ipcMain.handle).
//
// This is a byte-for-byte port: IPC channel names, return values, the dedupe
// window and every callback branch are preserved exactly.

import { createEventDeduper } from './event-dedupe'

/** Action button carried on a `fulilian:notify` payload. */
export interface NotifyAction {
  id?: string
  text?: string
  activate?: boolean
}

/** Renderer-supplied shape for the `fulilian:notify` channel. */
export interface NotifyPayload {
  kind?: string
  sessionId?: string
  tag?: string
  title?: string
  body?: string
  silent?: boolean
  icon?: string
  actions?: NotifyAction[]
  activate?: boolean
  notifyId?: string
}

/** Options handed to the injected Notification constructor. */
export interface NotifyOptions {
  title: string
  body: string
  silent: boolean
  icon?: string
  actions: Array<{ type: 'button'; text: string }>
}

/** Minimal Notification instance surface this module touches. */
export interface NotifyInstance {
  on(event: string, listener: (...args: any[]) => void): unknown
  show(): void
}

/** Minimal BrowserWindow surface the click/action callbacks touch. */
export interface NotifyWindow {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

/** Constructor injected by main.ts (the real `Notification` class). */
export type NotifyFactory = new (options: NotifyOptions) => NotifyInstance

export interface NotifyHandlerDeps {
  isSupported: () => boolean
  getMainWindow: () => NotifyWindow | null | undefined
  focusWindow: (win: NotifyWindow) => void
  NotificationCtor: NotifyFactory
  createDeduper?: () => (key: string) => boolean
}

/** Cross-window de-dupe key: kind + (sessionId | tag). */
function notificationDedupeKey(payload: NotifyPayload | null | undefined): string {
  return `${payload?.kind ?? ''}:${payload?.sessionId ?? payload?.tag ?? ''}`
}

/**
 * Project a renderer payload onto Electron's Notification options. Title/body
 * default to brand/empty; `icon` is only included when it's a non-blank string
 * (a blank icon would render a broken frame); actions are only read when the
 * renderer sent an array and are mapped to `button` entries. Pure — the unit
 * tests assert the exact wire shape.
 */
function buildNotificationOptions(payload: NotifyPayload | null | undefined): NotifyOptions {
  // Action buttons render only on signed macOS builds; elsewhere they're
  // dropped and the body click still works.
  const actions = Array.isArray(payload?.actions) ? payload.actions : []
  const icon = typeof payload?.icon === 'string' && payload.icon.trim() ? payload.icon.trim() : undefined

  return {
    title: payload?.title || 'Fulilian',
    body: payload?.body || '',
    silent: Boolean(payload?.silent),
    ...(icon ? { icon } : {}),
    actions: actions.map(action => ({ type: 'button' as const, text: String(action?.text || '') }))
  }
}

/**
 * Build the `fulilian:notify` handler. The returned function takes the
 * renderer payload (the `IpcMainInvokeEvent` is ignored by the caller) and
 * returns the boolean the renderer awaits.
 */
function createNotifyHandler(deps: NotifyHandlerDeps): (payload: NotifyPayload | null | undefined) => boolean {
  const { isSupported, getMainWindow, focusWindow, NotificationCtor, createDeduper = createEventDeduper } = deps

  // One deduper per handler — the choke point every window shares. Main
  // handles IPC serially, so the first window to claim a key wins with no race.
  const isDuplicateNotification = createDeduper()

  return function notify(payload) {
    if (!isSupported()) {
      return false
    }

    // Multiple full windows each run their own renderer throttle, so the same
    // kind+session can arrive here twice. Collapse it at this single choke
    // point. Return true (not false): a notification for the event IS being
    // shown by the first caller, so the settings "send test" success probe
    // stays honest.
    if (isDuplicateNotification(notificationDedupeKey(payload))) {
      return true
    }

    const actions = Array.isArray(payload?.actions) ? payload.actions : []

    const notification = new NotificationCtor(buildNotificationOptions(payload))

    notification.on('click', () => {
      const win = getMainWindow()

      if (!win || win.isDestroyed()) {
        return
      }

      focusWindow(win)

      if (payload?.sessionId) {
        win.webContents.send('fulilian:focus-session', payload.sessionId)
      }

      // Plugin / session-less activation — serializable path (+ optional
      // notifyId for renderer callbacks). Same vocabulary as
      // fulilian://index-network/….
      if (payload?.activate || payload?.notifyId) {
        win.webContents.send('fulilian:notification-activate', {
          activate: payload?.activate,
          notifyId: payload?.notifyId,
          tag: payload?.tag
        })
      }
    })

    notification.on('action', (_actionEvent, index) => {
      const win = getMainWindow()

      if (!win || win.isDestroyed()) {
        return
      }

      const action = actions[index]

      if (!action?.id) {
        return
      }

      // Approvals keep the existing session-scoped channel.
      if (payload?.sessionId && !payload?.notifyId && !payload?.activate) {
        win.webContents.send('fulilian:notification-action', { sessionId: payload.sessionId, actionId: action.id })

        return
      }

      focusWindow(win)
      win.webContents.send('fulilian:notification-activate', {
        actionId: action.id,
        activate: action.activate || payload?.activate,
        notifyId: payload?.notifyId,
        tag: payload?.tag
      })
    })

    notification.show()

    return true
  }
}

export { buildNotificationOptions, createNotifyHandler, notificationDedupeKey }
