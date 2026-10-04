/**
 * Tray state (renderer side) — the aggregate the system tray paints, and the
 * "close to tray" preference.
 *
 * Two directions, same authority split as keep-awake / active-work:
 *
 * 1. The RENDERER owns session status — it is the only side that knows which
 *    sessions are running or blocked — so it pushes a small snapshot to the
 *    main process, which rebuilds the tray menu and the aggregate dot. Counts
 *    come from the SAME `$sessionDotStateById` map the sidebar paints, so the
 *    tray can never disagree with the sidebar about what a session is doing:
 *    running = `working` ∪ `stalled` (info blue), needs-input = `needs-input`
 *    (warning amber) — DESIGN_PROPOSAL §3.5 vocabulary.
 *
 * 2. The MAIN process owns the tray itself and the close interception, so the
 *    close-to-tray preference is mirrored to it (it persists its own copy for a
 *    cold launch) while this atom stays the settings-facing truth. Default ON.
 *
 * Imported for its side effect from `src/main.tsx`, alongside `store/active-work`.
 */

import { atom, computed } from 'nanostores'

import { translateNow } from '@/i18n'
import { persistBoolean, storedBoolean } from '@/lib/storage'
import { $sessions } from '@/store/session'
import { $sessionDotStateById, type SessionDotState } from '@/store/session-dot-state'

// ── Wire types (mirrors electron/tray.ts across the IPC boundary) ───────────

export interface TraySessionRow {
  id: string
  title: string
}

export interface TraySnapshot {
  needsInput: TraySessionRow[]
  running: TraySessionRow[]
}

export type TrayMenuLabelKey =
  | 'needsInputHeading'
  | 'newCtf'
  | 'newForensics'
  | 'newProject'
  | 'openMainWindow'
  | 'quit'
  | 'runningHeading'

export type TrayMenuLabels = Record<TrayMenuLabelKey, string>

export interface TrayStatePayload extends TraySnapshot {
  labels: TrayMenuLabels
}

// ── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Fold the session-dot map into the tray's two groups. Pure so the aggregation
 * rule (working ∪ stalled → running) is proven without mounting anything.
 */
export function traySnapshotFrom(
  byId: Readonly<Record<string, SessionDotState>>,
  sessions: readonly { id: string; title?: null | string }[]
): TraySnapshot {
  const running: TraySessionRow[] = []
  const needsInput: TraySessionRow[] = []

  for (const session of sessions) {
    const state = byId[session.id]

    if (state !== 'working' && state !== 'stalled' && state !== 'needs-input') {
      continue
    }

    const row: TraySessionRow = { id: session.id, title: session.title?.trim() || session.id }

    if (state === 'needs-input') {
      needsInput.push(row)
    } else {
      running.push(row)
    }
  }

  return { needsInput, running }
}

/** The two counts the tray badges. Derived, never a second source of truth. */
export function trayCounts(snapshot: TraySnapshot): { needsInput: number; running: number } {
  return { needsInput: snapshot.needsInput.length, running: snapshot.running.length }
}

export const $traySnapshot = computed([$sessionDotStateById, $sessions], (byId, sessions) =>
  traySnapshotFrom(byId, sessions)
)

export const $trayCounts = computed($traySnapshot, trayCounts)

/** The localized menu copy the main process cannot resolve itself. */
export function trayMenuLabels(): TrayMenuLabels {
  return {
    needsInputHeading: translateNow('tray.needsInputHeading'),
    newCtf: translateNow('tray.newCtf'),
    newForensics: translateNow('tray.newForensics'),
    newProject: translateNow('tray.newProject'),
    openMainWindow: translateNow('tray.openMainWindow'),
    quit: translateNow('tray.quit'),
    runningHeading: translateNow('tray.runningHeading')
  }
}

export function trayStatePayload(snapshot: TraySnapshot = $traySnapshot.get()): TrayStatePayload {
  return { ...snapshot, labels: trayMenuLabels() }
}

// ── Close-to-tray preference ────────────────────────────────────────────────

const CLOSE_TO_TRAY_KEY = 'fulilian.desktop.closeToTray.v1'

/** Default ON (DESIGN_PROPOSAL §8 / step-16 §3-T6). */
export const $closeToTray = atom<boolean>(
  typeof window === 'undefined' ? true : storedBoolean(CLOSE_TO_TRAY_KEY, true)
)

export function setCloseToTray(on: boolean): void {
  $closeToTray.set(on)
}

// ── Main-process bridge ─────────────────────────────────────────────────────

/** The tray slice of the preload bridge. Declared locally (like the quick-entry
 *  wire shapes) so the store stays decoupled from the shell's global typings. */
interface TrayDesktopBridge {
  pushState?: (payload: TrayStatePayload) => void
  setCloseToTray?: (on: boolean) => void
}

function trayBridge(): TrayDesktopBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return (window.fulilianDesktop as unknown as { tray?: TrayDesktopBridge } | undefined)?.tray
}

if (typeof window !== 'undefined') {
  // `$sessions` republishes on unrelated churn (previews, heartbeats), so only
  // send when the payload itself moved — this crosses a process boundary.
  let lastSent = ''

  $traySnapshot.subscribe(snapshot => {
    const payload = trayStatePayload(snapshot)
    const next = JSON.stringify(payload)

    if (next === lastSent) {
      return
    }

    lastSent = next
    trayBridge()?.pushState?.(payload)
  })

  // Fires once on subscribe too, which is how a cold launch hands the persisted
  // preference to the main process before Settings is ever opened.
  $closeToTray.subscribe(on => {
    persistBoolean(CLOSE_TO_TRAY_KEY, on)
    trayBridge()?.setCloseToTray?.(on)
  })
}
