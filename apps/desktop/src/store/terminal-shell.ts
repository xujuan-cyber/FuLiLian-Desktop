import { atom } from 'nanostores'

import type { TerminalShellChoice, TerminalShellPref } from '@/global'
import { selectWslCliDistro } from '@/store/wsl-cli'

/**
 * Terminal shell preference (step17): the local-shell choice plus the default
 * WSL distro, persisted main-process side (`userData/terminal-shell.json`).
 * null until the first load.
 */
export const $terminalShellPref = atom<null | TerminalShellPref>(null)

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
export async function loadTerminalShellPref(): Promise<null | TerminalShellPref> {
  const api = bridge()

  if (!api) {
    return null
  }

  try {
    const state = await api.get()

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
}): Promise<null | TerminalShellPref> {
  const api = bridge()

  if (!api) {
    return null
  }

  try {
    const state = await api.set(patch)

    $terminalShellPref.set(state)

    if ('wslDistro' in patch) {
      selectWslCliDistro(state?.wslDistro ?? null)
    }

    return state
  } catch {
    return null
  }
}
