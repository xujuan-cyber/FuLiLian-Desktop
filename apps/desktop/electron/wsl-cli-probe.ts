// WSL CLI discovery (step09 v2 — real probe + persisted opt-in).
//
// This module owns the *shape* of the WSL CLI probe / opt-in surface shared by
// the main process, the preload bridge, and the renderer type view in
// src/global.d.ts. v1 froze that contract with a spawn-free stub; v2 replaces
// the stub with the real probe while every wsl.exe call still goes through the
// injectable WslCliProbeExecDeps.exec seam reserved in v1.
//
// That seam is not cosmetic. The WorkBuddy command blacklist is inherited down
// the process chain, so neither a tool shell nor an Electron started by
// `npm run dev` can spawn wsl.exe; the only way to prove this module works is
// to inject a synthetic exec. See 协同编程/留档/step09-contract-v1.md §A/§D.
//
// Style follows backend-command.ts: pure, injectable, unit-testable without
// Electron. The exec-mode discipline (encoding / WSL_UTF8 / stdio / timeout /
// windowsHide) is copied from wsl-path-bridge.ts:resolveDefaultWslDistro.
import { execFileSync } from 'node:child_process'

import { resolveDefaultWslDistro } from './wsl-path-bridge'
import {
  readWslCliOptinFile,
  resetWslCliPersistCache,
  wslCliOptinFilePath,
  writeWslCliOptinFile
} from './wsl-cli-persist'

export const WSL_CLI_NAMES = ['claude', 'codex', 'codebuddy', 'hermes', 'fulilian'] as const
export type WslCliName = (typeof WSL_CLI_NAMES)[number]

export interface WslCliProbeEntry {
  name: WslCliName
  available: boolean
  posixPath: null | string // `command -v <name>` 的结果（去首尾空白）；不可用为 null
  version: null | string // `<name> --version` 首行（去首尾空白）；不可用为 null
}

export interface WslCliProbeResult {
  distro: string // 实际探测的发行版（显式 -d；缺省 = resolveDefaultWslDistro()）
  distros: string[] // `wsl.exe -l -q` 得到的全量发行版清单（NUL 已剥离）
  entries: WslCliProbeEntry[] // 恒 5 项，顺序恒等于 WSL_CLI_NAMES
  error: null | string // 降级原因；成功为 null
  probedAt: number // epoch ms
}

export type WslCliOptin = Record<WslCliName, boolean> // 默认五键全 false

export interface WslCliOptinState {
  optin: WslCliOptin
  probedAt: null | number // 最近一次探测快照时间；从未探测为 null
}

/**
 * Injectable exec seam for real probing. The default implementation uses
 * `execFileSync` with the wsl-path-bridge discipline; tests inject a synthetic
 * exec so no unit test ever spawns wsl.exe.
 */
export interface WslCliProbeExecDeps {
  exec: (file: string, args: string[]) => string
}

/**
 * `error` class tokens. DEV-B's settings panel interpolates this string into
 * user-facing copy (`Detection failed (<reason>)`), so every value here must be
 * short, single-line, and free of anything but a class name. `error === null`
 * is the only "probe succeeded, availability is a fact" signal.
 */
export const WSL_CLI_PROBE_ERROR = {
  failed: 'probe-failed',
  nonZeroExit: 'non-zero-exit',
  spawnFailed: 'spawn-failed',
  timeout: 'timeout'
} as const

// 8s: a `bash -lc` login shell must source the user's rc files and resolve
// nvm / ~/.local/bin before `command -v` can see anything. `wsl.exe -l -q` gets
// the same budget — one timeout constant, one failure story.
const PROBE_TIMEOUT_MS = 8000

// One `wsl.exe` call for all five CLIs: a login shell is expensive, so probing
// per CLI would multiply the cost by five. Each line is
// `name \t <command -v path> \t <--version first line>` — a missing value is an
// empty field rather than an omitted line, so the parser never has to guess.
// `-l` is mandatory: without it nvm / ~/.local/bin are absent from PATH and
// every CLI is under-reported as missing.
const PROBE_SCRIPT = [
  'for c in claude codex codebuddy hermes fulilian; do',
  '  p=$(command -v "$c" 2>/dev/null)',
  '  v=""',
  '  if [ -n "$p" ]; then v=$("$c" --version 2>/dev/null | head -n 1); fi',
  "  printf '%s\\t%s\\t%s\\n' \"$c\" \"$p\" \"$v\"",
  'done'
].join('\n')

