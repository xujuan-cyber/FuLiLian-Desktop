// Which shell will a LOCAL terminal actually spawn? (N2 / R-4)
//
// One pure, spawn-free resolver shared by the two places that must agree:
//
//   - terminal-ipc.ts        — decides the PTY's argv,
//   - terminal-shell-ipc.ts  — reports the effective shell + real path to the
//                              settings page.
//
// "Spawn-free" is a hard property: resolution only stats PATH candidates, so
// asking the settings page what will run can never start a process (contrast
// `resolveDefaultWslDistro`, which shells out to wsl.exe). Everything external
// is injected, so tests drive it without touching the real filesystem.
import fs from 'node:fs'
import path from 'node:path'

import type { TerminalShellChoice } from './terminal-shell-pref'
import { buildPathExtCandidates } from './windows-fulilian-path'

export interface ShellResolution {
  /** The persisted choice this resolution answers for. */
  choice: TerminalShellChoice
  /** Absolute path of the shell that will be spawned; null = unresolvable. */
  path: null | string
  /** `path`'s basename (e.g. `pwsh.exe`), for labels. */
  name: null | string
  /** True when the explicit choice could not be honored (R-4: never silent). */
  degraded: boolean
  /** The shell family actually used when `degraded`; null otherwise. */
  fallback: null | TerminalShellChoice
}

export interface ShellResolveDeps {
  env: NodeJS.ProcessEnv
  fileExists: (filePath: string) => boolean
  findOnPath: (command: string) => null | string
  isWindows: boolean
}

/** Windows PowerShell 5.1 ships at a fixed System32 path on every Windows box. */
function windowsPowerShellPath(deps: ShellResolveDeps): null | string {
  const root = deps.env.SystemRoot || deps.env.windir || 'C:\\Windows'
  const builtin = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

  return deps.fileExists(builtin) ? builtin : deps.findOnPath('powershell.exe')
}

function pwshPath(deps: ShellResolveDeps): null | string {
  return deps.findOnPath('pwsh.exe') || deps.findOnPath('pwsh')
}

function cmdPath(deps: ShellResolveDeps): string {
  return deps.env.COMSPEC || 'cmd.exe'
}

/** Shell family of a resolved path, used to describe a fallback honestly. */
export function shellFamilyOf(shellPath: null | string): null | TerminalShellChoice {
  if (!shellPath) {
    return null
  }

  const name = path.basename(shellPath).toLowerCase()

  if (name.startsWith('pwsh')) {
    return 'pwsh'
  }

  if (name.startsWith('powershell')) {
    return 'powershell'
  }

  return name.startsWith('cmd') ? 'cmd' : 'auto'
}

/** Best shell installed for this platform — the `auto` choice's answer. */
function autoPath(deps: ShellResolveDeps): null | string {
  if (deps.isWindows) {
    return pwshPath(deps) || windowsPowerShellPath(deps) || cmdPath(deps)
  }

  return ['/bin/zsh', '/bin/bash', '/bin/sh'].find(candidate => deps.fileExists(candidate)) || null
}

/**
 * Resolve a preference to the shell that will actually run.
 *
 * An explicit choice whose binary is missing degrades to the best installed
 * shell and says so (`degraded: true` + `fallback`), instead of silently
 * pretending the choice took effect. `auto` is never "degraded": its whole
 * meaning is "whatever is installed".
 */
export function resolveTerminalShell(choice: unknown, deps: ShellResolveDeps): ShellResolution {
  const requested: TerminalShellChoice =
    choice === 'pwsh' || choice === 'powershell' || choice === 'cmd' || choice === 'auto' ? choice : 'auto'

  if (requested === 'auto') {
    const resolved = autoPath(deps)

    return {
      choice: 'auto',
      degraded: false,
      fallback: null,
      name: resolved ? path.basename(resolved) : null,
      path: resolved
    }
  }

  const explicit =
    requested === 'pwsh'
      ? pwshPath(deps)
      : requested === 'powershell' && deps.isWindows
        ? windowsPowerShellPath(deps)
        : requested === 'cmd' && deps.isWindows
          ? cmdPath(deps)
          : null

  if (explicit) {
    return {
      choice: requested,
      degraded: false,
      fallback: null,
      name: path.basename(explicit),
      path: explicit
    }
  }

  const fallbackPath = autoPath(deps)

  return {
    choice: requested,
    degraded: true,
    fallback: shellFamilyOf(fallbackPath),
    name: fallbackPath ? path.basename(fallbackPath) : null,
    path: fallbackPath
  }
}

/** PATH lookup with Windows PATHEXT semantics (mirrors main.ts:findOnPath). */
function findOnPathIn(command: string, deps: ShellResolveDeps): null | string {
  if (!command) {
    return null
  }

  if (path.isAbsolute(command) || command.includes(path.sep) || (deps.isWindows && command.includes('/'))) {
    return deps.fileExists(command) ? command : null
  }

  const entries = String(deps.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)

  for (const entry of entries) {
    for (const extension of buildPathExtCandidates(deps.env.PATHEXT, deps.isWindows)) {
      const candidate = path.join(entry, `${command}${extension}`)

      if (deps.fileExists(candidate)) {
        return candidate
      }
    }
  }

  return null
}

/** Real-filesystem deps (no Electron, no child_process — nothing is spawned). */
export function defaultShellResolveDeps(env: NodeJS.ProcessEnv = process.env): ShellResolveDeps {
  const isWindows = process.platform === 'win32'

  const deps: ShellResolveDeps = {
    env,
    fileExists: filePath => {
      try {
        return fs.statSync(filePath).isFile()
      } catch {
        return false
      }
    },
    findOnPath: () => null,
    isWindows
  }

  deps.findOnPath = command => findOnPathIn(command, deps)

  return deps
}

// Degradation is logged once per (choice, fallback) pair so a settings page
// polled by the renderer cannot flood desktop.log, while a real change of
// state still produces a fresh line.
let lastDegradationKey: null | string = null

/**
 * Emit one `desktop.log` line the first time a degradation is observed (R-4:
 * "pwsh missing" must not be silent). Returns true when a line was logged.
 */
export function noteShellDegradation(
  resolution: ShellResolution,
  log: (line: string) => void
): boolean {
  if (!resolution.degraded) {
    return false
  }

  const key = `${resolution.choice}->${String(resolution.fallback)}:${String(resolution.path)}`

  if (key === lastDegradationKey) {
    return false
  }

  lastDegradationKey = key
  log(
    `[terminal-shell] ${resolution.choice} unavailable; falling back to ${String(
      resolution.name
    )} (${String(resolution.path)})`
  )

  return true
}

/** Test seam: forget the once-per-change log dedupe. */
export function resetShellDegradationLog(): void {
  lastDegradationKey = null
}

/** Convenience: resolve a preference object (or a loose `{ local }` patch). */
export function resolveTerminalShellPref(
  pref: null | { local?: unknown },
  deps: ShellResolveDeps
): ShellResolution {
  return resolveTerminalShell(pref?.local ?? 'auto', deps)
}
