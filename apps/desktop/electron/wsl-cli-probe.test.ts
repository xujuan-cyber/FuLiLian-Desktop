// Probe behavior + contract-shape assertions (step09 v2 · T1/T2, E1/E2/E3/E7/E12).
//
// Every test injects a synthetic exec through the v1-frozen
// WslCliProbeExecDeps.exec seam. No test may call the real
// `execFileSync('wsl.exe', ...)`: wsl.exe is on the WorkBuddy command blacklist
// and the blacklist is inherited down the process chain, so a real spawn is
// both forbidden and useless here. `beforeEach` installs a tripwire exec so an
// un-injected probe fails loudly instead of spawning.
import assert from 'node:assert/strict'

import { afterEach, beforeEach, describe, test, vi } from 'vitest'

// The one path that could still reach a real `wsl.exe` is the default-distro
// fallback, which lives in wsl-path-bridge.ts and spawns `wsl.exe -l -q`.
// Pin it to a constant so no test can spawn anything (T7: 测试内不得调用真实
// execFileSync('wsl.exe')).
vi.mock('./wsl-path-bridge', () => ({
  resolveDefaultWslDistro: () => 'Ubuntu'
}))

import {
  buildWslProbeExecOptions,
  configureWslCliOptinPersistence,
  configureWslCliProbeExec,
  defaultWslCliProbeExec,
  parseDistroList,
  probeCacheInvalidate,
  probeWslClis,
  readWslCliOptin,
  readWslCliOptinState,
  writeWslCliOptin,
  WSL_CLI_NAMES,
  WSL_CLI_PROBE_ERROR
} from './wsl-cli-probe'

const FROZEN_ORDER = ['claude', 'codex', 'codebuddy', 'hermes', 'fulilian']

/** Synthetic `wsl.exe -l -q` output: two distros, NUL-free. */
const DISTRO_LIST_OUTPUT = 'Ubuntu\nDebian\n'

/** Synthetic probe-script output: TAB-delimited, every availability shape. */
const PROBE_OUTPUT = [
  'claude\t/usr/local/bin/claude\t2.1.0 (Claude Code)',
  'codex\t/usr/local/bin/codex\t',
  'codebuddy\t\t',
  'hermes\t/home/me/.local/bin/hermes\thermes 0.9.0',
  'fulilian\t/usr/bin/fulilian\tfulilian 1.3.0'
].join('\n')

function isDistroListCall(args: string[]): boolean {
  return args[0] === '-l' && args[1] === '-q'
}

/** Record every exec call and answer from `handler`. */
function makeExec(handler: (args: string[]) => string) {
  const calls: { args: string[]; file: string }[] = []

  return {
    calls,
    deps: {
      exec: (file: string, args: string[]) => {
        calls.push({ args, file })

        return handler(args)
      }
    }
  }
}

function cliProbeCalls(calls: { args: string[]; file: string }[]) {
  return calls.filter(call => !isDistroListCall(call.args))
}

/** A failure the way node surfaces it (code / status / signal / message). */
function execFailure(properties: Record<string, unknown>): Error {
  return Object.assign(new Error(String(properties.message || 'exec failed')), properties)
}

beforeEach(() => {
  // Tripwire: any probe that forgets to inject a fixture must fail here rather
  // than reach the real execFileSync and spawn wsl.exe.
  configureWslCliProbeExec({
    exec: () => {
      throw new Error('unit test reached the real exec seam — inject a fixture')
    }
  })
  probeCacheInvalidate()
  configureWslCliOptinPersistence(null)
})

afterEach(() => {
  configureWslCliProbeExec()
  probeCacheInvalidate()
  configureWslCliOptinPersistence(null)
})

test('WSL_CLI_NAMES has exactly the five frozen CLIs in frozen order', () => {
  assert.equal(WSL_CLI_NAMES.length, 5)
  assert.deepEqual([...WSL_CLI_NAMES], FROZEN_ORDER)
})

// ── T1 · single-spawn probe + parsing ────────────────────────────────────────

