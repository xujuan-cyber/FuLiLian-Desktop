/**
 * backend-resolve-cache.ts
 *
 * 落盘缓存：把 `resolveFulilianBackend()` 的**成功**解析结果持久化到
 * `userData/backend-resolve-cache.json`，冷启动命中即直接返回 backend——零探针、
 * 零子进程。（立项：真机实测该同步解析阻塞 ≈639 ms，正好压在窗口 reveal 之前，
 * 推迟首屏约 0.6 s；本模块为「异步化」之后的第二刀。）
 *
 * 红线：只缓存成功解析（`bootstrap-needed` / 探针失败一律不写）；缓存不含任何
 * 凭据 / 令牌 / 密钥 / `process.env` 全量快照；损坏 / schema 不符 / 指纹不符 ⇒
 * `load` 静默返回 null；写盘失败一律吞掉（缓存绝不阻塞或破坏启动）。
 *
 * 纯逻辑 + 依赖注入（readFile / writeFile / now），不引用 electron / node 内建，
 * 可在 vitest / `node --test` 下无宿主运行。
 */

/** 缓存 schema 版本；不匹配即整条失效（回退全阶梯）。 */
export const BACKEND_RESOLVE_CACHE_SCHEMA_VERSION = 1

/** 可缓存的 backend 描述符快照（白名单字段，与 main.ts 解析结果同形）。 */
export interface ResolvedBackendSnapshot {
  label: string
  command: string | null
  args: string[]
  bootstrap: boolean
  env: Record<string, string>
  kind: string
  shell: boolean
  root?: string
}

/**
 * 失效指纹：任一字段变化即失效。分五组（对应 5 条失效维度）：
 * schemaVersion / platform / 候选根路径集合 / install stamp / 解析相关环境变量。
 */
export interface ResolveCacheFingerprint {
  schemaVersion: number
  platform: string
  isPackaged: boolean
  activeRoot: string | null
  sourceRepoRoot: string | null
  installStampCommit: string | null
  installStampBranch: string | null
  envOverrideRoot: string | null
  envOverrideFulilian: string | null
  envIgnoreExisting: string | null
}

export interface ResolveCacheFingerprintInputs {
  platform: string
  isPackaged: boolean
  activeRoot?: string | null
  sourceRepoRoot?: string | null
  installStamp?: { commit?: string | null; branch?: string | null } | null
  env?: Record<string, string | undefined>
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 由当前运行环境构造失效指纹。`installStamp` 为 null（dev，无安装戳）⇒
 * commit/branch 均记 null，与「无安装戳」等价。
 */
export function buildResolveCacheFingerprint(
  inputs: ResolveCacheFingerprintInputs,
  schemaVersion: number = BACKEND_RESOLVE_CACHE_SCHEMA_VERSION
): ResolveCacheFingerprint {
  const env = inputs.env || {}

  return {
    schemaVersion,
    platform: inputs.platform,
    isPackaged: Boolean(inputs.isPackaged),
    activeRoot: nullableString(inputs.activeRoot),
    sourceRepoRoot: nullableString(inputs.sourceRepoRoot),
    installStampCommit: nullableString(inputs.installStamp?.commit),
    installStampBranch: nullableString(inputs.installStamp?.branch),
    envOverrideRoot: nullableString(env.FULILIAN_DESKTOP_FULILIAN_ROOT),
    envOverrideFulilian: nullableString(env.FULILIAN_DESKTOP_FULILIAN),
    envIgnoreExisting: nullableString(env.FULILIAN_DESKTOP_IGNORE_EXISTING)
  }
}

/** 逐字段比较两个指纹；任一（含 schemaVersion）不同即不匹配。 */
export function resolveCacheFingerprintsMatch(a: ResolveCacheFingerprint, b: ResolveCacheFingerprint): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.platform === b.platform &&
    a.isPackaged === b.isPackaged &&
    a.activeRoot === b.activeRoot &&
    a.sourceRepoRoot === b.sourceRepoRoot &&
    a.installStampCommit === b.installStampCommit &&
    a.installStampBranch === b.installStampBranch &&
    a.envOverrideRoot === b.envOverrideRoot &&
    a.envOverrideFulilian === b.envOverrideFulilian &&
    a.envIgnoreExisting === b.envIgnoreExisting
  )
}

