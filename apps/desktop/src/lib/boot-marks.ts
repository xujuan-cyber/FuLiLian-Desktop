/**
 * P13 · 渲染层启动埋点。
 *
 * 渲染层（HTML parse → React mount → composer ready）经 preload 暴露的**窄
 * 通道** `reportBootMark(name, t)` 回传主进程：名字是固定白名单常量、t 是
 * **绝对 epoch ms**（`performance.timeOrigin + performance.now()`），主进程
 * 侧二次校验后写入既有 desktop.log 管线。
 *
 * 约定（红线）：
 * - 只发送这两个基本类型，**绝不**透传自由文本 / console / 任意对象；
 * - 每个名字**只上报一次**（冷启动那一刻）；
 * - 埋点默认开启、零外部依赖、失败静默（bridge 缺失或抛错都不得影响渲染）。
 */

/** 渲染层启动锚点 —— 与 electron/boot-timing.ts 的 RENDERER_BOOT_MARK_NAMES 对齐。 */
export const RENDERER_BOOT_MARK_NAMES = ['boot:html-parse', 'boot:react-mount', 'boot:composer-ready'] as const

export type RendererBootMarkName = (typeof RENDERER_BOOT_MARK_NAMES)[number]

interface BootMarkBridge {
  reportBootMark?: (name: string, t: number) => void
}

const reported = new Set<RendererBootMarkName>()

function defaultBridge(): BootMarkBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return (window as unknown as { fulilianDesktop?: BootMarkBridge }).fulilianDesktop
}

/**
 * 上报一个渲染层启动锚点，**每个名字只发一次**。
 *
 * `bridge` 默认取 `window.fulilianDesktop`；测试可注入假 bridge。任何异常都被
 * 吞掉 —— 埋点绝不能影响渲染层启动。
 */
export function reportBootMark(name: RendererBootMarkName, bridge: BootMarkBridge | undefined = defaultBridge()): void {
  if (reported.has(name)) {
    return
  }

  reported.add(name)

  try {
    const t = Math.round(performance.timeOrigin + performance.now())
    bridge?.reportBootMark?.(name, t)
  } catch {
    // 埋点是 best-effort：绝不让它打断渲染。
  }
}

/** 仅测试用：清除 once-per-name 闩锁。 */
export function resetBootMarksForTest(): void {
  reported.clear()
}
