// fulilian:wsl-cli:* IPC surface (step09 v1 — interface freeze only).
//
// Registration style mirrors registerTerminalIpc in terminal-ipc.ts: a
// register* factory with injected deps, owning its ipcMain.handle wiring and
// returning an api object main.ts can hold. All handlers delegate to
// wsl-cli-probe.ts; channel names are frozen by the step09 contract.
import { ipcMain } from 'electron'

import {
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
  ipcMain.handle('fulilian:wsl-cli:probe', (_event, options) => {
    const payload = (options || {}) as { distro?: string; force?: boolean }
    const result = probeWslClis({ distro: payload.distro, force: Boolean(payload.force) })

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