export interface BackendResolveCacheFile {
  fingerprint: ResolveCacheFingerprint
  backend: ResolvedBackendSnapshot
  savedAt: string
}

/**
 * 只有成功解析才可缓存：须有非空 `command`，且不是 `bootstrap-needed` 哨兵。
 * `bootstrap: true`（如 active runtime 需补建 venv）是合法成功结果，不受此限。
 */
export function isCacheableBackendResolution(backend: unknown): backend is ResolvedBackendSnapshot {
  if (!backend || typeof backend !== 'object') {
    return false
  }

  const b = backend as Partial<ResolvedBackendSnapshot>

  if (b.kind === 'bootstrap-needed') {
    return false
  }

  return typeof b.command === 'string' && b.command.length > 0
}

const FINGERPRINT_STRING_FIELDS: readonly (keyof ResolveCacheFingerprint)[] = [
  'platform',
  'activeRoot',
  'sourceRepoRoot',
  'installStampCommit',
  'installStampBranch',
  'envOverrideRoot',
  'envOverrideFulilian',
  'envIgnoreExisting'
]

function isFingerprintShape(value: unknown): value is ResolveCacheFingerprint {
  if (!value || typeof value !== 'object') {
    return false
  }

  const fp = value as Record<string, unknown>

  if (fp.schemaVersion !== BACKEND_RESOLVE_CACHE_SCHEMA_VERSION || typeof fp.isPackaged !== 'boolean') {
    return false
  }

  return FINGERPRINT_STRING_FIELDS.every(field => fp[field] === null || typeof fp[field] === 'string')
}

/** 解析缓存文件内容；损坏 / schema 不符 / 非法 backend ⇒ 返回 null（静默回退）。 */
export function parseBackendResolveCacheFile(raw: string | null | undefined): BackendResolveCacheFile | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const file = parsed as Record<string, unknown>

  if (!isFingerprintShape(file.fingerprint)) {
    return null
  }

  const backend = file.backend as Partial<ResolvedBackendSnapshot> | undefined

  if (!backend || typeof backend !== 'object') {
    return null
  }

  if (!Array.isArray(backend.args) || !backend.env || typeof backend.env !== 'object') {
    return null
  }

  if (!isCacheableBackendResolution(backend)) {
    return null
  }

  return {
    fingerprint: file.fingerprint,
    backend: backend as ResolvedBackendSnapshot,
    savedAt: typeof file.savedAt === 'string' ? file.savedAt : ''
  }
}

export interface BackendResolveCacheIO {
  /** 读缓存文件；缺失 / 不可读 ⇒ 返回 null。 */
  readFile: (filePath: string) => string | null
  /** 写缓存文件（实现方需自行确保父目录存在）。失败由 store 吞掉。 */
  writeFile: (filePath: string, contents: string) => void
  /** 时钟（测试注入）。 */
  now?: () => number
}

export interface BackendResolveCache {
  /** 命中（指纹相符 + backend 合法）⇒ 返回快照；否则 null。只读，绝不写盘。 */
  load: (currentFingerprint: ResolveCacheFingerprint) => ResolvedBackendSnapshot | null
  /** 只缓存成功解析；写盘失败静默吞掉。 */
  store: (currentFingerprint: ResolveCacheFingerprint, backend: unknown) => void
}

/**
 * 构造缓存句柄。`load` 命中即返回（调用方在命中路径上不得再执行任何探针）；
 * `store` 仅在成功解析时写盘，且从不抛错。
 */
export function createBackendResolveCache(cachePath: string, io: BackendResolveCacheIO): BackendResolveCache {
  return {
    load(currentFingerprint) {
      let raw: string | null

      try {
        raw = io.readFile(cachePath)
      } catch {
        return null
      }

      const file = parseBackendResolveCacheFile(raw)

      if (!file || !resolveCacheFingerprintsMatch(file.fingerprint, currentFingerprint)) {
        return null
      }

      return file.backend
    },
    store(currentFingerprint, backend) {
      if (!isCacheableBackendResolution(backend)) {
        return
      }

      const payload: BackendResolveCacheFile = {
        fingerprint: currentFingerprint,
        backend,
        savedAt: new Date(io.now ? io.now() : Date.now()).toISOString()
      }

      try {
        io.writeFile(cachePath, JSON.stringify(payload))
      } catch {
        // 缓存是加速手段：写盘失败绝不影响启动。
      }
    }
  }
}