test('E2/a success: one CLI-probe spawn yields five ordered entries and error=null', () => {
  const { calls, deps } = makeExec(args => (isDistroListCall(args) ? DISTRO_LIST_OUTPUT : PROBE_OUTPUT))
  configureWslCliProbeExec(deps)

  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(result.error, null, 'a partial result is still a successful probe')
  assert.equal(result.distro, 'Ubuntu')
  assert.deepEqual(result.distros, ['Ubuntu', 'Debian'])
  assert.equal(result.entries.length, 5)
  assert.deepEqual(
    result.entries.map(entry => entry.name),
    FROZEN_ORDER
  )
  assert.deepEqual(
    result.entries.map(entry => entry.available),
    [true, true, false, true, true]
  )
  assert.equal(result.entries[0].posixPath, '/usr/local/bin/claude')
  assert.equal(result.entries[0].version, '2.1.0 (Claude Code)')
  // available but version-less → available:true / version:null is not a degraded state
  assert.equal(result.entries[1].available, true)
  assert.equal(result.entries[1].version, null)
  assert.equal(result.entries[2].posixPath, null)
  assert.equal(result.entries[2].version, null)
  assert.equal(result.entries[3].version, 'hermes 0.9.0')
  assert.equal(result.entries[4].version, 'fulilian 1.3.0')
  assert.equal(typeof result.probedAt, 'number')

  // Exactly one spawn for the five CLIs — not five (T1: 单次 spawn).
  const cliCalls = cliProbeCalls(calls)

  assert.equal(cliCalls.length, 1)
  assert.equal(cliCalls[0].file, 'wsl.exe')
  assert.deepEqual(cliCalls[0].args.slice(0, 5), ['-d', 'Ubuntu', '-e', 'bash', '-lc'])
  // `-l` login shell is mandatory or nvm / ~/.local/bin are invisible.
  assert.ok(cliCalls[0].args[5].includes('command -v'), 'probe script must use command -v')
  assert.ok(cliCalls[0].args[5].includes('--version'), 'probe script must resolve versions')
  assert.equal(calls.filter(call => isDistroListCall(call.args)).length, 1)
})

test('E2/b timeout: five all-unavailable entries and a timeout class token', () => {
  const { deps } = makeExec(() => {
    throw execFailure({ code: 'ETIMEDOUT', message: 'spawnSync wsl.exe ETIMEDOUT', signal: 'SIGTERM' })
  })

  configureWslCliProbeExec(deps)

  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(result.error, WSL_CLI_PROBE_ERROR.timeout)
  assert.equal(result.entries.length, 5)
  assert.deepEqual(
    result.entries.map(entry => entry.name),
    FROZEN_ORDER
  )

  for (const entry of result.entries) {
    assert.equal(entry.available, false)
    assert.equal(entry.posixPath, null)
    assert.equal(entry.version, null)
  }

  assert.deepEqual(result.distros, ['Ubuntu'], 'distro list degrades to the probed distro')
})

test('E2/c non-zero exit: five all-unavailable entries and a non-zero-exit class token', () => {
  const { deps } = makeExec(() => {
    throw execFailure({ message: 'Command failed: wsl.exe -d Ubuntu', status: 127 })
  })

  configureWslCliProbeExec(deps)

  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(typeof result.error, 'string')
  assert.ok(result.error!.startsWith(WSL_CLI_PROBE_ERROR.nonZeroExit), `unexpected error: ${result.error}`)
  assert.equal(result.entries.length, 5)
  assert.deepEqual(
    result.entries.map(entry => entry.available),
    [false, false, false, false, false]
  )
})

test('E2/d empty output: five all-unavailable entries, still a parsed result', () => {
  const { deps } = makeExec(args => (isDistroListCall(args) ? '' : ''))
  configureWslCliProbeExec(deps)

  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(result.entries.length, 5)
  assert.deepEqual(
    result.entries.map(entry => entry.name),
    FROZEN_ORDER
  )

  for (const entry of result.entries) {
    assert.equal(entry.available, false)
  }

  assert.deepEqual(result.distros, ['Ubuntu'])
})

test('E2/e NUL-polluted output is stripped before parsing (parseDefaultDistro discipline)', () => {
  // wsl.exe emits UTF-16LE without a BOM on older builds: every character is
  // followed by a NUL when WSL_UTF8 is not honored.
  const polluted = PROBE_OUTPUT.split('').join('\0')
  const { deps } = makeExec(args => (isDistroListCall(args) ? DISTRO_LIST_OUTPUT.split('').join('\0') : polluted))
  configureWslCliProbeExec(deps)

  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(result.error, null)
  assert.deepEqual(result.distros, ['Ubuntu', 'Debian'])
  assert.deepEqual(
    result.entries.map(entry => entry.available),
    [true, true, false, true, true]
  )
  assert.equal(result.entries[0].posixPath, '/usr/local/bin/claude')
})

