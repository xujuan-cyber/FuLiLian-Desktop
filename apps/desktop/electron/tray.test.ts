import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, test } from 'vitest'

import {
  buildTrayMenuModel,
  CLOSE_TO_TRAY_DEFAULT,
  composeTrayIcon,
  createDesktopTray,
  type DesktopTrayOptions,
  EMPTY_TRAY_LABELS,
  EMPTY_TRAY_SNAPSHOT,
  IDLE_TRAY_QUIT_STATE,
  normalizeTrayStatePayload,
  readCloseToTrayPreference,
  shouldMinimizeOnClose,
  TRAY_ACCELERATORS,
  TRAY_CLOSE_TO_TRAY_CHANNEL,
  TRAY_STATE_CHANNEL,
  TRAY_TONE_CHANNELS,
  type TrayActions,
  type TrayElectronLike,
  type TrayImageFactory,
  type TrayImageLike,
  type TrayLike,
  type TrayMenuItemTemplate,
  type TrayMenuModelItem,
  type TrayStatePayload,
  writeCloseToTrayPreference
} from './tray'

type HeadingItem = Extract<TrayMenuModelItem, { type: 'heading' }>
type NewSessionItem = Extract<TrayMenuModelItem, { type: 'new-session' }>
type OpenMainItem = Extract<TrayMenuModelItem, { type: 'open-main' }>
type QuitItem = Extract<TrayMenuModelItem, { type: 'quit' }>
type SessionItem = Extract<TrayMenuModelItem, { type: 'session' }>

const isHeading = (item: TrayMenuModelItem): item is HeadingItem => item.type === 'heading'
const isNewSession = (item: TrayMenuModelItem): item is NewSessionItem => item.type === 'new-session'
const isOpenMain = (item: TrayMenuModelItem): item is OpenMainItem => item.type === 'open-main'
const isQuit = (item: TrayMenuModelItem): item is QuitItem => item.type === 'quit'
const isSession = (item: TrayMenuModelItem): item is SessionItem => item.type === 'session'

const row = (id: string, title = id) => ({ id, title })

// ── Menu model ──────────────────────────────────────────────────────────────

describe('buildTrayMenuModel', () => {
  test('orders the fixed entries and carries the three mode kinds + copy keys', () => {
    const model = buildTrayMenuModel(EMPTY_TRAY_SNAPSHOT)

    assert.deepEqual(
      model.map(item => item.type),
      ['new-session', 'new-session', 'new-session', 'separator', 'open-main', 'separator', 'quit']
    )

    const newTasks = model.filter(isNewSession)

    assert.deepEqual(
      newTasks.map(item => [item.labelKey, item.sessionKind, item.accelerator]),
      [
        ['newForensics', 'forensics', TRAY_ACCELERATORS.newForensics],
        ['newCtf', 'ctf', TRAY_ACCELERATORS.newCtf],
        ['newProject', 'project', TRAY_ACCELERATORS.newProject]
      ]
    )

    const openMain = model.find(isOpenMain)
    const quit = model.find(isQuit)

    assert.equal(openMain?.labelKey, 'openMainWindow')
    assert.equal(openMain?.accelerator, TRAY_ACCELERATORS.openMainWindow)
    assert.equal(quit?.labelKey, 'quit')
  })

  test('empty snapshot renders no group heading and no fabricated row', () => {
    const model = buildTrayMenuModel(EMPTY_TRAY_SNAPSHOT)

    assert.equal(model.some(isHeading), false)
    assert.equal(model.some(isSession), false)
    // No two separators in a row, even with both groups empty.
    assert.equal(
      model.some((item, index) => item.type === 'separator' && model[index - 1]?.type === 'separator'),
      false
    )
  })

  test('group headings carry the injected counts and only render for non-empty groups', () => {
    const model = buildTrayMenuModel({ needsInput: [row('n1')], running: [row('r1'), row('r2')] })

    assert.deepEqual(
      model.filter(isHeading).map(item => [item.labelKey, item.count]),
      [
        ['runningHeading', 2],
        ['needsInputHeading', 1]
      ]
    )

    assert.deepEqual(
      model.filter(isSession).map(item => [item.group, item.sessionId]),
      [
        ['running', 'r1'],
        ['running', 'r2'],
        ['needs-input', 'n1']
      ]
    )

    // Needs-input only: the running heading must not appear.
    const keys = buildTrayMenuModel({ needsInput: [row('n1')], running: [] })
      .filter(isHeading)
      .map(item => item.labelKey)

    assert.deepEqual(keys, ['needsInputHeading'])
  })

  test('session rows keep the title verbatim so the menu never invents one', () => {
    const session = buildTrayMenuModel({ needsInput: [], running: [row('r1', '修复构建回归基线')] }).find(isSession)

    assert.equal(session?.title, '修复构建回归基线')
  })
})

