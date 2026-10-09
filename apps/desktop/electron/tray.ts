// System tray + close-to-tray controller (step 16 · T6).
//
// The tray is the desktop's always-on surface: it carries the aggregate session
// status (running / needs-input), the three new-task entries, one row per live
// session, "open main window", and a REAL quit. The main window's close button
// hides to the tray instead of tearing the app down, unless the user turned
// that off — and never when the app is genuinely quitting (tray quit, Cmd-Q, or
// a hand-off relaunch), because hiding there would strand a detached
// updater/uninstaller spinning on a PID that never exits.
//
// Everything that can break a user is kept Electron-free and pure here:
//   - the menu MODEL (`buildTrayMenuModel`) — order, copy keys, group counts,
//     honest empty state (no fabricated rows);
//   - the payload normalizer (untrusted IPC from the renderer);
//   - the aggregate indicator tone + the native icon composition;
//   - the close-interception predicate (`shouldMinimizeOnClose`).
// The runtime controller (`createDesktopTray`) wires those to the real Tray /
// Menu / nativeImage, injected via `electron` so the unit tests drive a fake.
//
// Status vocabulary is shared with `src/components/status-dot.tsx`: running =
// `working` ∪ `stalled` (info blue), needs-input = `needs-input` (warning
// amber). The renderer owns the session-state map and pushes a snapshot; the
// main process is authoritative for the tray itself and never crashes when no
// window is left to push.

import fs from 'node:fs'
import path from 'node:path'

import { app, ipcMain, Menu, nativeImage, Tray } from 'electron'

// ── Menu copy ───────────────────────────────────────────────────────────────
// Keys, not strings: the main process has no i18n runtime, so the renderer
// pushes the resolved copy with each snapshot and the model only carries the
// key. The English table below is the last-resort fallback (a snapshot that
// arrives before the renderer's locale is ready).

export type TrayMenuLabelKey =
  | 'needsInputHeading'
  | 'newCtf'
  | 'newForensics'
  | 'newProject'
  | 'openMainWindow'
  | 'quit'
  | 'runningHeading'

export type TrayMenuLabels = Record<TrayMenuLabelKey, string>

export const EMPTY_TRAY_LABELS: TrayMenuLabels = {
  needsInputHeading: 'Needs input',
  newCtf: 'New CTF challenge',
  newForensics: 'New forensics case',
  newProject: 'New coding task',
  openMainWindow: 'Open main window',
  quit: 'Quit',
  runningHeading: 'Running'
}

// ── Session snapshot ────────────────────────────────────────────────────────

/** The three work-mode containers (DESIGN_PROPOSAL §4.1). The tray's new-task
 *  entries write the kind verbatim so the renderer's creation flow can key on
 *  it — no re-derivation here. */
export type TraySessionKind = 'ctf' | 'forensics' | 'project'

export interface TraySessionRow {
  id: string
  title: string
}

export interface TraySnapshot {
  needsInput: TraySessionRow[]
  running: TraySessionRow[]
}

export const EMPTY_TRAY_SNAPSHOT: TraySnapshot = { needsInput: [], running: [] }

/** What the renderer pushes: the aggregate plus the localized menu copy. */
export interface TrayStatePayload extends TraySnapshot {
  labels: TrayMenuLabels
}

/** Accelerators shown beside the fixed entries. Ctrl+1/2/3 match the
 *  new-task shortcuts the workbench keybind table documents. */
export const TRAY_ACCELERATORS = {
  newCtf: 'CommandOrControl+2',
  newForensics: 'CommandOrControl+1',
  newProject: 'CommandOrControl+3',
  openMainWindow: 'CommandOrControl+Shift+F'
} as const

// ── Menu model (pure) ───────────────────────────────────────────────────────

export type TrayMenuModelItem =
  | { type: 'separator' }
  | {
      accelerator: string
      labelKey: 'newCtf' | 'newForensics' | 'newProject'
      sessionKind: TraySessionKind
      type: 'new-session'
    }
  | { count: number; labelKey: 'needsInputHeading' | 'runningHeading'; type: 'heading' }
  | { group: 'needs-input' | 'running'; sessionId: string; title: string; type: 'session' }
  | { accelerator: string; labelKey: 'openMainWindow'; type: 'open-main' }
  | { labelKey: 'quit'; type: 'quit' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRows(raw: unknown): TraySessionRow[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const rows: TraySessionRow[] = []

  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) {
      continue
    }

    rows.push({ id: entry.id, title: typeof entry.title === 'string' ? entry.title : '' })
  }

  return rows
}

