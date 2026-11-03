import { atom } from 'nanostores'

import type { TerminalShellChoice, TerminalShellPref } from '@/global'

/**
 * R-4: what the main process says will ACTUALLY run, resolved from the
 * machine's PATH — not what the preference asked for. `degraded` means the
 * explicit choice could not be honored and `fallback` is what runs instead.
 */
export interface TerminalShellResolutionView {
  choice: TerminalShellChoice
  path: null | string
  name: null | string
  degraded: boolean
  fallback: null | TerminalShellChoice
}

/**
 * The persisted preference plus the additive, read-only field the
 * `fulilian:terminal-shell:get` payload carries since N1/N2. It is declared
 * here rather than in `global.d.ts` on purpose: the preload surface and every
 * other caller keep their existing `TerminalShellPref` contract untouched.
 */
export type TerminalShellPrefView = TerminalShellPref & {
  resolvedShell?: TerminalShellResolutionView
}

/**
 * Terminal shell preference (step17): the local-shell choice, persisted
 * main-process side (`userData/terminal-shell.json`). null until the first
 * load.
 */
export const $terminalShellPref = atom<null | TerminalShellPrefView>(null)

/** The preload bridge, or undefined outside the desktop shell (tests, web). */
function bridge() {
  return typeof window === 'undefined' ? undefined : window.fulilianDesktop?.terminalShell
}

/**
 * Load the persisted preference. Every action degrades silently when the
 * bridge is absent or the IPC call rejects — pure UI convenience, never throws
 * into render.
 */
export async function loadTerminalShellPref(): Promise<null | TerminalShellPrefView> {
  const api = bridge()

  if (!api) {
    return null
  }

  try {
    const state = (await api.get()) as TerminalShellPrefView

    $terminalShellPref.set(state)

    return state
  } catch {
    return null
  }
}

/**
 * Merge-write a preference patch.
 */
export async function setTerminalShellPref(patch: { local?: TerminalShellChoice }): Promise<null | TerminalShellPrefView> {
  const api = bridge()

  if (!api) {
    return null
  }

  try {
    const state = (await api.set(patch)) as TerminalShellPrefView

    $terminalShellPref.set(state)

    return state
  } catch {
    return null
  }
}