test('E12 spawn refused (EPERM) degrades without bubbling and keeps the five-entry shape', () => {
  const { deps } = makeExec(() => {
    throw execFailure({ code: 'EPERM', message: 'spawnSync wsl.exe EPERM' })
  })

  configureWslCliProbeExec(deps)

  let result: ReturnType<typeof probeWslClis> | undefined
  assert.doesNotThrow(() => {
    result = probeWslClis({ distro: 'Ubuntu' })
  })

  assert.equal(result!.error, WSL_CLI_PROBE_ERROR.spawnFailed)
  assert.equal(result!.entries.length, 5)
  assert.deepEqual(
    result!.entries.map(entry => entry.name),
    FROZEN_ORDER
  )

  for (const entry of result!.entries) {
    assert.equal(entry.available, false)
  }

  // Single-line and free of anything but the class token — the renderer
  // interpolates this into "Detection failed (<reason>)".
  assert.equal(result!.error!.includes('\n'), false)
  assert.deepEqual(result!.distros, ['Ubuntu'])
})

test('E12 EACCES is also classified as spawn-failed, not as an empty result', () => {
  const { deps } = makeExec(() => {
    throw execFailure({ code: 'EACCES', message: 'spawnSync wsl.exe EACCES' })
  })

  configureWslCliProbeExec(deps)

  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(result.error, WSL_CLI_PROBE_ERROR.spawnFailed)
  assert.equal(result.entries.length, 5)
  assert.deepEqual(
    result.entries.map(entry => entry.name),
    FROZEN_ORDER
  )

  for (const entry of result.entries) {
    assert.equal(entry.available, false)
  }
})

test('an unknown exec failure classifies as probe-failed, not as success', () => {
  const { deps } = makeExec(() => {
    throw execFailure({ message: 'something else entirely' })
  })

  configureWslCliProbeExec(deps)

  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(result.error, WSL_CLI_PROBE_ERROR.failed)
  assert.equal(result.entries.length, 5)
})

test('T6-shaped hardening: a non-string distro option never throws', () => {
  const { deps } = makeExec(args => (isDistroListCall(args) ? DISTRO_LIST_OUTPUT : PROBE_OUTPUT))
  configureWslCliProbeExec(deps)

  let result: ReturnType<typeof probeWslClis> | undefined
  assert.doesNotThrow(() => {
    result = probeWslClis({ distro: 123 as unknown as string })
  })
  assert.equal(result!.distro, 'Ubuntu', 'falls back to resolveDefaultWslDistro()')
  assert.equal(result!.entries.length, 5)
})

// ── T2 · distros ─────────────────────────────────────────────────────────────

test('E3 parseDistroList returns every distro, not just the default', () => {
  assert.deepEqual(parseDistroList('Ubuntu\nDebian\nAlpine\n'), ['Ubuntu', 'Debian', 'Alpine'])
  assert.deepEqual(parseDistroList('* Ubuntu-22.04\n  Debian\n\nUbuntu-22.04\n'), ['Ubuntu-22.04', 'Debian'])
  assert.deepEqual(parseDistroList('U\0b\0u\0n\0t\0u\0\n\0'), ['Ubuntu'])
  assert.deepEqual(parseDistroList(''), [])
  assert.deepEqual(parseDistroList('   \n\r\n'), [])
})

test('E3 the probe reports the full distro list from a synthetic multi-distro fixture', () => {
  const { deps } = makeExec(args => (isDistroListCall(args) ? 'Ubuntu\nDebian\nkali-linux\n' : PROBE_OUTPUT))
  configureWslCliProbeExec(deps)

  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(result.distros.length, 3)
  assert.deepEqual(result.distros, ['Ubuntu', 'Debian', 'kali-linux'])
  assert.equal(result.distro, 'Ubuntu', 'the probed distro stays the single authoritative target')
})