describe('normalizeTrayStatePayload', () => {
  test('degrades a malformed payload to the empty snapshot + fallback labels', () => {
    assert.deepEqual(normalizeTrayStatePayload(null), { ...EMPTY_TRAY_SNAPSHOT, labels: EMPTY_TRAY_LABELS })
    assert.deepEqual(normalizeTrayStatePayload('nope'), { ...EMPTY_TRAY_SNAPSHOT, labels: EMPTY_TRAY_LABELS })
  })

  test('keeps valid rows and drops entries with no usable id', () => {
    const payload = normalizeTrayStatePayload({
      labels: { quit: 'Quit!' },
      needsInput: [{ id: 'n1', title: 'Needs' }, { title: 'no id' }, 42],
      running: [{ id: 'r1' }]
    })

    assert.deepEqual(payload.running, [{ id: 'r1', title: '' }])
    assert.deepEqual(payload.needsInput, [{ id: 'n1', title: 'Needs' }])
    assert.equal(payload.labels.quit, 'Quit!')
    // Untranslated keys keep the English fallback rather than blanking the menu.
    assert.equal(payload.labels.openMainWindow, EMPTY_TRAY_LABELS.openMainWindow)
  })
})

// ── Aggregate indicator ─────────────────────────────────────────────────────

const fakeImage = (width: number, height: number, bitmap: Buffer = Buffer.alloc(width * height * 4)): TrayImageLike => ({
  getSize: () => ({ height, width }),
  isEmpty: () => width === 0 || height === 0,
  toBitmap: () => Buffer.from(bitmap)
})

const bitmapFactory: Pick<TrayImageFactory, 'createFromBitmap'> = {
  createFromBitmap: (buffer, options) => fakeImage(options.width, options.height, buffer)
}

describe('composeTrayIcon', () => {
  test('paints the 6px running dot into the bottom-right corner only', () => {
    const base = fakeImage(16, 16)
    const bitmap = composeTrayIcon(base, 'running', bitmapFactory).toBitmap()
    const { b, g, r } = TRAY_TONE_CHANNELS.running
    const offset = (11 * 16 + 11) * 4

    assert.deepEqual([bitmap[offset], bitmap[offset + 1], bitmap[offset + 2], bitmap[offset + 3]], [b, g, r, 0xff])
    assert.deepEqual([bitmap[0], bitmap[1], bitmap[2], bitmap[3]], [0, 0, 0, 0])
    // The base is left untouched — the composition returns a new image.
    assert.deepEqual(base.toBitmap(), Buffer.alloc(16 * 16 * 4))
  })

  test('needs-input paints the amber channel set', () => {
    const bitmap = composeTrayIcon(fakeImage(16, 16), 'needs-input', bitmapFactory).toBitmap()
    const offset = (11 * 16 + 11) * 4
    const { b, g, r } = TRAY_TONE_CHANNELS['needs-input']

    assert.deepEqual([bitmap[offset], bitmap[offset + 1], bitmap[offset + 2]], [b, g, r])
  })

  test('idle and an empty base are returned unchanged', () => {
    const base = fakeImage(16, 16)

    assert.equal(composeTrayIcon(base, 'idle', bitmapFactory), base)

    const empty = fakeImage(0, 0)

    assert.equal(composeTrayIcon(empty, 'running', bitmapFactory), empty)
  })
})

// ── Close interception ──────────────────────────────────────────────────────

describe('shouldMinimizeOnClose', () => {
  test('hides when the preference is on and no quit is in flight', () => {
    assert.equal(shouldMinimizeOnClose(true, IDLE_TRAY_QUIT_STATE), true)
  })

  test('does not intercept when the preference is off', () => {
    assert.equal(shouldMinimizeOnClose(false, IDLE_TRAY_QUIT_STATE), false)
  })

  test('does not intercept during a hand-off relaunch (hard red line)', () => {
    assert.equal(shouldMinimizeOnClose(true, { ...IDLE_TRAY_QUIT_STATE, quittingForHandoff: true }), false)
  })

  test('does not intercept a real quit', () => {
    assert.equal(shouldMinimizeOnClose(true, { ...IDLE_TRAY_QUIT_STATE, quitting: true }), false)
  })

  test('does not intercept while the active-work confirmation is up', () => {
    assert.equal(shouldMinimizeOnClose(true, { ...IDLE_TRAY_QUIT_STATE, quitInProgress: true }), false)
  })
})

