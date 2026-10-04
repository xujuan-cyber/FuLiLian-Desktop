/**
 * P13 · 全链路启动埋点（主进程侧纯逻辑）。
 *
 * 目的：把「冷启动到 composer 可用」拆成可复现的分段。主进程锚点覆盖
 * `app-start → window-shown → resolve → spawn → ready`（**本机实测顺序**：
 * 本应用先显窗口、后解析后端）；每个锚点只落一行到既有 desktop.log 管线
 * （复用 main.ts 的 `rememberLog` + `desktop-log-line.ts`），不新建第二套
 * 日志落盘机制。
 *
 * 渲染层（HTML parse → React mount → composer ready）经一条**窄 IPC 通道**
 * 回传：名字必须命中**固定白名单**、时间必须是**有限数字**，否则静默丢弃。
 * 渲染层自由文本 / console 输出永不进入 desktop.log（既有护栏语义只强不弱，
 * 见 `window-renderer-lifecycle.test.ts` 「must not be able to spill console
 * output into desktop.log」）。
 *
 * 本模块不引用 electron / node 内建：`performance` 用全局（Node ≥16 提供），
 * 日志落盘由调用方注入 `sink`，因此可在 `node` 环境下单测。
 */

/** 主进程启动锚点（固定集合）。顺序为**本机实测发生顺序**：
 *  `app-start → window-shown → resolve:start → resolve:end → spawn → ready`
 *  —— 阶段顺序因机而异，measure 产出与此数组顺序无关。 */
export const BOOT_MARK_NAMES = [
  'boot:app-start',
  'boot:window-shown',
  'boot:resolve:start',
  'boot:resolve:end',
  'boot:spawn',
  'boot:ready',
  // P13b: whenReady 链边界锚点 + 共享 single-flight await 边界锚点（均首现一次）。
  'boot:chain:begin',
  'boot:chain:end',
  'boot:await:login-shell:begin',
  'boot:await:login-shell:end'
] as const

export type BootMarkName = (typeof BOOT_MARK_NAMES)[number]

/** 渲染层启动锚点 —— 窄通道只接受这三个名字。 */
export const RENDERER_BOOT_MARK_NAMES = ['boot:html-parse', 'boot:react-mount', 'boot:composer-ready'] as const

export type RendererBootMarkName = (typeof RENDERER_BOOT_MARK_NAMES)[number]

/**
 * P13b：区间计时（span）标签固定集合 —— 每个标签只产出一次（首现），集合
 * 大小 ≤ 20，故整条链路 span 行数有界（不刷屏）。顺序与
 * `app.whenReady()` 回调体 + `createWindow()` + `startFulilian()` 前缀的
 * **调用顺序**一致，便于与真机日志逐行对齐。禁止输出集合外的任意字符串标签。
 */
export const BOOT_SPAN_LABELS = [
  'warmupLoginShellPath',
  'installWindowsSystemCaTrust',
  'enableBasicPasswordStoreEncryption',
  'migrateLegacyEncryptedSecretsOnce',
  'setApplicationMenu',
  'installMediaHandlers',
  'ensureWslWindowsFonts',
  'configureSpellChecker',
  'registerPowerResumeListeners',
  'keepAwakeSet',
  'readPersistedDisableF12',
  'primaryProfileKey',
  'setActiveGatewayProfile',
  'setWslBridgeProfileState',
  'applyQuickEntrySettings',
  'createDesktopTray',
  'createWindow',
  'reapOrphanedBackends',
  'advanceBootProgressResolve'
] as const

export type BootSpanLabel = (typeof BOOT_SPAN_LABELS)[number]

/** 固定可 grep 前缀：`grep '\[boot-timing\]' desktop.log`。 */
export const BOOT_TIMING_PREFIX = '[boot-timing]'

const BOOT_MARK_SET: ReadonlySet<string> = new Set(BOOT_MARK_NAMES)
const RENDERER_BOOT_MARK_SET: ReadonlySet<string> = new Set(RENDERER_BOOT_MARK_NAMES)

export function isBootMarkName(value: unknown): value is BootMarkName {
  return typeof value === 'string' && BOOT_MARK_SET.has(value)
}

export function isRendererBootMarkName(value: unknown): value is RendererBootMarkName {
  return typeof value === 'string' && RENDERER_BOOT_MARK_SET.has(value)
}

/** 主进程 mark 行（绝对时间戳由 desktop.log 行首的 ISO-UTC stamp 承载）。 */
export function formatBootMarkLine(name: BootMarkName): string {
  return `${BOOT_TIMING_PREFIX} mark ${name}`
}

/** 渲染层 mark 行：额外带渲染层自采的绝对 epoch ms（timeOrigin + now），
 *  供跨进程对齐 window-shown 与 composer-ready。 */
export function formatRendererBootMarkLine(name: RendererBootMarkName, epochMs: number): string {
  return `${BOOT_TIMING_PREFIX} mark ${name} t=${epochMs}`
}

/** measure 行：`<label> = <ms>ms`，ms 为 1 位小数。 */
export function formatBootMeasureLine(label: string, ms: number): string {
  return `${BOOT_TIMING_PREFIX} measure ${label} = ${ms}ms`
}

/** span 行：`span <label> = <ms>ms`，ms 为 1 位小数（与 measure 同款渲染）。 */
export function formatBootSpanLine(label: BootSpanLabel, ms: number): string {
  return `${BOOT_TIMING_PREFIX} span ${label} = ${ms}ms`
}

export interface RendererBootMark {
  name: RendererBootMarkName
  t: number
}

/**
 * 窄通道入参校验：**名字必须命中白名单**且 **t 必须是有限数字**，否则返回
 * null（调用方静默丢弃）。任何自由文本、超长字符串、NaN/Infinity 都被拒。
 */
