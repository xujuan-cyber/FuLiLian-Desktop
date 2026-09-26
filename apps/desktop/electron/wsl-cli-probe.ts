// WSL CLI discovery contract (step09 v1 — interface freeze only).
//
// This module owns the *shape* of the WSL CLI probe / opt-in surface shared by
// the main process, the preload bridge, and the renderer type view in
// src/global.d.ts. v1 intentionally ships types + a stub implementation: the
// real `wsl.exe` probing (command -v / --version / distro enumeration) lands
// in v2 via the injectable exec seam below — see the contract record at
// 协同编程/留档/step09-contract-v1.md.
//
// Style follows backend-command.ts: pure, injectable, unit-testable without
// Electron; exec-mode discipline (encoding / WSL_UTF8 / stdio / timeout /
// windowsHide) is copied from wsl-path-bridge.ts when v2 wires real probing.
import { resolveDefaultWslDistro } from './wsl-path-bridge'

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
 * Injectable exec seam for v2 real probing. v2 must call the injected exec
 * with the wsl-path-bridge discipline (execFileSync('wsl.exe', ...,
 * { encoding: 'utf8', env: { ...process.env, WSL_UTF8: '1' },
 * stdio: ['ignore', 'pipe', 'ignore'], timeout, windowsHide: true })).
 * v1 never spawns wsl.exe — it is sandbox-blacklisted in tool shells and the
 * stub below must stay spawn-free.
 */
export interface WslCliProbeExecDeps {
  exec: (file: string, args: string[]) => string
}

function emptyEntry(name: WslCliName): WslCliProbeEntry {
  return { available: false, name, posixPath: null, version: null }
}

// Process-internal probe cache + explicit invalidation (contract §四 D).
// v1 holds the stub result; v2 keeps the same slot for real probe results
// (force:true re-probes, probeCacheInvalidate() clears).
let cachedProbe: null | WslCliProbeResult = null

/**
 * Probe the installed WSL CLIs. v1 behavior: stub result — never spawns
 * wsl.exe, always returns 5 entries in WSL_CLI_NAMES order with
 * available:false and a non-null `error` marking the degraded state.
 */
export function probeWslClis(options?: { distro?: string; force?: boolean }): WslCliProbeResult {
  const requestedDistro = options?.distro?.trim() || ''

  if (!options?.force && cachedProbe && (!requestedDistro || cachedProbe.distro === requestedDistro)) {
    return cachedProbe
  }

  const distro = requestedDistro || resolveDefaultWslDistro()
  const result: WslCliProbeResult = {
    distro,
    distros: [distro], // v1 占位；v2 填 `wsl.exe -l -q` 全量清单（NUL 已剥离）
    entries: WSL_CLI_NAMES.map(emptyEntry),
    error: 'stub:not-implemented',
    probedAt: Date.now()
  }

  cachedProbe = result

  return result
}

/** Clear the process-internal probe cache (next probe re-runs). */
export function probeCacheInvalidate(): void {
  cachedProbe = null
}

function defaultOptin(): WslCliOptin {
  return { claude: false, codebuddy: false, codex: false, fulilian: false, hermes: false }
}

// v1 opt-in lives in a module-level memory table only — no disk persistence
// until v2 (contract open item #1: app.getPath('userData')/wsl-cli.json).
const optinTable: WslCliOptin = defaultOptin()
let optinProbedAt: null | number = null

/** Read the current opt-in table (five keys, default all false). */
export function readWslCliOptin(): WslCliOptin {
  return { ...optinTable }
}

/** Read the full opt-in state (table + last probe snapshot time). */
export function readWslCliOptinState(): WslCliOptinState {
  return { optin: readWslCliOptin(), probedAt: optinProbedAt }
}

/**
 * Merge-write opt-in flags (partial patch over the five-key table) and return
 * the resulting state. Unknown keys are ignored; the table always keeps all
 * five keys. v1 does not persist to disk.
 */
export function writeWslCliOptin(patch: Partial<WslCliOptin>): WslCliOptinState {
  for (const name of WSL_CLI_NAMES) {
    if (patch && typeof patch[name] === 'boolean') {
      optinTable[name] = Boolean(patch[name])
    }
  }

  return readWslCliOptinState()
}