function defaultExec(file: string, args: string[]): string {
  return execFileSync(file, args, {
    encoding: 'utf8',
    env: { ...process.env, WSL_UTF8: '1' },
    // stdin ignored / stderr discarded: never `pipe` stdin (EBUSY against a
    // synchronous spawn), and never let the WSL-not-installed banner leak.
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true
  }) as string
}

let execImpl: WslCliProbeExecDeps['exec'] = defaultExec

/**
 * Swap the probe's exec implementation. Tests inject a synthetic exec here so
 * that no unit test spawns wsl.exe; calling this with no argument restores the
 * real `execFileSync` implementation (used by `afterEach`).
 */
export function configureWslCliProbeExec(deps?: WslCliProbeExecDeps): void {
  execImpl = deps && typeof deps.exec === 'function' ? deps.exec : defaultExec
}

/**
 * Every distro name in `wsl.exe -l -q` output.
 *
 * Same parsing discipline as parseDefaultDistro in wsl-path-bridge.ts (NUL
 * strip + line split + `*`/whitespace strip — wsl.exe emits UTF-16LE without
 * WSL_UTF8 on older builds) but, unlike that helper, this keeps *all* entries
 * rather than the first. Duplicates are collapsed, order is preserved.
 */
export function parseDistroList(raw: string): string[] {
  const names: string[] = []

  for (const line of String(raw || '')
    .replace(/\0/g, '')
    .split(/\r?\n/)) {
    const name = line.replace(/^\*?\s*/, '').trim()

    if (name && !names.includes(name)) {
      names.push(name)
    }
  }

  return names
}

/** Parse the TAB-delimited probe lines into a name → result lookup. */
function parseProbeOutput(raw: string): Map<string, { posixPath: string; version: string }> {
  const found = new Map<string, { posixPath: string; version: string }>()

  for (const line of String(raw || '')
    .replace(/\0/g, '')
    .split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }

    const [name = '', posixPath = '', version = ''] = line.split('\t')
    const key = name.trim().toLowerCase()

    if (!key) {
      continue
    }

    found.set(key, { posixPath: posixPath.trim(), version: version.trim() })
  }

  return found
}

/**
 * Map any probe output — including partial, empty, or NUL-polluted — onto the
 * five contract entries in WSL_CLI_NAMES order. Availability is decided solely
 * by whether `command -v` returned a path.
 */
function toEntries(found: Map<string, { posixPath: string; version: string }>): WslCliProbeEntry[] {
  return WSL_CLI_NAMES.map(name => {
    const hit = found.get(name)
    const posixPath = hit?.posixPath || ''

    return {
      available: Boolean(posixPath),
      name,
      posixPath: posixPath || null,
      version: hit?.version || null
    }
  })
}

/** The all-unavailable five-entry fallback used by every failure path. */
function emptyEntries(): WslCliProbeEntry[] {
  return WSL_CLI_NAMES.map(name => ({ available: false, name, posixPath: null, version: null }))
}

/**
 * Reduce an exec failure to a short, single-line, UI-displayable class token.
 *
 * Process-creation failure (`EPERM` / `EACCES` — e.g. `spawnSync wsl.exe
 * EPERM` from an inherited command blacklist) is a first-class class here: it
 * is the expected outcome inside the sandbox, and it must not be confused with
 * "wsl.exe ran and found nothing".
 */
function classifyProbeFailure(error: unknown): string {
  const failure = (error || {}) as { code?: unknown; message?: unknown; signal?: unknown; status?: unknown }
  const code = String(failure.code || '').toUpperCase()
  const message = String(failure.message || '')

  // execFileSync reports its own timeout as `spawnSync <file> ETIMEDOUT`.
  if (
    code === 'ETIMEDOUT' ||
    failure.signal === 'SIGTERM' ||
    /ETIMEDOUT/i.test(message) ||
    /timed?\s*out/i.test(message)
  ) {
    return WSL_CLI_PROBE_ERROR.timeout
  }

  // A non-zero exit carries `status` and no spawn-level `code`.
  if (typeof failure.status === 'number' && failure.status !== 0) {
    return `${WSL_CLI_PROBE_ERROR.nonZeroExit}: ${failure.status}`
  }

  if (code === 'EPERM' || code === 'EACCES' || /EPERM|EACCES|spawnSync/i.test(message)) {
    return WSL_CLI_PROBE_ERROR.spawnFailed
  }

  return WSL_CLI_PROBE_ERROR.failed
}

