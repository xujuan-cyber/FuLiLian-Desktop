/**
 * backend-probes.ts
 *
 * Cheap "does this candidate backend actually work" checks used by
 * resolveFulilianBackend (main.ts). The resolver walks a ladder of
 * candidates -- bootstrap marker, `fulilian` on PATH, system Python with
 * fulilian_cli installed -- and historically returned the first candidate
 * whose binary existed on disk. That assumption breaks when a user has
 * a pre-installed Python 3.11-3.13 (so findSystemPython() returns a
 * path) but no fulilian_cli in its site-packages: the resolver hands back
 * a backend the spawn step can't actually run, and the user gets a
 * dead-on-arrival "ModuleNotFoundError: No module named 'fulilian_cli'"
 * instead of the first-launch installer.
 *
 * These probes give the resolver a way to verify a candidate before
 * trusting it. Failure (non-zero exit, exception, timeout) means "skip
 * this rung, try the next one"; success means "spawn this for real."
 * Falling off the bottom of the ladder lands on the bootstrap-needed
 * sentinel, which is exactly what we want when nothing pre-existing
 * actually works.
 *
 * Both probes are deliberately fast and forgiving:
 *   - default 15s timeout (5s was too short on cold Windows disks / AV;
 *     issue #61764 death-loop) with FULILIAN_PROBE_TIMEOUT_MS override
 *   - one automatic retry after a timeout before declaring the runtime dead
 *   - stdio ignored (we only care about exit code; stdout/stderr are
 *     not surfaced to the user, just to recentFulilianLog for forensics
 *     via the caller's catch block if it chooses)
 *   - any throw -> false (never propagate -- resolver wants a boolean)
 *
 * Kept in a standalone ts module so it can be unit-tested with
 * `node --test` without dragging in the electron runtime (same pattern
 * as bootstrap-platform.ts and hardening.ts).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 异步执行底座：探针原为**同步**子进程调用，真机实测阻塞 ≈639 ms 且正好压在
// 窗口 reveal 之前（P1 v2 立项理由）。改 `execFile` 后主线程可在等待期间处理
// `ready-to-show`。回调版与原同步版的 option 语义一致（timeout /
// windowsHide / shell / cwd / env / stdio）。
const execFileAsync = promisify(execFile) as (
  file: string,
  args: readonly string[],
  options?: any
) => Promise<{ stdout: string; stderr: string }>

/** Default probe budget. 5s false-negativeed healthy Windows cold starts (#61764). */
const DEFAULT_PROBE_TIMEOUT_MS = 15_000

/**
 * Resolve the backend probe timeout (ms).
 * Honours FULILIAN_PROBE_TIMEOUT_MS when it parses as a positive integer.
 */
function resolveProbeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FULILIAN_PROBE_TIMEOUT_MS

  if (raw == null || raw === '') {
    return DEFAULT_PROBE_TIMEOUT_MS
  }

  const n = Number.parseInt(String(raw), 10)

  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_PROBE_TIMEOUT_MS
  }

  // Clamp absurd values (ms) so a typo can't hang startup forever.
  return Math.min(n, 120_000)
}

const PROBE_TIMEOUT_MS = resolveProbeTimeoutMs()

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }

  const e = err as { code?: string; killed?: boolean; signal?: string }

  if (e.killed === true) {
    return true
  }

  if (e.code === 'ETIMEDOUT') {
    return true
  }

  // Node marks a timed-out execFile with SIGTERM on some platforms.
  if (e.signal === 'SIGTERM') {
    return true
  }

  return false
}

/**
 * Run the probe asynchronously; on timeout only, retry once before failing.
 * Non-timeout failures (ENOENT, non-zero exit) fail immediately.
 *
 * 语义与旧 `execProbeSync` 逐项一致，仅把同步阻塞换成可让出主线程的异步等待：
 * 默认 15 s 预算（`PROBE_TIMEOUT_MS`）、超时后重试一次（`isTimeoutError` 判定
 * 不变）、非超时错误立即上抛、`windowsHide` / `shell` / `stdio` 参数透传。
 */