export function parseRendererBootMark(name: unknown, t: unknown): RendererBootMark | null {
  if (!isRendererBootMarkName(name)) {
    return null
  }

  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return null
  }

  return { name, t: Math.round(t) }
}

interface BootMeasureSpec {
  label: string
  from: BootMarkName
  to: BootMarkName
}

/**
 * 分段计划：每次 mark 后遍历**全部**计划，凡「两端锚点齐备 且 该 label
 * 未产出」即产出 —— 与锚点到达顺序无关。
 *
 * `to - from < 0` 的组合**显式跳过**：阶段顺序因机而异（本应用实测
 * `window-shown` 早于 `resolve:start`），负值无意义，也**不得**静默取绝对值。
 *
 *  - `spawn→ready`：后端未 ready 的机器上两端不齐，自然不产出（不报错、不刷屏）。
 *  - `ready→window-shown` / `resolve→window-shown`：**本机永不产出** ——
 *    实测 `window-shown` 先于 `resolve:start`，二者恒为负值，被跳过。
 */
const BOOT_MEASURE_PLAN: readonly BootMeasureSpec[] = [
  { label: 'resolve', from: 'boot:resolve:start', to: 'boot:resolve:end' },
  { label: 'resolve→spawn', from: 'boot:resolve:end', to: 'boot:spawn' },
  { label: 'spawn→ready', from: 'boot:spawn', to: 'boot:ready' },
  { label: 'ready→window-shown', from: 'boot:ready', to: 'boot:window-shown' },
  { label: 'resolve→window-shown', from: 'boot:resolve:start', to: 'boot:window-shown' },
  { label: 'app-start→window-shown', from: 'boot:app-start', to: 'boot:window-shown' },
  { label: 'window-shown→resolve:start', from: 'boot:window-shown', to: 'boot:resolve:start' },
  // P13b：whenReady 链边界。本机实测 `window-shown` 晚于 `chain:begin`
  // （链体在窗口显示前就已开始），故 `window-shown→chain:begin` 恒为负值、
  // 被「倒挂跳过」诚实抑制；`chain:begin→chain:end` 则覆盖
  // 「whenReady 起 → 首次 resolveFulilianBackend 前」的整段（含空档）。
  { label: 'window-shown→chain:begin', from: 'boot:window-shown', to: 'boot:chain:begin' },
  { label: 'chain:begin→chain:end', from: 'boot:chain:begin', to: 'boot:chain:end' }
]

export interface BootTimingOptions {
  /** 单调时钟，默认 `performance.now()`（ms）。测试注入假时钟。 */
  now?: () => number
  /** 日志落盘（main.ts 传 `rememberLog`）。 */
  sink: (line: string) => void
}

export interface BootTiming {
  mark: (name: BootMarkName) => void
  has: (name: BootMarkName) => boolean
  /**
   * P13b 区间计时：包裹一次同步调用或返回 Promise 的调用，完成后产出**一次**
   * `span <label> = <ms>ms`（同一 label 只认首现）。`fn` 抛错 / reject 时
   * **原样上抛**（计时不改变行为），但仍产出该 span 行。
   */
  span: <T>(label: BootSpanLabel, fn: () => T) => T
}

/**
 * 记录启动锚点，并在**任一** mark 之后立即产出「两端齐备」的分段（顺序无关）。
 *
 * **每个名字只认首次出现**（冷启动那一刻），重复调用被忽略 —— 这样整条链路
 * 产出有界的十几行日志，而不是每次 resolve / 每个窗口都刷屏。
 */
export function createBootTiming({ now = () => performance.now(), sink }: BootTimingOptions): BootTiming {
  const marks = new Map<BootMarkName, number>()
  const emitted = new Set<string>()
  const emittedSpans = new Set<BootSpanLabel>()

  // 顺序无关：每次 mark 后重扫全部计划，两端齐备且未产出的立即产出。
  const emitReadyMeasures = () => {
    for (const spec of BOOT_MEASURE_PLAN) {
      if (emitted.has(spec.label)) {
        continue
      }

      const from = marks.get(spec.from)
      const to = marks.get(spec.to)

      if (from === undefined || to === undefined) {
        continue
      }

      const delta = to - from

      // 阶段顺序因机而异（本应用实测 window-shown 早于 resolve）：
      // 跳过倒挂组合 —— 绝不产出负值，也不静默取绝对值。
      if (delta < 0) {
        continue
      }

      emitted.add(spec.label)
      sink(formatBootMeasureLine(spec.label, Math.round(delta * 10) / 10))
    }
  }

  return {
    has: name => marks.has(name),
    mark(name) {
      if (marks.has(name)) {
        return
      }

      marks.set(name, now())
      sink(formatBootMarkLine(name))
      emitReadyMeasures()
    },
    span<T>(label: BootSpanLabel, fn: () => T): T {
      const startedAt = now()

      // 同一 label 只落一行（首现一次），避免每次 resolve / 重试刷屏。
      const record = () => {
        if (emittedSpans.has(label)) {
          return
        }

        emittedSpans.add(label)
        sink(formatBootSpanLine(label, Math.round((now() - startedAt) * 10) / 10))
      }

      let result: T

      try {
        result = fn()
      } catch (error) {
        // 计时不改变行为：异常原样上抛，但仍产出该 span 行。
        record()
        throw error
      }

      if (result && typeof (result as { then?: unknown }).then === 'function') {
        return (result as unknown as Promise<unknown>).then(
          value => {
            record()
            return value
          },
          error => {
            record()
            throw error
          }
        ) as unknown as T
      }

      record()
      return result
    }
  }
}
