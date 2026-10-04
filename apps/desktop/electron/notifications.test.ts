/**
 * Unit tests for the extracted system-notification module (T12 first cut).
 *
 * main.ts registers the handler these helpers build; the renderer contract
 * (IPC channel names, return values, dedupe window, click/action branches)
 * must stay stable. Everything Electron-specific is faked here so the module
 * can be exercised without booting a BrowserWindow or the Electron runtime.
 */

import assert from 'node:assert/strict'

import { beforeEach, describe, test } from 'vitest'

import {
  buildNotificationOptions,
  createNotifyHandler,
  notificationDedupeKey,
  type NotifyOptions,
  type NotifyWindow
} from './notifications'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Records every Notification constructed through the injected ctor. */
class FakeNotification {
  static instances: FakeNotification[] = []

  options: NotifyOptions
  shown = false
  private listeners: Record<string, Array<(...args: any[]) => void>> = { click: [], action: [] }

  constructor(options: NotifyOptions) {
    this.options = options
    FakeNotification.instances.push(this)
  }

  on(event: string, listener: (...args: any[]) => void) {
    ;(this.listeners[event] ??= []).push(listener)
  }

  show() {
    this.shown = true
  }

  emitClick() {
    for (const listener of this.listeners.click) {
      listener()
    }
  }

  emitAction(index: number) {
    for (const listener of this.listeners.action) {
      listener(undefined, index)
    }
  }
}

interface SentCall {
  channel: string
  args: unknown[]
}

function makeWindow() {
  const sent: SentCall[] = []
  const focused: NotifyWindow[] = []
  let destroyed = false

  const win: NotifyWindow = {
    isDestroyed: () => destroyed,
    webContents: {
      send(channel: string, ...args: unknown[]) {
        sent.push({ channel, args })
      }
    }
  }

  return {
    sent,
    focused,
    win,
    destroy() {
      destroyed = true
    }
  }
}

function makeHandler(
  overrides: {
    isSupported?: () => boolean
    getMainWindow?: () => NotifyWindow | null | undefined
    focusWindow?: (win: NotifyWindow) => void
  } = {}
) {
  const focused: NotifyWindow[] = []

  const handler = createNotifyHandler({
    isSupported: overrides.isSupported ?? (() => true),
    getMainWindow: overrides.getMainWindow ?? (() => null),
    focusWindow:
      overrides.focusWindow ??
      (win => {
        focused.push(win)
      }),
    NotificationCtor: FakeNotification
  })

  return { handler, focused }
}

