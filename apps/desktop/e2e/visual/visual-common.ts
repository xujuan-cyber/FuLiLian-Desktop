/**
 * Windows 本机视觉回归通道（步骤16 · T11）· 共享常量与驱动助手。
 *
 * WHY THIS CHANNEL: the existing visual-snapshot E2E (`e2e/visual-snapshot.ts`
 * + `playwright.config.ts`) drives the packaged Electron app and only runs
 * under Linux/WLR headless (`cage`). This channel is the Windows-native
 * supplement — it does NOT replace or weaken the Linux snapshots: the existing
 * config/spec are untouched and this channel's config lives in its own file
 * (`e2e/visual/visual.config.ts`), invoked with an explicit
 * `--config=e2e/visual/visual.config.ts` (package.json `test:visual:win`).
 *
 * Rig (proven by 留档/step15-t1-shot.mjs): Playwright drives the SYSTEM Chrome
 * (`channel: 'chrome'`; Playwright's bundled Chromium is not installed on this
 * machine) against the vite dev server. Same React tree, same styles.css, same
 * theme context — only the Electron preload bridge is absent, so the app paints
 * its boot-failure overlay on top of a fully rendered shell. That overlay (and
 * the onboarding / connecting ladder) is hidden below by z-rung, which is the
 * only staging applied and is declared here verbatim.
 */

/** Playwright import surface used by both the spec and the config. */
import type { Page } from '@playwright/test'

/**
 * Dev-server port for this channel ONLY.
 *
 * 依据（T11-4 渲染环境纪律）：高位非常用端口（5173/5174 是 vite 默认与 dev 惯例口，
 * 4174 是 preview 惯例口，均避开）；由 playwright 的 `webServer` 拉起 —— 全程唯一
 * 实例、跑完自动关闭（reuseExistingServer 仅防同口残留实例误双起）。
 */
export const VISUAL_PORT = 5273

export const VISUAL_BASE_URL = `http://127.0.0.1:${VISUAL_PORT}`

/** Fixed viewport — matches the step15 rig (1440×900) for cross-comparability. */
export const VISUAL_VIEWPORT = { width: 1440, height: 900 } as const

/**
 * Threshold for the Windows channel.
 *
 * 依据：既有 Linux/WLR 通道用 maxDiffPixelRatio 0.01（playwright.config.ts，语义
 * 未动）。Windows 本机 Chrome 的亚像素抗锯齿、平台字体 fallback（Microsoft YaHei
 * 渲染 UI 回退文案）与无 GPU 光栅化与 Linux 基线差异更大，实测标定见
 * 留档/step16-devb-t11-threshold-calibration.txt（绿跑噪声 ≤0.5%；
 * 单 token 变异整页背景级差异 ≫20%）。取 2% —— 高于平台噪声、远低于任何
 * token 级视觉回归，且与既有通道的 0.01 同量级，不构成断言弱化（独立通道）。
 */
export const VISUAL_MAX_DIFF_PIXEL_RATIO = 0.02

/**
 * The 8 key pages × light/dark build the baseline (16 PNGs).
 *
 * 选取理由（覆盖本轮改动面优先）：
 *  - `home`           —— T4 chat/kind 容器主页 + T1 皮肤（`/`）
 *  - `command-center` —— T8 面板收编面 + T6 会话分组（`/command-center`）
 *  - `messaging` / `agents` / `artifacts` / `profiles` / `cron` / `skills`
 *                  —— routes.ts APP_ROUTES 其余主视图代表（列表/卡片/表单/画廊
 *                     布局各取其一；webhooks 空态、starmap 报错态不取）。
 *
 * ⚠ `/settings` 不入列（T3 设置重组 / T6 托盘设置面在本通道不可观测）：该路由
 * 依赖 Electron preload 桥（fulilianApi），无桥环境必崩进 z-crash 错误边界
 * （探针实录：pageerror "Cannot read properties of undefined (reading 'api')"，
 * 留档/step16-devb-t11-probe5.txt）——基线只会拍到空白页，无回归价值；设置面
 * 由既有 Linux/WLR Electron 快照通道覆盖，本通道不重复也不弱化它。
 */