function normalizeLabels(raw: unknown): TrayMenuLabels {
  if (!isRecord(raw)) {
    return EMPTY_TRAY_LABELS
  }

  const labels = { ...EMPTY_TRAY_LABELS }

  for (const key of Object.keys(EMPTY_TRAY_LABELS) as TrayMenuLabelKey[]) {
    const value = raw[key]

    if (typeof value === 'string' && value) {
      labels[key] = value
    }
  }

  return labels
}

/** Coerce an untrusted renderer payload. A malformed push degrades to the empty
 *  snapshot rather than throwing inside the tray's IPC handler. */
export function normalizeTrayStatePayload(raw: unknown): TrayStatePayload {
  const record = isRecord(raw) ? raw : {}

  return {
    labels: normalizeLabels(record.labels),
    needsInput: normalizeRows(record.needsInput),
    running: normalizeRows(record.running)
  }
}

function appendGroup(
  items: TrayMenuModelItem[],
  group: 'needs-input' | 'running',
  labelKey: 'needsInputHeading' | 'runningHeading',
  rows: readonly TraySessionRow[]
): void {
  // Honest empty state: a group with nothing in it renders NOTHING — no
  // heading, no placeholder row, no fabricated count.
  if (rows.length === 0) {
    return
  }

  items.push({ count: rows.length, labelKey, type: 'heading' })

  for (const row of rows) {
    items.push({ group, sessionId: row.id, title: row.title, type: 'session' })
  }
}

/**
 * The tray menu as data. Order is the contract (mirrors the 06 preview's
 * bottom-right popover): three new-task entries, then the running group, then
 * the needs-input group, then open-main, then quit — separators only where a
 * block actually exists.
 */
export function buildTrayMenuModel(snapshot: TraySnapshot): TrayMenuModelItem[] {
  const items: TrayMenuModelItem[] = [
    {
      accelerator: TRAY_ACCELERATORS.newForensics,
      labelKey: 'newForensics',
      sessionKind: 'forensics',
      type: 'new-session'
    },
    { accelerator: TRAY_ACCELERATORS.newCtf, labelKey: 'newCtf', sessionKind: 'ctf', type: 'new-session' },
    { accelerator: TRAY_ACCELERATORS.newProject, labelKey: 'newProject', sessionKind: 'project', type: 'new-session' }
  ]

  const hasRunning = snapshot.running.length > 0
  const hasNeedsInput = snapshot.needsInput.length > 0

  if (hasRunning) {
    items.push({ type: 'separator' })
    appendGroup(items, 'running', 'runningHeading', snapshot.running)
  }

  if (hasNeedsInput) {
    items.push({ type: 'separator' })
    appendGroup(items, 'needs-input', 'needsInputHeading', snapshot.needsInput)
  }

  items.push({ type: 'separator' })
  items.push({ accelerator: TRAY_ACCELERATORS.openMainWindow, labelKey: 'openMainWindow', type: 'open-main' })
  items.push({ type: 'separator' })
  items.push({ labelKey: 'quit', type: 'quit' })

  return items
}

// ── Aggregate indicator (pure) ──────────────────────────────────────────────

export type TrayTone = 'idle' | 'needs-input' | 'running'

/** The one dot the tray shows. A blocking prompt is the louder cue, so
 *  needs-input wins over running — same precedence as the sidebar. */
export function trayToneFor(snapshot: TraySnapshot): TrayTone {
  if (snapshot.needsInput.length > 0) {
    return 'needs-input'
  }

  if (snapshot.running.length > 0) {
    return 'running'
  }

  return 'idle'
}

/** BGRA channels for the 6px dot. Sourced from the Workbench token table
 *  (DESIGN_PROPOSAL §3.1): info `#0969DA`, warning `#9A6700`. The main process
 *  has no CSS layer, so the resolved values live here. */
export const TRAY_TONE_CHANNELS: Record<'needs-input' | 'running', { b: number; g: number; r: number }> = {
  'needs-input': { b: 0x00, g: 0x67, r: 0x9a },
  running: { b: 0xda, g: 0x69, r: 0x09 }
}

/** Status-dot diameter (DESIGN_PROPOSAL §3.5 — 6px, same as every StatusDot). */
export const TRAY_DOT_SIZE = 6

export interface TrayImageLike {
  getSize(): { height: number; width: number }
  isEmpty(): boolean
  toBitmap(): Buffer
}

export interface TrayImageFactory {
  createEmpty(): TrayImageLike
  createFromBitmap(buffer: Buffer, options: { height: number; scaleFactor?: number; width: number }): TrayImageLike
  createFromPath(path: string): TrayImageLike
}

/**
 * Paint the aggregate 6px dot into the bottom-right corner of the resolved app
 * icon. Electron exposes no draw API, so we mutate the raw BGRA bitmap and
 * hand it back as a fresh native image. `idle` (and an undecodable base) return
 * the base untouched.
 */