// ── Preference persistence ──────────────────────────────────────────────────

describe('close-to-tray preference', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-pref-'))
  const file = path.join(dir, 'close-to-tray.json')

  test('defaults to on when the file is missing or malformed', () => {
    assert.equal(readCloseToTrayPreference(file), CLOSE_TO_TRAY_DEFAULT)

    fs.writeFileSync(file, '{not json', 'utf8')
    assert.equal(readCloseToTrayPreference(file), CLOSE_TO_TRAY_DEFAULT)
  })

  test('round-trips an explicit off', () => {
    writeCloseToTrayPreference(file, false)
    assert.equal(readCloseToTrayPreference(file), false)

    writeCloseToTrayPreference(file, true)
    assert.equal(readCloseToTrayPreference(file), true)
  })
})

// ── Runtime controller ──────────────────────────────────────────────────────

class FakeTray implements TrayLike {
  static instances: FakeTray[] = []

  clickListeners: Array<() => void> = []
  contextMenus: TrayMenuItemTemplate[][] = []
  destroyed = 0
  images: TrayImageLike[] = []
  tooltips: string[] = []

  constructor(public image: TrayImageLike) {
    FakeTray.instances.push(this)
  }

  destroy() {
    this.destroyed += 1
  }

  on(_event: 'click', listener: () => void) {
    this.clickListeners.push(listener)

    return this
  }

  setContextMenu(menu: unknown) {
    this.contextMenus.push(menu as TrayMenuItemTemplate[])
  }

  setImage(image: TrayImageLike) {
    this.images.push(image)
  }

  setToolTip(tip: string) {
    this.tooltips.push(tip)
  }
}