test('a failing distro listing degrades to [distro] without poisoning error', () => {
  const { deps } = makeExec(args => {
    if (isDistroListCall(args)) {
      throw execFailure({ code: 'EPERM', message: 'spawnSync wsl.exe EPERM' })
    }

    return PROBE_OUTPUT
  })

  configureWslCliProbeExec(deps)

  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(result.error, null, 'the CLI probe succeeded; distros is a convenience only')
  assert.deepEqual(result.distros, ['Ubuntu'])
  assert.equal(result.distros.length >= 1, true, 'distros must never be an empty array')
})

// ── caching / force / invalidation (contract §D) ─────────────────────────────

test('the probe result is cached, forced re-probes, and invalidation clears it', () => {
  const { calls, deps } = makeExec(args => (isDistroListCall(args) ? DISTRO_LIST_OUTPUT : PROBE_OUTPUT))
  configureWslCliProbeExec(deps)

  const first = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(cliProbeCalls(calls).length, 1)

  const cached = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(cached, first, 'same object identity → served from cache')
  assert.equal(cliProbeCalls(calls).length, 1, 'a cache hit spawns nothing')

  const forced = probeWslClis({ distro: 'Ubuntu', force: true })

  assert.notEqual(forced, first)
  assert.equal(cliProbeCalls(calls).length, 2)

  probeCacheInvalidate()
  const afterInvalidate = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(cliProbeCalls(calls).length, 3)
  assert.notEqual(afterInvalidate, forced)
})

// ── opt-in (merge-write + persisted snapshot timestamp) ──────────────────────

test('readWslCliOptin defaults to five keys, all false', () => {
  const optin = readWslCliOptin()

  assert.equal(Object.keys(optin).length, 5)

  for (const name of WSL_CLI_NAMES) {
    assert.equal(optin[name], false)
  }
})

test('writeWslCliOptin merges: toggling claude leaves the other four keys false', () => {
  const state = writeWslCliOptin({ claude: true })

  assert.equal(state.optin.claude, true)
  assert.equal(state.optin.codex, false)
  assert.equal(state.optin.codebuddy, false)
  assert.equal(state.optin.hermes, false)
  assert.equal(state.optin.fulilian, false)
  assert.equal(readWslCliOptin().claude, true, 'get-optin reflects the new value')
})

test('writeWslCliOptin with an empty or hostile patch does not throw and keeps five keys', () => {
  assert.doesNotThrow(() => writeWslCliOptin({}))
  assert.doesNotThrow(() => writeWslCliOptin({ nope: true } as never))
  assert.doesNotThrow(() => writeWslCliOptin({ claude: 'yes' } as never))

  const optin = readWslCliOptin()

  assert.equal(Object.keys(optin).length, 5)
  assert.equal(optin.claude, false, 'a non-boolean value is ignored, not coerced to true')
})

test('probedAt starts null and is refreshed by a successful probe only', () => {
  assert.equal(readWslCliOptinState().probedAt, null)

  const failing = makeExec(() => {
    throw execFailure({ code: 'EPERM', message: 'spawnSync wsl.exe EPERM' })
  })

  configureWslCliProbeExec(failing.deps)
  probeWslClis({ distro: 'Ubuntu' })

  assert.equal(readWslCliOptinState().probedAt, null, 'a degraded probe records no snapshot time')

  const succeeding = makeExec(args => (isDistroListCall(args) ? DISTRO_LIST_OUTPUT : PROBE_OUTPUT))
  configureWslCliProbeExec(succeeding.deps)
  const result = probeWslClis({ distro: 'Ubuntu', force: true })

  assert.equal(readWslCliOptinState().probedAt, result.probedAt)
  assert.equal(typeof result.probedAt, 'number')
})

test('a probe failure is classified but never surfaces as a thrown IPC error', () => {
  const { deps } = makeExec(() => {
    throw execFailure({ code: 'EPERM', message: 'spawnSync wsl.exe EPERM' })
  })

  configureWslCliProbeExec(deps)

  assert.doesNotThrow(() => probeWslClis({ distro: undefined }))
  assert.doesNotThrow(() => probeWslClis({ force: true }))
  assert.equal(readWslCliOptinState().optin.claude, false, 'failure never fabricates availability or opt-in')
})