// Process-internal probe cache + explicit invalidation (contract §四 D).
let cachedProbe: null | WslCliProbeResult = null

/**
 * Probe the installed WSL CLIs in one `wsl.exe -d <distro> -e bash -lc <script>`
 * call, plus one `wsl.exe -l -q` for the full distro list.
 *
 * Never throws. Any failure — spawn refused, timeout, non-zero exit, unparsable
 * output — degrades to five `available:false` entries plus a class token in
 * `error`; the entry count and order never change (contract §A invariant 1/2).
 * A partial result (some CLIs missing) is a *success*: `error` stays null.
 */
export function probeWslClis(options?: { distro?: string; force?: boolean }): WslCliProbeResult {
  const requestedDistro = typeof options?.distro === 'string' ? options.distro.trim() : ''

  if (!options?.force && cachedProbe && (!requestedDistro || cachedProbe.distro === requestedDistro)) {
    return cachedProbe
  }

  const distro = requestedDistro || resolveDefaultWslDistro()
  const probedAt = Date.now()

  let entries: WslCliProbeEntry[]
  let error: null | string

  try {
    entries = toEntries(parseProbeOutput(execImpl('wsl.exe', ['-d', distro, '-e', 'bash', '-lc', PROBE_SCRIPT])))
    error = null
  } catch (failure) {
    entries = emptyEntries()
    error = classifyProbeFailure(failure)
  }

  let distros: string[] = []

  try {
    distros = parseDistroList(execImpl('wsl.exe', ['-l', '-q']))
  } catch {
    // The CLI probe already owns the failure story; the distro list is only a
    // convenience for a future picker, so a failure here never sets `error`.
    distros = []
  }

  if (distros.length === 0) {
    distros = [distro]
  }

  const result: WslCliProbeResult = { distro, distros, entries, error, probedAt }

  cachedProbe = result

  if (error === null) {
    // A successful probe refreshes the opt-in snapshot timestamp (T3): the
    // renderer pairs "these CLIs were available at probedAt" with the user's
    // selections.
    const current = readOptinState()

    writeOptinState({ optin: current.optin, probedAt })
  }

  return result
}

/** Clear the process-internal probe cache (next probe re-runs). */
export function probeCacheInvalidate(): void {
  cachedProbe = null
}

// ── opt-in (persisted to userData/wsl-cli.json — see wsl-cli-persist.ts) ─────

let optinFilePath: null | string = null

/**
 * Point the opt-in store at a userData directory. Called once by
 * wsl-cli-ipc.ts (the Electron-facing entry point). With no directory the state
 * stays in memory, which is the fallback under vitest and the safe default if
 * userData is unavailable.
 */
export function configureWslCliOptinPersistence(userDataDir: null | string): void {
  const dir = typeof userDataDir === 'string' ? userDataDir.trim() : ''

  optinFilePath = dir ? wslCliOptinFilePath(dir) : null

  resetWslCliPersistCache()
}

function readOptinState(): WslCliOptinState {
  return readWslCliOptinFile(optinFilePath, WSL_CLI_NAMES)
}

function writeOptinState(state: WslCliOptinState): WslCliOptinState {
  return writeWslCliOptinFile(optinFilePath, state, WSL_CLI_NAMES)
}

/** Read the current opt-in table (five keys, default all false). */
export function readWslCliOptin(): WslCliOptin {
  return readOptinState().optin
}

/** Read the full opt-in state (table + last probe snapshot time). */
export function readWslCliOptinState(): WslCliOptinState {
  return readOptinState()
}

/**
 * Merge-write opt-in flags (partial patch over the five-key table) and return
 * the resulting state. Unknown keys are ignored; the table always keeps all
 * five keys, and a corrupt/missing file degrades to all-false rather than
 * throwing. The persisted snapshot (and the write itself) is best-effort.
 */
export function writeWslCliOptin(patch: Partial<WslCliOptin>): WslCliOptinState {
  const current = readOptinState()
  const optin = { ...current.optin }

  for (const name of WSL_CLI_NAMES) {
    if (patch && typeof patch[name] === 'boolean') {
      optin[name] = Boolean(patch[name])
    }
  }

  return writeOptinState({ optin, probedAt: current.probedAt })
}