function createHarness() {
  FakeTray.instances = []

  const calls: Array<[string, unknown]> = []

  const actions: TrayActions = {
    focusSession: id => calls.push(['focusSession', id]),
    newSession: kind => calls.push(['newSession', kind]),
    openMainWindow: () => calls.push(['openMainWindow', undefined]),
    quit: () => calls.push(['quit', undefined])
  }

  const listeners = new Map<string, (event: unknown, payload: unknown) => void>()

  const nativeImage: TrayImageFactory = {
    createEmpty: () => fakeImage(0, 0),
    createFromBitmap: (buffer, options) => fakeImage(options.width, options.height, buffer),
    createFromPath: () => fakeImage(16, 16)
  }

  const electron: TrayElectronLike = {
    Menu: { buildFromTemplate: template => template },
    Tray: FakeTray,
    nativeImage
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-ctl-'))
  const closeToTrayPath = path.join(dir, 'close-to-tray.json')

  const options: DesktopTrayOptions = {
    actions,
    closeToTrayPath,
    electron,
    hideWindow: () => calls.push(['hideWindow', undefined]),
    iconPath: '/icons/app.png',
    ipc: {
      on(channel, listener) {
        listeners.set(channel, listener)
      }
    },
    quitState: () => IDLE_TRAY_QUIT_STATE
  }

  const latest = () => FakeTray.instances[FakeTray.instances.length - 1]

  return {
    calls,
    closeToTrayPath,
    electron,
    options,
    emit: (channel: string, payload: unknown) => listeners.get(channel)?.(null, payload),
    latest,
    template: (): TrayMenuItemTemplate[] => latest().contextMenus[latest().contextMenus.length - 1] ?? []
  }
}

const clickItem = (template: TrayMenuItemTemplate[], label: string) => {
  const item = template.find(entry => entry.label === label)

  assert.ok(item, `menu item "${label}" missing`)

  item.click?.()
}

describe('createDesktopTray', () => {
  test('left-clicking the tray icon opens/focuses the main window', () => {
    const harness = createHarness()

    createDesktopTray(harness.options)

    const tray = harness.latest()

    assert.equal(tray.clickListeners.length, 1)
    tray.clickListeners[0]()
    assert.deepEqual(harness.calls, [['openMainWindow', undefined]])
  })

  test('the three new-task items fire their own kind', () => {
    const harness = createHarness()

    createDesktopTray(harness.options)

    const template = harness.template()

    clickItem(template, EMPTY_TRAY_LABELS.newForensics)
    clickItem(template, EMPTY_TRAY_LABELS.newCtf)
    clickItem(template, EMPTY_TRAY_LABELS.newProject)

    assert.deepEqual(harness.calls, [
      ['newSession', 'forensics'],
      ['newSession', 'ctf'],
      ['newSession', 'project']
    ])
  })

  test('a pushed snapshot drives the group rows, counts and the quit/open items', () => {
    const harness = createHarness()

    createDesktopTray(harness.options)

    const payload: TrayStatePayload = {
      labels: { ...EMPTY_TRAY_LABELS, needsInputHeading: '需输入', openMainWindow: '打开主窗口', quit: '退出' },
      needsInput: [row('n1', 'HUBLAB · 流量分析')],
      running: [row('r1', '2026-0142 网络入侵取证'), row('r2', 'DEV-B: 修复构建回归基线')]
    }

    harness.emit(TRAY_STATE_CHANNEL, payload)

    const template = harness.template()

    assert.ok(template.some(item => item.label === 'Running · 2'))
    assert.ok(template.some(item => item.label === '需输入 · 1'))
    assert.ok(template.some(item => item.label === '打开主窗口' && item.enabled !== false))
    assert.ok(template.some(item => item.label === '退出'))

    clickItem(template, '2026-0142 网络入侵取证')
    clickItem(template, 'HUBLAB · 流量分析')
    clickItem(template, '打开主窗口')
    clickItem(template, '退出')

    assert.deepEqual(harness.calls, [
      ['focusSession', 'r1'],
      ['focusSession', 'n1'],
      ['openMainWindow', undefined],
      ['quit', undefined]
    ])
  })

  test('a malformed push falls back to the honest empty menu', () => {
    const harness = createHarness()

    createDesktopTray(harness.options)
    harness.emit(TRAY_STATE_CHANNEL, { garbage: true })

    const template = harness.template()

    assert.equal(
      template.some(item => item.label?.includes('Running')),
      false
    )
    assert.equal(
      template.some(item => item.label === EMPTY_TRAY_LABELS.quit),
      true
    )
  })

  test('the close-to-tray IPC persists the preference and gates interception', () => {
    const harness = createHarness()
    const tray = createDesktopTray(harness.options)

    assert.equal(tray.shouldMinimizeOnClose(), true)

    harness.emit(TRAY_CLOSE_TO_TRAY_CHANNEL, false)
    assert.equal(tray.shouldMinimizeOnClose(), false)
    assert.equal(readCloseToTrayPreference(harness.closeToTrayPath), false)

    harness.emit(TRAY_CLOSE_TO_TRAY_CHANNEL, true)
    assert.equal(tray.shouldMinimizeOnClose(), true)
  })

  test('handleClose hides the window when enabled and stands down when off', () => {
    const harness = createHarness()
    const tray = createDesktopTray(harness.options)

    let prevented = 0

    assert.equal(tray.handleClose({ preventDefault: () => (prevented += 1) }), true)
    assert.equal(prevented, 1)
    assert.deepEqual(harness.calls, [['hideWindow', undefined]])

    harness.emit(TRAY_CLOSE_TO_TRAY_CHANNEL, false)
    assert.equal(tray.handleClose({ preventDefault: () => (prevented += 1) }), false)
    assert.equal(prevented, 1)
  })

  test('handleClose never intercepts while a real quit or hand-off is in flight', () => {
    const base = createHarness()

    const quitting = createDesktopTray({
      ...base.options,
      quitState: () => ({ ...IDLE_TRAY_QUIT_STATE, quitting: true })
    })

    const handoff = createDesktopTray({
      ...base.options,
      quitState: () => ({ ...IDLE_TRAY_QUIT_STATE, quittingForHandoff: true })
    })

    const guarded = createDesktopTray({
      ...base.options,
      quitState: () => ({ ...IDLE_TRAY_QUIT_STATE, quitInProgress: true })
    })

    let prevented = 0
    const event = { preventDefault: () => (prevented += 1) }

    assert.equal(quitting.handleClose(event), false)
    assert.equal(handoff.handleClose(event), false)
    assert.equal(guarded.handleClose(event), false)
    assert.equal(prevented, 0)
  })

  test('destroy tears the tray down and is idempotent', () => {
    const harness = createHarness()
    const tray = createDesktopTray(harness.options)

    tray.destroy()
    tray.destroy()

    assert.equal(harness.latest().destroyed, 2)
  })

  test('an undecodable icon degrades to an empty image instead of throwing', () => {
    const harness = createHarness()

    const electron: TrayElectronLike = {
      ...harness.electron,
      nativeImage: {
        ...harness.electron.nativeImage,
        createFromPath: () => {
          throw new Error('failed to load image')
        }
      }
    }

    const tray = createDesktopTray({ ...harness.options, electron })

    assert.equal(tray.shouldMinimizeOnClose(), true)
    assert.equal(harness.latest().image.isEmpty(), true)
  })
})
