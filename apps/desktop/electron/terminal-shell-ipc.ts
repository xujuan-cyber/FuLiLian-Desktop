// fulilian:terminal-shell:* IPC surface (step17 — shell preference).
//
// Registration style mirrors registerWslCliIpc: a register* factory with
// injected deps, owning its ipcMain.handle wiring and returning an api object
// main.ts can hold. All handlers delegate to terminal-shell-pref.ts; the two
// channel names are NEW (they do not touch the frozen step09 `wsl-cli` or
// `terminal` surfaces).
import { app, ipcMain } from 'electron'

import { configureTerminalShellPrefPersistence, readTerminalShellPref, writeTerminalShellPref } from './terminal-shell-pref'

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

  ipcMain.handle('fulilian:terminal-shell:get', () => readTerminalShellPref())

  ipcMain.handle('fulilian:terminal-shell:set', (_event, payload) => {
    // Defensive read: the renderer may send undefined / a non-object.
    const patch = (payload && typeof payload === 'object' ? payload : {}) as {
      local?: unknown
      wslDistro?: unknown
    }

    const state = writeTerminalShellPref(patch)

    rememberLog(`[terminal-shell] set local=${state.local} wslDistro=${String(state.wslDistro)}`)

    return state
  })

  return { channels: TERMINAL_SHELL_CHANNELS }
}
