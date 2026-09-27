// Opt-in persistence for the WSL CLI bridge (step09 v2 · T3).
//
// `app.getPath('userData')/wsl-cli.json`, same posture as connection.json but
// deliberately simpler: the payload carries NO secret (five booleans + a
// timestamp), so it reuses the existing atomic writer instead of growing a new
// one. Discipline copied from readDesktopConnectionConfig /
// writeDesktopConnectionConfig in main.ts:
//
//   stat → mtime-cache hit? → read+normalize → write-through cache
//
// A missing or corrupt file degrades to the all-false default rather than
// throwing into the IPC handler.
//
// Electron-free and injectable on purpose: `wsl-cli-probe.ts` (which owns the
// CLI name list) stays unit-testable without Electron, and a test can point
// this module at a temp directory with a stub fs / writer. `filePath` may be
// null (no userData available, e.g. under vitest) — then it is in-memory only.
import fs from 'node:fs'
import path from 'node:path'

import { writeSecretFileAtomic } from './hardening'
import type { WslCliOptin, WslCliOptinState } from './wsl-cli-probe'

export const WSL_CLI_OPTIN_FILE_NAME = 'wsl-cli.json'

interface WslCliPersistFs {
  mkdirSync: typeof fs.mkdirSync
  readFileSync: typeof fs.readFileSync
  statSync: typeof fs.statSync
}

export interface WslCliPersistDeps {
  fs?: WslCliPersistFs
  writeAtomic?: (filePath: string, data: string) => void
}

/** Resolve the opt-in file path inside a userData directory. */
export function wslCliOptinFilePath(userDataDir: string): string {
  return path.join(String(userDataDir || ''), WSL_CLI_OPTIN_FILE_NAME)
}

/** Coerce arbitrary parsed JSON into the frozen shape: five keys, all present. */
export function normalizeWslCliOptinState(raw: unknown, names: readonly string[]): WslCliOptinState {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const source = root.optin && typeof root.optin === 'object' ? (root.optin as Record<string, unknown>) : {}

  const optin = {} as WslCliOptin

  for (const name of names) {
    optin[name as keyof WslCliOptin] = source[name] === true
  }

  const probedAt = Number(root.probedAt)

  return { optin, probedAt: Number.isFinite(probedAt) && probedAt > 0 ? probedAt : null }
}

// mtime cache, mirroring connectionConfigCache / connectionConfigCacheMtime.
// Keyed by path so a test (or a future second location) cannot read a stale
// entry from a different file.
let cache: { mtime: null | number; path: null | string; state: WslCliOptinState } = null

/** Drop the mtime cache (tests, and reconfiguration to another directory). */
export function resetWslCliPersistCache(): void {
  cache = null
}

function normalizePath(filePath: null | string): null | string {
  return typeof filePath === 'string' && filePath ? filePath : null
}

/**
 * Read the opt-in state, falling back to the all-false default when the file is
 * missing, unreadable, or malformed. Never throws.
 */
export function readWslCliOptinFile(
  filePath: null | string,
  names: readonly string[],
  deps: WslCliPersistDeps = {}
): WslCliOptinState {
  const target = normalizePath(filePath)

  if (!target) {
    if (!cache || cache.path !== null) {
      cache = { mtime: null, path: null, state: normalizeWslCliOptinState(null, names) }
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

  let state: WslCliOptinState

  try {
    state = normalizeWslCliOptinState(JSON.parse(String(fsImpl.readFileSync(target, 'utf8'))), names)
  } catch {
    // Missing or malformed settings fall back to "nothing opted in".
    state = normalizeWslCliOptinState(null, names)
  }

  cache = { mtime, path: target, state }

  return state
}

/**
 * Persist the opt-in state atomically (temp + rename via writeSecretFileAtomic)
 * and write through to the cache. A failed write is swallowed — the caller gets
 * the in-memory state so the UI never sees a thrown IPC error.
 */
export function writeWslCliOptinFile(
  filePath: null | string,
  state: WslCliOptinState,
  names: readonly string[],
  deps: WslCliPersistDeps = {}
): WslCliOptinState {
  const target = normalizePath(filePath)
  const normalized = normalizeWslCliOptinState(state, names)

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