export function composeTrayIcon(
  base: TrayImageLike,
  tone: TrayTone,
  factory: Pick<TrayImageFactory, 'createFromBitmap'>
): TrayImageLike {
  if (tone === 'idle' || base.isEmpty()) {
    return base
  }

  const { height, width } = base.getSize()

  if (width <= 2 || height <= 2) {
    return base
  }

  const bitmap = Buffer.from(base.toBitmap())

  if (bitmap.length < width * height * 4) {
    return base
  }

  const size = Math.min(TRAY_DOT_SIZE, Math.min(width, height) - 2)
  const margin = 1
  const left = width - size - margin
  const top = height - size - margin
  const radius = size / 2
  const { b, g, r } = TRAY_TONE_CHANNELS[tone]

  for (let y = top; y < top + size; y++) {
    for (let x = left; x < left + size; x++) {
      const dx = x - left - (size - 1) / 2
      const dy = y - top - (size - 1) / 2

      if (dx * dx + dy * dy > radius * radius) {
        continue
      }

      const offset = (y * width + x) * 4

      bitmap[offset] = b
      bitmap[offset + 1] = g
      bitmap[offset + 2] = r
      bitmap[offset + 3] = 0xff
    }
  }

  return factory.createFromBitmap(bitmap, { height, width })
}

// ── Close interception (pure) ───────────────────────────────────────────────

export interface TrayQuitState {
  /** A real quit (tray quit menu, Cmd-Q) — never hide, or the app never dies. */
  quitting: boolean
  /** A detached updater / swap / uninstall is taking over: same hard rule. */
  quittingForHandoff: boolean
  /** The active-work confirmation is on screen or was just accepted. */
  quitInProgress: boolean
}

export const IDLE_TRAY_QUIT_STATE: TrayQuitState = {
  quitting: false,
  quittingForHandoff: false,
  quitInProgress: false
}

/**
 * Should closing the main window hide it instead of destroying it?
 *
 * The three quit guards outrank the preference: hiding the window while the
 * process is trying to exit strands the PID-wait of an updater/uninstaller and
 * swallows the quit-guard's dialog.
 */
export function shouldMinimizeOnClose(enabled: boolean, quit: TrayQuitState): boolean {
  return enabled && !quit.quitting && !quit.quittingForHandoff && !quit.quitInProgress
}

// ── Preference persistence ──────────────────────────────────────────────────

export const CLOSE_TO_TRAY_DEFAULT = true

/** Main-process-owned copy so a cold launch knows the preference before the
 *  renderer has ever visited Settings. Malformed/absent ⇒ default (on). */
export function readCloseToTrayPreference(
  filePath: string,
  readFile: (filePath: string) => string = p => fs.readFileSync(p, 'utf8')
): boolean {
  try {
    const parsed: unknown = JSON.parse(readFile(filePath))

    return isRecord(parsed) && parsed.minimizeOnClose === false ? false : CLOSE_TO_TRAY_DEFAULT
  } catch {
    return CLOSE_TO_TRAY_DEFAULT
  }
}

export function writeCloseToTrayPreference(filePath: string, on: boolean): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({ minimizeOnClose: on }, null, 2), 'utf8')
}

// ── Runtime controller ──────────────────────────────────────────────────────

export interface TrayActions {
  focusSession(sessionId: string): void
  newSession(kind: TraySessionKind): void
  openMainWindow(): void
  quit(): void
}

export interface TrayMenuItemTemplate {
  accelerator?: string
  click?: () => void
  enabled?: boolean
  label?: string
  type?: 'normal' | 'separator'
}

export interface TrayLike {
  destroy(): void
  on(event: 'click', listener: () => void): unknown
  setContextMenu(menu: unknown): void
  setImage(image: TrayImageLike): void
  setToolTip(tip: string): void
}

export interface TrayElectronLike {
  Menu: { buildFromTemplate(template: TrayMenuItemTemplate[]): unknown }
  Tray: new (image: TrayImageLike) => TrayLike
  nativeImage: TrayImageFactory
}

export interface TrayIpcLike {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown
}

export interface DesktopTrayOptions {
  actions: TrayActions
  /** Hide (never destroy) the main window on an intercepted close. */
  hideWindow: () => void
  /** Resolved app icon; undefined when every candidate failed (fail-soft). */
  iconPath?: string
  quitState: () => TrayQuitState
  /** Defaults to `<userData>/close-to-tray.json` — the tray's own file. */
  closeToTrayPath?: string
  /** Defaults to the real `ipcMain`. */
  ipc?: TrayIpcLike
  log?: (message: string) => void
  /** Injectable Electron surface — tests pass a fake. */
  electron?: TrayElectronLike
}

export interface DesktopTray {
  destroy(): void
  /** Returns true when the close was intercepted (preventDefault + hide). */
  handleClose(event: { preventDefault(): void }): boolean
  shouldMinimizeOnClose(): boolean
}

