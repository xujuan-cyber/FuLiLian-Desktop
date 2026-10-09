// Unit tests for the notification-center double-write bridge (step 16 · T15).
//
// The bridge is a SECOND WRITE PATH off the existing `fulilian:notify`
// handler: it must map groups per the 方案 §5-T15 table, fan out to live
// windows only, and shape the wire entry exactly. The OS-notification
// contract itself lives in notifications.test.ts and is untouched here.

import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  createNotificationCenterSink,
  groupForNotifyPayload,
  NOTIFICATION_CENTER_CHANNEL,
  type NotificationCenterWindow
} from './notification-center'

class FakeWindow implements NotificationCenterWindow {
  sent: Array<{ channel: string; args: unknown[] }> = []
  destroyed = false

  get webContents() {
    const win = this

    return {
      send(channel: string, ...args: unknown[]) {
        win.sent.push({ args, channel })
      }
    }
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

describe('groupForNotifyPayload (方案 §5-T15 判据表)', () => {
  test('approval + input map to 需审批', () => {
    assert.equal(groupForNotifyPayload({ kind: 'approval' }), 'approval')
    assert.equal(groupForNotifyPayload({ kind: 'input' }), 'approval')
  })

  test('completion/plugin kinds map to 自动化结果', () => {
    for (const kind of ['backgroundDone', 'turnDone', 'turnError', 'credits', 'plugin']) {
      assert.equal(groupForNotifyPayload({ kind }), 'automation')
    }
  })

  test('unknown/absent kinds degrade to 系统 (宁缺勿假)', () => {
    assert.equal(groupForNotifyPayload({ kind: 'unheard-of' }), 'system')
    assert.equal(groupForNotifyPayload({}), 'system')
    assert.equal(groupForNotifyPayload(null), 'system')
  })
})

describe('createNotificationCenterSink', () => {
  test('fans the entry out to every live window on the center channel', () => {
    const winA = new FakeWindow()
    const winB = new FakeWindow()

    const sink = createNotificationCenterSink({
      getWindows: () => [winA, winB],
      nextId: () => 'id-1',
      now: () => 1_234
    })

    sink({ body: 'check the door', kind: 'approval', sessionId: 's1', title: 'Approval needed' })

    for (const win of [winA, winB]) {
      assert.equal(win.sent.length, 1)
      assert.equal(win.sent[0]!.channel, NOTIFICATION_CENTER_CHANNEL)
      assert.deepEqual(win.sent[0]!.args, [
        {
          at: 1_234,
          body: 'check the door',
          group: 'approval',
          id: 'nc:id-1',
          sessionId: 's1',
          title: 'Approval needed'
        }
      ])
    }
  })

  test('skips destroyed windows', () => {
    const dead = new FakeWindow()
    const alive = new FakeWindow()
    dead.destroyed = true

    const sink = createNotificationCenterSink({ getWindows: () => [dead, alive] })
    sink({ kind: 'turnDone', title: 'Done' })

    assert.equal(dead.sent.length, 0)
    assert.equal(alive.sent.length, 1)
  })

  test('defaults a blank title to the brand and coerces non-string fields', () => {
    const win = new FakeWindow()
    const sink = createNotificationCenterSink({ getWindows: () => [win], nextId: () => 'x', now: () => 7 })

    sink({ body: 42 as unknown as string, kind: 'input', sessionId: 5 as unknown as string, title: '  ' })

    assert.deepEqual(win.sent[0]!.args, [
      { at: 7, body: '', group: 'approval', id: 'nc:x', sessionId: undefined, title: 'Fulilian' }
    ])
  })

  test('update-stage replays ride the same sink shape (更新 → 系统)', () => {
    const win = new FakeWindow()
    const sink = createNotificationCenterSink({ getWindows: () => [win], nextId: () => 'u', now: () => 9 })

    // main.ts's emitUpdateProgress double-writes with kind 'updateStage'; the
    // grouping table has no dedicated case for it, so it degrades to 系统 —
    // an app update is a system-level event, not an automation result.
    sink({ body: 'rebuild complete', kind: 'updateStage', title: 'Fulilian update' })
    assert.equal((win.sent[0]!.args[0] as { group: string }).group, 'system')
    assert.equal((win.sent[0]!.args[0] as { body: string }).body, 'rebuild complete')
  })
})