beforeEach(() => {
  FakeNotification.instances = []
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('notificationDedupeKey', () => {
  test('joins kind and sessionId with a colon', () => {
    assert.equal(notificationDedupeKey({ kind: 'input', sessionId: 's1' }), 'input:s1')
  })

  test('falls back to tag when there is no sessionId', () => {
    assert.equal(notificationDedupeKey({ kind: 'plugin', tag: 't1' }), 'plugin:t1')
  })

  test('prefers sessionId over tag when both are present', () => {
    assert.equal(notificationDedupeKey({ kind: 'k', sessionId: 's', tag: 't' }), 'k:s')
  })

  test('empty / nullish payload collapses to a bare colon', () => {
    assert.equal(notificationDedupeKey({}), ':')
    assert.equal(notificationDedupeKey(null), ':')
    assert.equal(notificationDedupeKey(undefined), ':')
  })
})

describe('buildNotificationOptions', () => {
  test('defaults title to Fulilian, body to empty, silent to false', () => {
    const options = buildNotificationOptions({})
    assert.equal(options.title, 'Fulilian')
    assert.equal(options.body, '')
    assert.equal(options.silent, false)
  })

  test('coerces silent to a boolean', () => {
    assert.equal(buildNotificationOptions({ silent: 1 as unknown as boolean }).silent, true)
    assert.equal(buildNotificationOptions({ silent: 0 as unknown as boolean }).silent, false)
  })

  test('honours an explicit title and body', () => {
    const options = buildNotificationOptions({ title: 'Build done', body: 'all green' })
    assert.equal(options.title, 'Build done')
    assert.equal(options.body, 'all green')
  })

  test('omits icon when blank or not a string', () => {
    assert.equal('icon' in buildNotificationOptions({ icon: '   ' }), false)
    assert.equal('icon' in buildNotificationOptions({ icon: 42 as unknown as string }), false)
    assert.equal('icon' in buildNotificationOptions({}), false)
  })

  test('includes a trimmed icon when it is a non-blank string', () => {
    assert.equal(buildNotificationOptions({ icon: '  /a/b.png  ' }).icon, '/a/b.png')
  })

  test('treats a non-array actions field as empty', () => {
    assert.deepEqual(buildNotificationOptions({ actions: 'nope' as unknown as [] }).actions, [])
    assert.deepEqual(buildNotificationOptions({}).actions, [])
  })

  test('maps actions to button entries with a stringified text', () => {
    assert.deepEqual(buildNotificationOptions({ actions: [{ text: 'Allow' }, { text: 7 as unknown as string }] }).actions, [
      { type: 'button', text: 'Allow' },
      { type: 'button', text: '7' }
    ])
  })
})

// ---------------------------------------------------------------------------
// Handler: gate + dedupe
// ---------------------------------------------------------------------------

describe('createNotifyHandler — support gate', () => {
  test('returns false and never constructs a notification when unsupported', () => {
    const { handler } = makeHandler({ isSupported: () => false })
    assert.equal(handler({ title: 'x' }), false)
    assert.equal(FakeNotification.instances.length, 0)
  })
})

describe('createNotifyHandler — de-duplication', () => {
  test('first call shows a notification and returns true', () => {
    const { handler } = makeHandler()
    assert.equal(handler({ kind: 'input', sessionId: 's1' }), true)
    assert.equal(FakeNotification.instances.length, 1)
    assert.equal(FakeNotification.instances[0].shown, true)
  })

  test('a repeat of the same key inside the window returns true but is collapsed', () => {
    const { handler } = makeHandler()
    assert.equal(handler({ kind: 'input', sessionId: 's1' }), true)
    assert.equal(handler({ kind: 'input', sessionId: 's1' }), true)
    assert.equal(FakeNotification.instances.length, 1, 'second identical event must not re-notify')
  })

  test('distinct keys are independent', () => {
    const { handler } = makeHandler()
    assert.equal(handler({ kind: 'input', sessionId: 's1' }), true)
    assert.equal(handler({ kind: 'input', sessionId: 's2' }), true)
    assert.equal(handler({ kind: 'approval', sessionId: 's1' }), true)
    assert.equal(FakeNotification.instances.length, 3)
  })
})

// ---------------------------------------------------------------------------
// Handler: click callback
// ---------------------------------------------------------------------------

describe('createNotifyHandler — click', () => {
  test('does not throw and sends nothing when there is no window', () => {
    const { handler } = makeHandler({ getMainWindow: () => null })
    handler({ kind: 'k', sessionId: 's1' })
    assert.doesNotThrow(() => FakeNotification.instances[0].emitClick())
  })

  test('does not throw and sends nothing when the window is destroyed', () => {
    const { handler } = makeHandler()
    handler({ kind: 'k', sessionId: 's1' })
    // window accessor returns a destroyed window
    const destroyed: NotifyWindow = { isDestroyed: () => true, webContents: { send: () => {} } }
    const { handler: handler2 } = makeHandler({ getMainWindow: () => destroyed })
    handler2({ kind: 'k2', sessionId: 's2' })
    assert.doesNotThrow(() => FakeNotification.instances[1].emitClick())
  })

  test('focuses the window and sends focus-session when a sessionId is present', () => {
    const w = makeWindow()
    const { handler, focused } = makeHandler({ getMainWindow: () => w.win })
    handler({ kind: 'k', sessionId: 's9' })
    FakeNotification.instances[0].emitClick()
    assert.deepEqual(focused, [w.win])
    assert.deepEqual(w.sent, [{ channel: 'fulilian:focus-session', args: ['s9'] }])
  })

  test('sends notification-activate when activate / notifyId are present', () => {
    const w = makeWindow()
    const { handler } = makeHandler({ getMainWindow: () => w.win })
    handler({ kind: 'k', activate: true, notifyId: 'n1', tag: 't' })
    FakeNotification.instances[0].emitClick()
    assert.deepEqual(w.sent, [
      { channel: 'fulilian:notification-activate', args: [{ activate: true, notifyId: 'n1', tag: 't' }] }
    ])
  })

  test('sends both focus-session and notification-activate when both apply', () => {
    const w = makeWindow()
    const { handler } = makeHandler({ getMainWindow: () => w.win })
    handler({ kind: 'k', sessionId: 's1', activate: true, notifyId: 'n1', tag: 't' })
    FakeNotification.instances[0].emitClick()
    assert.deepEqual(w.sent, [
      { channel: 'fulilian:focus-session', args: ['s1'] },
      { channel: 'fulilian:notification-activate', args: [{ activate: true, notifyId: 'n1', tag: 't' }] }
    ])
  })

  test('a session-only click does not emit notification-activate', () => {
    const w = makeWindow()
    const { handler } = makeHandler({ getMainWindow: () => w.win })
    handler({ kind: 'k', sessionId: 's1' })
    FakeNotification.instances[0].emitClick()
    assert.equal(w.sent.some(call => call.channel === 'fulilian:notification-activate'), false)
  })
})

// ---------------------------------------------------------------------------
// Handler: action callback
// ---------------------------------------------------------------------------

describe('createNotifyHandler — action', () => {
  test('ignores an action index whose entry has no id', () => {
    const w = makeWindow()
    const { handler } = makeHandler({ getMainWindow: () => w.win })
    handler({ kind: 'k', sessionId: 's1', actions: [{ text: 'no id' }] })
    FakeNotification.instances[0].emitAction(0)
    assert.equal(w.sent.length, 0)
  })

  test('ignores an out-of-range action index', () => {
    const w = makeWindow()
    const { handler } = makeHandler({ getMainWindow: () => w.win })
    handler({ kind: 'k', sessionId: 's1', actions: [{ id: 'a1', text: 'A' }] })
    FakeNotification.instances[0].emitAction(5)
    assert.equal(w.sent.length, 0)
  })

  test('session-scoped action uses fulilian:notification-action and does not focus', () => {
    const w = makeWindow()
    const { handler, focused } = makeHandler({ getMainWindow: () => w.win })
    handler({ kind: 'k', sessionId: 's1', actions: [{ id: 'a1', text: 'Allow' }] })
    FakeNotification.instances[0].emitAction(0)
    assert.deepEqual(w.sent, [{ channel: 'fulilian:notification-action', args: [{ sessionId: 's1', actionId: 'a1' }] }])
    assert.deepEqual(focused, [], 'the session-scoped branch returns before focusing')
  })

  test('activation-scoped action focuses and uses fulilian:notification-activate', () => {
    const w = makeWindow()
    const { handler, focused } = makeHandler({ getMainWindow: () => w.win })
    handler({ kind: 'k', notifyId: 'n2', actions: [{ id: 'a2', text: 'Open', activate: true }] })
    FakeNotification.instances[0].emitAction(0)
    assert.deepEqual(focused, [w.win])
    assert.deepEqual(w.sent, [
      {
        channel: 'fulilian:notification-activate',
        args: [{ actionId: 'a2', activate: true, notifyId: 'n2', tag: undefined }]
      }
    ])
  })

  test('sessionId with a notifyId falls through to the activate branch', () => {
    const w = makeWindow()
    const { handler } = makeHandler({ getMainWindow: () => w.win })
    handler({ kind: 'k', sessionId: 's1', notifyId: 'n3', actions: [{ id: 'a3', text: 'Go' }] })
    FakeNotification.instances[0].emitAction(0)
    assert.deepEqual(w.sent, [
      {
        channel: 'fulilian:notification-activate',
        args: [{ actionId: 'a3', activate: undefined, notifyId: 'n3', tag: undefined }]
      }
    ])
  })

  test('action does not throw when there is no window', () => {
    const { handler } = makeHandler({ getMainWindow: () => null })
    handler({ kind: 'k', sessionId: 's1', actions: [{ id: 'a1', text: 'A' }] })
    assert.doesNotThrow(() => FakeNotification.instances[0].emitAction(0))
  })
})
