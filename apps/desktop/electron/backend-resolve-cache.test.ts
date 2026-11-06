/**
 * Tests for electron/backend-resolve-cache.ts.
 *
 * 纯逻辑 + 依赖注入：不 spawn 任何子进程、不读真实文件系统（全部注入假实现），
 * 因此可在 vitest（`--project electron`）下无宿主运行。
 *
 * 覆盖（对应提示词 §6-A5③）：
 *  - 命中零探测（hit 只读一次盘、不写盘、不触发解析阶梯）
 *  - 5 条失效指纹逐条（schemaVersion / platform / 候选根路径 / install stamp / 解析 env）
 *  - 损坏 JSON / schema 不符 / 非法 backend ⇒ 静默回退
 *  - 不缓存失败（bootstrap-needed / 无 command）
 *  - 写盘失败不抛
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  BACKEND_RESOLVE_CACHE_SCHEMA_VERSION,
  type BackendResolveCacheIO,
  buildResolveCacheFingerprint,
  createBackendResolveCache,
  isCacheableBackendResolution,
  parseBackendResolveCacheFile,
  type ResolveCacheFingerprint,
  resolveCacheFingerprintsMatch,
  type ResolvedBackendSnapshot
} from './backend-resolve-cache'

const CACHE_PATH = '/tmp/fulilian-backend-resolve-cache.json'

function baseInputs() {
  return {
    platform: 'win32',
    isPackaged: false,
    activeRoot: 'C:\\Users\\u\\AppData\\Local\\fulilian\\fulilian-agent',
    sourceRepoRoot: 'E:\\FuLilian-Desktop',
    installStamp: { commit: 'abc1234def', branch: 'main' },
    env: {
      FULILIAN_DESKTOP_FULILIAN_ROOT: 'E:\\checkout',
      FULILIAN_DESKTOP_FULILIAN: '',
      FULILIAN_DESKTOP_IGNORE_EXISTING: ''
    }
  }
}

function baseFingerprint(): ResolveCacheFingerprint {
  return buildResolveCacheFingerprint(baseInputs())
}

function baseBackend(): ResolvedBackendSnapshot {
  return {
    label: 'Fulilian at C:\\...\\fulilian-agent',
    command: 'C:\\...\\venv\\Scripts\\python.exe',
    args: ['-m', 'fulilian_cli.main', 'serve'],
    bootstrap: true,
    env: { PYTHONPATH: 'C:\\root', PYTHONUTF8: '1', PATH: 'C:\\...\\Scripts' },
    kind: 'python',
    shell: false,
    root: 'C:\\...\\fulilian-agent'
  }
}

function memoryIO(initial: string | null = null): BackendResolveCacheIO & { writes: string[]; reads: number } {
  let contents = initial

  const state = {
    writes: [] as string[],
    reads: 0,
    readFile: (_filePath: string) => {
      state.reads += 1

      return contents
    },
    writeFile: (_filePath: string, value: string) => {
      state.writes.push(value)
      contents = value
    },
    now: () => 0
  }

  return state
}

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

test('buildResolveCacheFingerprint: empty override env normalises to null (not empty string)', () => {
  const fp = baseFingerprint()

  assert.equal(fp.envOverrideFulilian, null)
  assert.equal(fp.envIgnoreExisting, null)
  assert.equal(fp.envOverrideRoot, 'E:\\checkout')
})

test('buildResolveCacheFingerprint: null install stamp becomes dev (both null)', () => {
  const fp = buildResolveCacheFingerprint({ ...baseInputs(), installStamp: null })

  assert.equal(fp.installStampCommit, null)
  assert.equal(fp.installStampBranch, null)
  assert.equal(fp.schemaVersion, BACKEND_RESOLVE_CACHE_SCHEMA_VERSION)
})

test('resolveCacheFingerprintsMatch: identical fingerprints match', () => {
  assert.equal(resolveCacheFingerprintsMatch(baseFingerprint(), baseFingerprint()), true)
})

test('失效指纹 1/5 · schemaVersion 变化 ⇒ 不匹配', () => {
  const a = baseFingerprint()
  const b = { ...baseFingerprint(), schemaVersion: BACKEND_RESOLVE_CACHE_SCHEMA_VERSION + 1 }

  assert.equal(resolveCacheFingerprintsMatch(a, b), false)
})

test('失效指纹 2/5 · platform 变化 ⇒ 不匹配', () => {
  const a = baseFingerprint()
  const b = { ...baseFingerprint(), platform: 'darwin' }

  assert.equal(resolveCacheFingerprintsMatch(a, b), false)
})

test('失效指纹 3/5 · 候选根路径集合变化（activeRoot / sourceRepoRoot / isPackaged）⇒ 不匹配', () => {
  const a = baseFingerprint()

  assert.equal(resolveCacheFingerprintsMatch(a, { ...a, activeRoot: null }), false)
  assert.equal(resolveCacheFingerprintsMatch(a, { ...a, sourceRepoRoot: 'D:\\other' }), false)
  assert.equal(resolveCacheFingerprintsMatch(a, { ...a, isPackaged: true }), false)
})

test('失效指纹 4/5 · install stamp 变化（commit / branch）⇒ 不匹配', () => {
  const a = baseFingerprint()

  assert.equal(resolveCacheFingerprintsMatch(a, { ...a, installStampCommit: 'zzz9999' }), false)
  assert.equal(resolveCacheFingerprintsMatch(a, { ...a, installStampBranch: 'release' }), false)
  // dev（无安装戳）与有戳不匹配
  const dev = buildResolveCacheFingerprint({ ...baseInputs(), installStamp: null })

  assert.equal(resolveCacheFingerprintsMatch(a, dev), false)
})

test('失效指纹 5/5 · 解析相关环境变量变化 ⇒ 不匹配', () => {
  const a = baseFingerprint()

  assert.equal(resolveCacheFingerprintsMatch(a, { ...a, envOverrideRoot: null }), false)
  assert.equal(resolveCacheFingerprintsMatch(a, { ...a, envOverrideFulilian: 'C:\\bin\\fulilian' }), false)
  assert.equal(resolveCacheFingerprintsMatch(a, { ...a, envIgnoreExisting: '1' }), false)
})

// ---------------------------------------------------------------------------
// 解析 / 校验
// ---------------------------------------------------------------------------

test('parseBackendResolveCacheFile: valid payload parses', () => {
  const parsed = parseBackendResolveCacheFile(
    JSON.stringify({ fingerprint: baseFingerprint(), backend: baseBackend(), savedAt: '2026-10-04T00:00:00.000Z' })
  )

  assert.ok(parsed)
  assert.equal(parsed.backend.command, baseBackend().command)
})

test('parseBackendResolveCacheFile: corrupt JSON ⇒ null', () => {
  assert.equal(parseBackendResolveCacheFile('{ not json'), null)
  assert.equal(parseBackendResolveCacheFile(''), null)
  assert.equal(parseBackendResolveCacheFile(null), null)
})

test('parseBackendResolveCacheFile: schema mismatch ⇒ null', () => {
  const raw = JSON.stringify({
    fingerprint: { ...baseFingerprint(), schemaVersion: 999 },
    backend: baseBackend(),
    savedAt: ''
  })

  assert.equal(parseBackendResolveCacheFile(raw), null)
})

test('parseBackendResolveCacheFile: bootstrap-needed / missing command ⇒ null (never cached)', () => {
  const bootstrapFile = JSON.stringify({
    fingerprint: baseFingerprint(),
    backend: { ...baseBackend(), kind: 'bootstrap-needed', command: null },
    savedAt: ''
  })

  const noCommandFile = JSON.stringify({
    fingerprint: baseFingerprint(),
    backend: { ...baseBackend(), command: '' },
    savedAt: ''
  })

  assert.equal(parseBackendResolveCacheFile(bootstrapFile), null)
  assert.equal(parseBackendResolveCacheFile(noCommandFile), null)
})

test('isCacheableBackendResolution: bootstrap:true with command is still cacheable', () => {
  assert.equal(isCacheableBackendResolution(baseBackend()), true)
  assert.equal(isCacheableBackendResolution({ ...baseBackend(), kind: 'bootstrap-needed', command: null }), false)
  assert.equal(isCacheableBackendResolution(null), false)
})

// ---------------------------------------------------------------------------
// load（命中零探测 / 回退）
// ---------------------------------------------------------------------------

test('load: 命中零探测 —— 只读一次盘、不写盘、返回缓存 backend', () => {
  const io = memoryIO(
    JSON.stringify({ fingerprint: baseFingerprint(), backend: baseBackend(), savedAt: 't' })
  )

  const cache = createBackendResolveCache(CACHE_PATH, io)

  // 建模 main.ts 命中路径：命中即返回，绝不触碰解析阶梯。
  let ladderCalls = 0
  const backend = cache.load(baseFingerprint()) ?? (ladderCalls += 1)

  assert.equal((backend as ResolvedBackendSnapshot).command, baseBackend().command)
  assert.equal(ladderCalls, 0, '命中时不得触发解析阶梯')
  assert.equal(io.reads, 1, '命中只读一次盘')
  assert.equal(io.writes.length, 0, 'load 只读，绝不写盘')
})

test('load: 指纹不符 ⇒ null（回退全阶梯）', () => {
  const io = memoryIO(JSON.stringify({ fingerprint: baseFingerprint(), backend: baseBackend(), savedAt: 't' }))
  const cache = createBackendResolveCache(CACHE_PATH, io)

  assert.equal(cache.load({ ...baseFingerprint(), platform: 'linux' }), null)
})

test('load: 损坏 JSON ⇒ null', () => {
  const io = memoryIO('{ broken')
  const cache = createBackendResolveCache(CACHE_PATH, io)

  assert.equal(cache.load(baseFingerprint()), null)
})

test('load: 读盘抛错 ⇒ null（不抛）', () => {
  const io: BackendResolveCacheIO = {
    readFile: () => {
      throw new Error('EACCES')
    },
    writeFile: () => undefined
  }

  const cache = createBackendResolveCache(CACHE_PATH, io)

  assert.equal(cache.load(baseFingerprint()), null)
})

// ---------------------------------------------------------------------------
// store（只缓存成功 / 写盘失败不抛）
// ---------------------------------------------------------------------------

test('store: 成功解析写盘并可在 load 命中', () => {
  const io = memoryIO(null)
  const cache = createBackendResolveCache(CACHE_PATH, io)

  cache.store(baseFingerprint(), baseBackend())

  assert.equal(io.writes.length, 1)
  assert.equal(cache.load(baseFingerprint())?.command, baseBackend().command)
})

test('store: 不缓存 bootstrap-needed 与无 command 的失败路径', () => {
  const io = memoryIO(null)
  const cache = createBackendResolveCache(CACHE_PATH, io)

  cache.store(baseFingerprint(), { ...baseBackend(), kind: 'bootstrap-needed', command: null })
  cache.store(baseFingerprint(), { ...baseBackend(), command: null })
  cache.store(baseFingerprint(), null)

  assert.equal(io.writes.length, 0, '失败解析一律不写缓存')
  assert.equal(cache.load(baseFingerprint()), null)
})

test('store: 写盘失败不抛（缓存是加速手段，绝不破坏启动）', () => {
  const io: BackendResolveCacheIO = {
    readFile: () => null,
    writeFile: () => {
      throw new Error('EROFS')
    }
  }

  const cache = createBackendResolveCache(CACHE_PATH, io)

  assert.doesNotThrow(() => cache.store(baseFingerprint(), baseBackend()))
})
