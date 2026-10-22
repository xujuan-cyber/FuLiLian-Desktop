// fulilian:terminal-shell:* IPC surface (step17 — shell preference).
//
// Registration style mirrors registerWslCliIpc: a register* factory with
// injected deps, owning its ipcMain.handle wiring and returning an api object
// main.ts can hold. All handlers delegate to terminal-shell-pref.ts; the two
// channel names are NEW (they do not touch the frozen step09 `wsl-cli` or
// `terminal` surfaces).
import { app, ipcMain } from 'electron'

import {
  configureTerminalShellPrefPersistence,
  readTerminalShellPref,
  type TerminalShellPref,
  writeTerminalShellPref
} from './terminal-shell-pref'
import {
  defaultShellResolveDeps,
  noteShellDegradation,
  resolveTerminalShellPref
} from './terminal-shell-resolve'

export interface TerminalShellIpcDeps {
  rememberLog: (line: string) => void
}

export interface TerminalShellIpcApi {
  channels: readonly string[]
}

export const TERMINAL_SHELL_CHANNELS = ['fulilian:terminal-shell:get', 'fulilian:terminal-shell:set'] as const

export function registerTerminalShellIpc({ rememberLog }: TerminalShellIpcDeps): TerminalShellIpcApi {
  // The preference lands in `app.getPath('userData')/terminal-shell.json`.
  // A missing/unwritable directory degrades to in-memory state rather than
  // failing the registration.
  configureTerminalShellPrefPersistence(app.getPath('userData'))

  // Seed/heal the file at registration, not on first PTY (N1 R-1): the
  // Windows-side default must be observable on disk right after first boot,
  // and a pre-N1 file gains its `envSide:'windows'` here. `readTerminalShellPref`
  // routes through ensureTerminalShellPrefFile, which is idempotent by
  // construction — a post-N1 file is served from the mtime cache with zero
  // writes, and an unwritable directory degrades to the in-memory default.
  const seeded = readTerminalShellPref()

  rememberLog(
    `[terminal-shell] pref seeded local=${seeded.local} envSide=${seeded.envSide} wslDistro=${String(seeded.wslDistro)}`
  )

  // R-4: the settings page shows which shell will ACTUALLY run and where it
  // lives. `resolvedShell` is a purely ADDITIVE field on the existing payload —
  // no channel is added, no existing key changes shape, and the persisted file
  // is untouched (it is computed, never written). Resolution is spawn-free.
  function withResolution(pref: TerminalShellPref) {
    const resolvedShell = resolveTerminalShellPref(pref, defaultShellResolveDeps())

    // One desktop.log line the first time a missing shell forces a fallback,
    // so "pwsh not installed" is never silent (R-4).
    noteShellDegradation(resolvedShell, rememberLog)

    return { ...pref, resolvedShell }
  }

  ipcMain.handle('fulilian:terminal-shell:get', () => withResolution(readTerminalShellPref()))

  ipcMain.handle('fulilian:terminal-shell:set', (_event, payload) => {
    // Defensive read: the renderer may send undefined / a non-object.
    const patch = (payload && typeof payload === 'object' ? payload : {}) as {
      local?: unknown
      wslDistro?: unknown
    }

    const state = writeTerminalShellPref(patch)

    rememberLog(`[terminal-shell] set local=${state.local} wslDistro=${String(state.wslDistro)}`)

    return withResolution(state)
  })

  return { channels: TERMINAL_SHELL_CHANNELS }
}
