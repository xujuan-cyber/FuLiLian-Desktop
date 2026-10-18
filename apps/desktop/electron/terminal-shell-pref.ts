// Opt-in persistence for the terminal shell preference (step17).
//
// `app.getPath('userData')/terminal-shell.json`, the same posture as
// wsl-cli.json (mtime cache + atomic write): the payload carries NO secret —
// just the local-shell choice and the default WSL distro — so the atomic writer
// is reused instead of growing a new one.
//
//   stat → mtime-cache hit? → read+normalize → write-through cache
//
// A missing or corrupt file degrades to the all-default preference rather than
// throwing into the IPC handler. Electron-free and injectable on purpose: a
// test can point this module at a temp directory with a stub fs / writer.
// `filePath` may be null (no userData available, e.g. under vitest) — then it
// is in-memory only.
import fs from 'node:fs'
import path from 'node:path'

import { writeSecretFileAtomic } from './hardening'

export const TERMINAL_SHELL_FILE_NAME = 'terminal-shell.json'

/** The local-shell choices the settings page offers; `auto` = detect. */
export const TERMINAL_SHELL_CHOICES = ['auto', 'cmd', 'powershell', 'pwsh'] as const

export type TerminalShellChoice = (typeof TERMINAL_SHELL_CHOICES)[number]

export interface TerminalShellPref {
  local: TerminalShellChoice
  /** Default WSL distro for the terminal switcher; null = not chosen. */
  wslDistro: null | string
}

export function defaultTerminalShellPref(): TerminalShellPref {
  return { local: 'auto', wslDistro: null }
}

export interface TerminalShellPersistFs {
  mkdirSync: typeof fs.mkdirSync
  readFileSync: typeof fs.readFileSync
  statSync: typeof fs.statSync
}

export interface TerminalShellPersistDeps {
  fs?: TerminalShellPersistFs
  writeAtomic?: (filePath: string, data: string) => void
}

/** Resolve the preference file path inside a userData directory. */
export function terminalShellPrefFilePath(userDataDir: string): string {
  return path.join(String(userDataDir || ''), TERMINAL_SHELL_FILE_NAME)
}

// `wsl -l -q` name shape: starts alnum, then alnum/space/dot/dash/underscore.
// The value is one argv element handed to `wsl.exe -d` (never string-joined
// into a command line), but a corrupt or hostile preference file still must
// not smuggle garbage into the spawn — same defensive posture as
// wslTerminalTargetFrom (terminal-ipc.ts).
const WSL_DISTRO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/

function isValidWslDistroName(raw: unknown): raw is string {
  return typeof raw === 'string' && WSL_DISTRO_NAME_RE.test(raw.trim())
}

/** Coerce arbitrary parsed JSON into the normalized shape; unknown → default. */
export function normalizeTerminalShellPref(raw: unknown): TerminalShellPref {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const local = root.local

  return {
    local: TERMINAL_SHELL_CHOICES.includes(local as TerminalShellChoice) ? (local as TerminalShellChoice) : 'auto',
    wslDistro: isValidWslDistroName(root.wslDistro) ? String(root.wslDistro).trim() : null
  }
}

// mtime cache, mirroring connectionConfigCache / wsl-cli-persist. Keyed by
// path so a test (or a future second location) cannot read a stale entry from
// a different file.
let cache: { mtime: null | number; path: null | string; state: TerminalShellPref } = null

/** Drop the mtime cache (tests, and reconfiguration to another directory). */
export function resetTerminalShellPrefCache(): void {
  cache = null
}

function normalizePath(filePath: null | string): null | string {
  return typeof filePath === 'string' && filePath ? filePath : null
}

/**
 * Read the preference, falling back to the default when the file is missing,
 * unreadable, or malformed. Never throws.
 */
export function readTerminalShellPrefFile(
  filePath: null | string,
  deps: TerminalShellPersistDeps = {}
): TerminalShellPref {
  const target = normalizePath(filePath)

  if (!target) {
    if (!cache || cache.path !== null) {
      cache = { mtime: null, path: null, state: defaultTerminalShellPref() }
    }

    return cache.state
  }

  const fsImpl = deps.fs || fs
  let mtime: null | number = null

  try {
    mtime = fsImpl.statSync(target).mtimeMs
  } catch {
    mtime = null
  }

  if (cache && cache.path === target && cache.mtime === mtime) {
    return cache.state
  }

  let state: TerminalShellPref

  try {
    state = normalizeTerminalShellPref(JSON.parse(String(fsImpl.readFileSync(target, 'utf8'))))
  } catch {
    // Missing or malformed settings fall back to "auto-detect everything".
    state = defaultTerminalShellPref()
  }

  cache = { mtime, path: target, state }

  return state
}

/**
 * Merge-persist the preference atomically (temp + rename via
 * writeSecretFileAtomic) and write through to the cache. A failed write is
 * swallowed — the caller gets the in-memory state so the UI never sees a
 * thrown IPC error.
 */
export function writeTerminalShellPrefFile(
  filePath: null | string,
  patch: { local?: unknown; wslDistro?: unknown },
  deps: TerminalShellPersistDeps = {}
): TerminalShellPref {
  const target = normalizePath(filePath)
  // Merge semantics: only keys the caller actually supplied (and supplied
  // validly) move the stored state — a junk `local` keeps the previous
  // choice instead of resetting it to `auto`, while `wslDistro` clears to
  // null on any value normalize rejects (defensive, file is user-editable).
  const merged = { ...(readTerminalShellPrefFile(target, deps) || defaultTerminalShellPref()) }

  if (TERMINAL_SHELL_CHOICES.includes(patch.local as TerminalShellChoice)) {
    merged.local = patch.local as TerminalShellChoice
  }

  if ('wslDistro' in patch) {
    merged.wslDistro = (patch.wslDistro ?? null) as null | string
  }

  const normalized = normalizeTerminalShellPref(merged)

  if (!target) {
    cache = { mtime: null, path: null, state: normalized }

    return normalized
  }

  const fsImpl = deps.fs || fs
  const writeAtomic = deps.writeAtomic || writeSecretFileAtomic
  let mtime: null | number = null

  try {
    fsImpl.mkdirSync(path.dirname(target), { recursive: true })
    writeAtomic(target, JSON.stringify(normalized, null, 2))
    mtime = fsImpl.statSync(target).mtimeMs
  } catch {
    mtime = null
  }

  cache = { mtime, path: target, state: normalized }

  return normalized
}

// --- Configured module surface (userData path resolved once at registration).

let configuredDir: null | string = null

/** Point the preference at a userData directory (null → in-memory only). */
export function configureTerminalShellPrefPersistence(userDataDir: null | string): void {
  configuredDir = normalizePath(userDataDir)

  resetTerminalShellPrefCache()
}

function configuredFilePath(): null | string {
  return configuredDir ? terminalShellPrefFilePath(configuredDir) : null
}

/** Read the configured preference (never throws). */
export function readTerminalShellPref(): TerminalShellPref {
  return readTerminalShellPrefFile(configuredFilePath())
}

/** Merge-write the configured preference (never throws). */
export function writeTerminalShellPref(patch: { local?: unknown; wslDistro?: unknown }): TerminalShellPref {
  return writeTerminalShellPrefFile(configuredFilePath(), patch)
}
