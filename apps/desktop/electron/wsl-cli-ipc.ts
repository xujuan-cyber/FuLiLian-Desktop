// fulilian:wsl-cli:* IPC surface (step09 v2 — real probe + persisted opt-in).
//
// Registration style mirrors registerTerminalIpc in terminal-ipc.ts: a
// register* factory with injected deps, owning its ipcMain.handle wiring and
// returning an api object main.ts can hold. All handlers delegate to
// wsl-cli-probe.ts; channel names are frozen by the step09 contract.
//
// This module is also the feature's only Electron-facing entry point, so the
// userData directory for the opt-in file (step09 v2 · T3) is resolved here and
// injected into the probe module. main.ts registration stays untouched.
import { app, ipcMain } from 'electron'

import {
  configureWslCliOptinPersistence,
  probeCacheInvalidate,
  probeWslClis,
  readWslCliOptinState,
  writeWslCliOptin
} from './wsl-cli-probe'

export interface WslCliIpcDeps {
  rememberLog: (line: string) => void
}

export interface WslCliIpcApi {
  channels: readonly string[]
  probeCacheInvalidate: () => void
}

// Channel names are contract-frozen (step09 §四 B) — do not rename.
export const WSL_CLI_CHANNELS = [
  'fulilian:wsl-cli:probe',
  'fulilian:wsl-cli:get-optin',
  'fulilian:wsl-cli:set-optin'
] as const

export function registerWslCliIpc({ rememberLog }: WslCliIpcDeps): WslCliIpcApi {
  // Opt-in lands in `app.getPath('userData')/wsl-cli.json` (T3). Resolved once
  // at registration; a missing/unwritable directory degrades to in-memory state
  // rather than failing the registration.
  configureWslCliOptinPersistence(app.getPath('userData'))

  ipcMain.handle('fulilian:wsl-cli:probe', (_event, options) => {
    const payload = (options || {}) as { distro?: unknown; force?: unknown }

    const result = probeWslClis({
      // The contract types this as `string | undefined`, but the renderer is
      // untrusted input: a number/object would otherwise reach
      // probeWslClis and throw inside `.trim()`. `force` is Boolean-normalized
      // (v1 behavior, unchanged).
      distro: typeof payload.distro === 'string' ? payload.distro : undefined,
      force: Boolean(payload.force)
    })

    rememberLog(`[wsl-cli] probe distro=${result.distro} error=${String(result.error)}`)

    return result
  })

  ipcMain.handle('fulilian:wsl-cli:get-optin', () => readWslCliOptinState())

  ipcMain.handle('fulilian:wsl-cli:set-optin', (_event, payload) => {
    // Defensive read: the renderer may send undefined / a bare patch object.
    const patch = (payload && typeof payload === 'object' ? payload.optin : undefined) || {}
    const state = writeWslCliOptin(patch)

    rememberLog(`[wsl-cli] set-optin ${JSON.stringify(state.optin)}`)

    return state
  })

  return { channels: WSL_CLI_CHANNELS, probeCacheInvalidate }
}