export interface VisualPage {
  /** Baseline file stem (also used in the forced-reload query). */
  name: string
  /** Hash-router route. */
  route: string
}

export const VISUAL_PAGES: readonly VisualPage[] = [
  { name: 'home', route: '/' },
  { name: 'command-center', route: '/command-center' },
  { name: 'messaging', route: '/messaging' },
  { name: 'agents', route: '/agents' },
  { name: 'artifacts', route: '/artifacts' },
  { name: 'profiles', route: '/profiles' },
  { name: 'cron', route: '/cron' },
  { name: 'skills', route: '/skills' },
] as const

/** Inject the ladder CSS if absent. SELF-CONTAINED (Playwright 会把传给
 * evaluate/addInitScript 的函数源码序列化进浏览器上下文，模块作用域引用全部失活
 * —— 故 CSS 文本必须内联在函数体内，不得引用本模块其它绑定）。
 * JS 内联 display:none 会被 React 重挂载打回（实测：shell 稳定后 3s 探针仍见
 * z-(--z-onboarding)/z-(--z-setup) 复活），而 `<style>` 规则对后续重挂载的同类
 * 节点同样生效 —— 故用 CSS 注入而非逐元素改样式。 */
export const INJECT_OVERLAY_LADDER_CSS = (): boolean => {
  const css = [
    '.z-\\(--z-connecting\\),',
    '.z-\\(--z-onboarding\\),',
    '.z-\\(--z-onboarding-popover\\),',
    '.z-\\(--z-setup\\),',
    '.z-\\(--z-crash\\)',
    '{ display: none !important; }',
  ].join(' ')
  if (document.getElementById('winvis-hide-overlay-ladder')) return true
  const root = document.head ?? document.documentElement
  if (!root) return false
  const style = document.createElement('style')
  style.id = 'winvis-hide-overlay-ladder'
  style.textContent = css
  root.appendChild(style)
  return true
}

/**
 * Force-hide the overlay ladder once more right before a shot; returns how many
 * ladder layers were still visible (expected 0 — asserted by the spec). Re-injects
 * the CSS first (guaranteed second chance if the init script ran too early).
 */
export const hideOverlayLadder = async (page: Page): Promise<number> => {
  await page.evaluate(INJECT_OVERLAY_LADDER_CSS)
  return page.evaluate(() => {
    let visible = 0
    for (const el of document.querySelectorAll('div')) {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' && Number(cs.zIndex) >= 1000 && cs.display !== 'none') {
        el.style.setProperty('display', 'none', 'important')
        visible += 1
      }
    }
    return visible
  })
}

/**
 * Appearance is per-profile: `profilePref` reads the profile record FIRST and
 * only falls back to the legacy global key — seeding the global key alone is
 * not enough (proven in the step15 rig).
 */
export const seedAppearance = async (page: Page, mode: 'light' | 'dark'): Promise<void> => {
  await page.goto(`${VISUAL_BASE_URL}/#/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(m => {
    const profile = localStorage.getItem('fulilian-desktop-active-profile-v1') || 'default'
    localStorage.setItem('fulilian-desktop-theme-v2', 'fulilian-workbench')
    localStorage.setItem('fulilian-desktop-mode-v1', m)
    localStorage.setItem('fulilian-desktop-profile-themes-v1', JSON.stringify({ [profile]: 'fulilian-workbench' }))
    localStorage.setItem('fulilian-desktop-profile-modes-v1', JSON.stringify({ [profile]: m }))
  }, mode)
}

/**
 * The boot gate races the absent preload bridge, so the shell's arrival is not
 * on a fixed clock — poll for it instead of guessing.
 */
export const waitForShell = async (page: Page, maxMs = 30_000): Promise<boolean> => {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const ok = await page.evaluate(() => {
      const root = document.getElementById('root')
      if (!root) return false
      const shell = [...root.children].find(el => getComputedStyle(el).position !== 'fixed')
      if (!shell || getComputedStyle(shell).display === 'none') return false
      return ((shell as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().length > 80
    })
    if (ok) return true
    await page.waitForTimeout(500)
  }
  return false
}