async function execProbe(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    stdio: 'ignore'
    timeout: number
    shell?: boolean
    windowsHide?: boolean
  }
): Promise<void> {
  try {
    await execFileAsync(command, args, options)
  } catch (err) {
    if (!isTimeoutError(err)) {
      throw err
    }

    // One cold-cache / AV miss should not force fulilian-setup --update (#61764).
    await execFileAsync(command, args, options)
  }
}

/**
 * Return the Python snippet used to verify Fulilian can import far enough to
 * launch the CLI. Kept exported for tests so dependency regressions are
 * caught without needing a real broken venv fixture.
 *
 * @returns {string}
 */
function fulilianRuntimeImportProbe() {
  return 'import yaml; import dotenv; import fulilian_cli.config'
}

/**
 * Return true iff the Fulilian runtime import probe exits 0.
 *
 * Used to gate the "fallback to system Python with fulilian_cli installed"
 * rung of resolveFulilianBackend. Without this, a system Python 3.11-3.13
 * registered in PEP 514 makes findSystemPython() succeed regardless of
 * whether fulilian_cli has actually been pip-installed into its
 * site-packages -- and the resolver returns a backend that immediately
 * dies on spawn.
 *
 * The probe intentionally imports fulilian_cli.config, not just the top-level
 * package: a broken/empty Windows launcher venv can still see the source tree
 * through PYTHONPATH but lack PyYAML, then die on the first real CLI import.
 *
 * @param {string} pythonPath - Absolute path to a python.exe / python.
 * @param {object} [opts.env] - Additional environment for the probe.
 * @returns {Promise<boolean>}
 */
async function canImportFulilianCli(
  pythonPath: string,
  opts: { env?: Record<string, string> } = {}
): Promise<boolean> {
  if (!pythonPath) {
    return false
  }

  try {
    await execProbe(pythonPath, ['-c', fulilianRuntimeImportProbe()], {
      env: { ...process.env, ...(opts.env || {}) },
      stdio: 'ignore',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true
    })

    return true
  } catch {
    return false
  }
}

/**
 * Return true iff `<fulilianCommand> --version` exits 0.
 *
 * Used to gate the "existing `fulilian` on PATH" rung. Without this, a
 * stale fulilian.cmd shim left behind by an uninstalled pip install (or
 * a half-built venv whose `fulilian` entry-point points at a deleted
 * Python) survives findOnPath() and gets selected as the backend.
 *
 * We intentionally avoid invoking the command with the dashboard args
 * here -- `--version` is the cheapest "is this binary alive" smoke
 * test that every fulilian_cli entry-point has supported since 0.1.
 *
 * @param {string} fulilianCommand - Resolved absolute path to a fulilian
 *   executable (or an interpreter+script wrapper).
 * @param {boolean} [opts.shell] - Whether to run through a shell. For
 *   .cmd/.bat shims on Windows execFile needs shell:true to find
 *   the cmd interpreter; mirrors the same flag isCommandScript() drives
 *   in resolveFulilianBackend.
 * @returns {Promise<boolean>}
 */
/**
 * An explicit desktop backend command is a deployment contract, not a PATH
 * discovery candidate. In particular, the Nix desktop wrapper points this at
 * its immutable, matching Fulilian package; it must never fall through to the
 * mutable install-script bootstrap path if a best-effort probe is slow.
 */
function shouldTrustFulilianOverride(fulilianOverride?: string) {
  return typeof fulilianOverride === 'string' && fulilianOverride.trim().length > 0
}

async function verifyFulilianCli(fulilianCommand: string, opts?: { shell?: boolean }): Promise<boolean> {
  if (!fulilianCommand) {
    return false
  }

  try {
    await execProbe(fulilianCommand, ['--version'], {
      stdio: 'ignore',
      timeout: PROBE_TIMEOUT_MS,
      shell: Boolean(opts?.shell),
      windowsHide: true
    })

    return true
  } catch {
    return false
  }
}

export {
  canImportFulilianCli,
  DEFAULT_PROBE_TIMEOUT_MS,
  execFileAsync,
  execProbe,
  fulilianRuntimeImportProbe,
  PROBE_TIMEOUT_MS,
  resolveProbeTimeoutMs,
  shouldTrustFulilianOverride,
  verifyFulilianCli
}