const DEFAULT_ELECTRON: TrayElectronLike = {
  Menu: { buildFromTemplate: template => Menu.buildFromTemplate(template) },
  Tray: Tray as unknown as TrayElectronLike['Tray'],
  nativeImage
}

export const TRAY_STATE_CHANNEL = 'fulilian:tray:state'
export const TRAY_CLOSE_TO_TRAY_CHANNEL = 'fulilian:tray:close-to-tray'

function resolveBaseIcon(iconPath: string | undefined, electron: TrayElectronLike): TrayImageLike {
  if (iconPath) {
    try {
      const image = electron.nativeImage.createFromPath(iconPath)

      if (!image.isEmpty()) {
        return image
      }
    } catch {
      // Undecodable candidate — fall through to an empty icon rather than
      // taking the main process down (same fail-soft contract as app-icon.ts).
    }
  }

  return electron.nativeImage.createEmpty()
}

function trayTooltip(snapshot: TraySnapshot, labels: TrayMenuLabels): string {
  const parts: string[] = []

  if (snapshot.running.length > 0) {
    parts.push(`${labels.runningHeading} ${snapshot.running.length}`)
  }

  if (snapshot.needsInput.length > 0) {
    parts.push(`${labels.needsInputHeading} ${snapshot.needsInput.length}`)
  }

  return parts.length > 0 ? `FuLilian · ${parts.join(' · ')}` : 'FuLilian'
}

function trayTemplate(
  snapshot: TraySnapshot,
  labels: TrayMenuLabels,
  actions: TrayActions
): TrayMenuItemTemplate[] {
  return buildTrayMenuModel(snapshot).map(item => {
    switch (item.type) {
      case 'separator':
        return { type: 'separator' as const }

      case 'heading':
        return { enabled: false, label: `${labels[item.labelKey]} · ${item.count}` }

      case 'session':
        return { click: () => actions.focusSession(item.sessionId), label: item.title }

      case 'new-session':
        return {
          accelerator: item.accelerator,
          click: () => actions.newSession(item.sessionKind),
          label: labels[item.labelKey]
        }

      case 'open-main':
        return { accelerator: item.accelerator, click: () => actions.openMainWindow(), label: labels[item.labelKey] }

      case 'quit':
        return { click: () => actions.quit(), label: labels[item.labelKey] }

      default:
        return { type: 'separator' as const }
    }
  })
}

/**
 * Own the real tray. Created on `app.whenReady()` and destroyed on quit; the
 * renderer drives it by pushing `TrayStatePayload` snapshots. Fail-soft: an
 * unusable icon degrades to an empty image, never a throw.
 */
export function createDesktopTray(options: DesktopTrayOptions): DesktopTray {
  const {
    actions,
    closeToTrayPath = path.join(app.getPath('userData'), 'close-to-tray.json'),
    hideWindow,
    iconPath,
    ipc = ipcMain,
    log = () => {},
    quitState,
    electron = DEFAULT_ELECTRON
  } = options

  let closeToTray = readCloseToTrayPreference(closeToTrayPath)
  let snapshot: TraySnapshot = EMPTY_TRAY_SNAPSHOT
  let labels: TrayMenuLabels = EMPTY_TRAY_LABELS

  const baseIcon = resolveBaseIcon(iconPath, electron)
  const tray = new electron.Tray(baseIcon)

  const render = () => {
    tray.setImage(composeTrayIcon(baseIcon, trayToneFor(snapshot), electron.nativeImage))
    tray.setToolTip(trayTooltip(snapshot, labels))
    tray.setContextMenu(electron.Menu.buildFromTemplate(trayTemplate(snapshot, labels, actions)))
  }

  // Left click = open/focus the main window (T6-10).
  tray.on('click', () => actions.openMainWindow())

  ipc.on(TRAY_STATE_CHANNEL, (_event, payload) => {
    const next = normalizeTrayStatePayload(payload)

    snapshot = { needsInput: next.needsInput, running: next.running }
    labels = next.labels
    render()
  })

  ipc.on(TRAY_CLOSE_TO_TRAY_CHANNEL, (_event, on) => {
    closeToTray = on !== false

    try {
      writeCloseToTrayPreference(closeToTrayPath, closeToTray)
    } catch (error) {
      log(`[tray] close-to-tray preference write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  render()

  return {
    destroy() {
      try {
        tray.destroy()
      } catch {
        // Already gone (platform teardown) — destroying twice is not an error.
      }
    },
    handleClose(event) {
      if (!shouldMinimizeOnClose(closeToTray, quitState())) {
        return false
      }

      event.preventDefault()
      hideWindow()

      return true
    },
    shouldMinimizeOnClose() {
      return shouldMinimizeOnClose(closeToTray, quitState())
    }
  }
}