// ── real spawn seam (step 11-A T1) ───────────────────────────────────────────
//
// The injected-exec tests above cover everything *after* the exec seam; the
// real `execFileSync` option contract and the real error mapping had zero
// coverage (DEV-A v2 receipt §遗留风险 3). This describe drives the exported
// `defaultWslCliProbeExec` — the plain `execFileSync` implementation — with
// `process.execPath` (node) as a controlled fake executable, then routes the
// result through the unchanged `probeWslClis` chain. wsl.exe itself is never
// spawned (command blacklist; also pointless here).

/** base64 so the payload (which contains NUL bytes) can cross argv safely. */
function base64Payload(text: string): string {
  return Buffer.from(text, 'latin1').toString('base64')
}

/** Insert a NUL between every character, mimicking wsl.exe's UTF-16LE-ish output. */
function nulInterleave(text: string): string {
  return text
    .split('')
    .join('\0')
}

describe('real spawn seam', () => {
  afterEach(() => {
    configureWslCliProbeExec()
    probeCacheInvalidate()
  })

  test('(c) buildWslProbeExecOptions exposes the exact execFileSync option contract', () => {
    const options = buildWslProbeExecOptions()

    assert.equal(options.encoding, 'utf8')
    assert.equal(options.env?.WSL_UTF8, '1')
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore'])
    assert.equal(options.timeout, 8000)
    assert.equal(options.windowsHide, true)
  })

  test('(c) buildWslProbeExecOptions: test-only timeout override changes timeout only', () => {
    const overridden = buildWslProbeExecOptions({ timeout: 50 })

    assert.equal(overridden.timeout, 50)
    assert.equal(overridden.encoding, 'utf8')
    assert.equal(overridden.env?.WSL_UTF8, '1')
    assert.deepEqual(overridden.stdio, ['ignore', 'pipe', 'ignore'])
    assert.equal(overridden.windowsHide, true)
    // The default call is unaffected — the default value must not drift.
    assert.equal(buildWslProbeExecOptions().timeout, 8000)
  })

  test('(a) real spawn: NUL-padded UTF-8 output survives the real exec and parses', () => {
    const lines = FROZEN_ORDER.map(name => `${name}\t/usr/bin/${name}\t${name}-1.0`)
    const script = `process.stdout.write(Buffer.from('${base64Payload(nulInterleave(lines.join('\n')))}', 'base64').toString('latin1'))`

    // Route both probe calls through the REAL exec, with node as the fake
    // wsl.exe: the probe call replays NUL-padded TAB-delimited lines, the
    // distro-list call replays a plain list.
    configureWslCliProbeExec({
      exec: (file, args) =>
        defaultWslCliProbeExec(
          process.execPath,
          ['-e', isDistroListCall(args) ? "process.stdout.write('kali\\n')" : script]
        )
    })

    const result = probeWslClis({ distro: 'kali', force: true })

    assert.equal(result.error, null)
    assert.deepEqual(
      result.entries,
      FROZEN_ORDER.map(name => ({ available: true, name, posixPath: `/usr/bin/${name}`, version: `${name}-1.0` }))
    )
  })

  test('(b) real spawn: non-zero exit maps to non-zero-exit:<status>', () => {
    configureWslCliProbeExec({
      exec: (file, args) => defaultWslCliProbeExec(process.execPath, ['-e', 'process.exit(3)'])
    })

    const result = probeWslClis({ distro: 'kali', force: true })

    // Actual token shape from classifyProbeFailure: `non-zero-exit: 3`
    // (space after the colon). Recorded verbatim, not re-shaped for the test.
    assert.equal(result.error, `${WSL_CLI_PROBE_ERROR.nonZeroExit}: 3`)
    assert.deepEqual(
      result.entries,
      FROZEN_ORDER.map(name => ({ available: false, name, posixPath: null, version: null }))
    )
  })

  test('(d) real spawn: missing executable maps to spawn-failed', () => {
    configureWslCliProbeExec({
      exec: () => defaultWslCliProbeExec('no-such-binary-11a-x.exe', [])
    })

    const result = probeWslClis({ distro: 'kali', force: true })

    assert.equal(result.error, WSL_CLI_PROBE_ERROR.spawnFailed)
    assert.deepEqual(
      result.entries,
      FROZEN_ORDER.map(name => ({ available: false, name, posixPath: null, version: null }))
    )
  })
})
