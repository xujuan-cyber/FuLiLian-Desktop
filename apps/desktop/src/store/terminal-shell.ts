import { atom, computed } from 'nanostores'

import type { TerminalShellChoice, TerminalShellPref } from '@/global'
import { selectWslCliDistro } from '@/store/wsl-cli'

/** N1: which side new terminal sessions start on. */
export type TerminalShellEnvSide = 'windows' | 'wsl'

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
 * The persisted preference plus the two additive, read-only fields the
 * `fulilian:terminal-shell:get` payload carries since N1/N2. They are declared
 * here rather than in `global.d.ts` on purpose: the preload surface and every
 * other caller keep their existing `TerminalShellPref` contract untouched.
 */
export type TerminalShellPrefView = TerminalShellPref & {
  envSide?: TerminalShellEnvSide
  resolvedShell?: TerminalShellResolutionView
}

/**
 * Terminal shell preference (step17): the local-shell choice plus the default
 * WSL distro, persisted main-process side (`userData/terminal-shell.json`).
 * null until the first load.
 */
export const $terminalShellPref = atom<null | TerminalShellPrefView>(null)

/**
 * The effective startup side (N1). The main process always sends `envSide`
 * (migrated to `windows`), but a failed/absent load falls back to the same
 * product default instead of blocking on IPC.
 */
export const $terminalShellEnvSide = computed(
  $terminalShellPref,
  (pref): TerminalShellEnvSide => pref?.envSide ?? 'windows'
)

/** The preload bridge, or undefined outside the desktop shell (tests, web). */
function bridge() {
  return typeof window === 'undefined' ? undefined : window.fulilianDesktop?.terminalShell
}

/**
 * Load the persisted preference. Mirrors `wslDistro` into the terminal rail's
 * in-memory distro atom, so the persisted default feeds the distro picker as
 * its initial value across restarts. Every action degrades silently when the
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

    if (state?.wslDistro) {
      selectWslCliDistro(state.wslDistro)
    }

    return state
  } catch {
    return null
  }
}

/**
 * Merge-write a preference patch. When the patch touches `wslDistro`, the
 * resulting value is mirrored into the rail's distro atom so the picker and
 * the persisted state never disagree.
 */
export async function setTerminalShellPref(patch: {
  local?: TerminalShellChoice
  wslDistro?: null | string
}): Promise<null | TerminalShellPrefView> {
  const api = bridge()

  if (!api) {
    return null
  }

  try {
    const state = (await api.set(patch)) as TerminalShellPrefView

    $terminalShellPref.set(state)

    if ('wslDistro' in patch) {
      selectWslCliDistro(state?.wslDistro ?? null)
    }

    return state
  } catch {
    return null
  }
}
