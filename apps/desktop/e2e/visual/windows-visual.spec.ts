/**
 * Windows 本机视觉回归通道（步骤16 · T11）· 基线用例。
 *
 * 8 个关键页 × light/dark = 16 张基线（`e2e/visual-baselines/`，随仓库提交）。
 * 阈值比对（`VISUAL_MAX_DIFF_PIXEL_RATIO`，集中定义于 `./visual-common`）容忍
 * Windows 平台字体/抗锯齿差异；token 级视觉回归（背景、主色、边框…）远超阈值，
 * 必被捕获（反向验收证据见 留档/step16-devb-t11-*）。
 *
 * 声明的 staging（与 step15 rig 同口径）：按 z 梯级（≥1000）注入一条
 * `display:none !important` 的 `<style>` 规则隐藏无后端时的启动失败/引导/连接
 * 覆盖层（React 重挂载同类节点同样命中）；不改业务 DOM 结构、不加类，主题为
 * 真实持久化偏好。既有 Linux 快照通道（e2e/visual-snapshot.ts +
 * playwright.config.ts）零改动。
 */
import { expect, test } from '@playwright/test'

import {
  hideOverlayLadder,
  INJECT_OVERLAY_LADDER_CSS,
  seedAppearance,
  VISUAL_BASE_URL,
  VISUAL_MAX_DIFF_PIXEL_RATIO,
  VISUAL_PAGES,
  waitForShell,
} from './visual-common'

test.describe('windows visual baselines · 8 pages × light/dark', () => {
  for (const page of VISUAL_PAGES) {
    for (const mode of ['light', 'dark'] as const) {
      test(`${page.name} · ${mode}`, async ({ page: pw }) => {
        await seedAppearance(pw, mode)
        /* A distinct query forces a FULL document load — a bare hash change is
         * same-document and the app would keep the mode it booted with. */
        await pw.goto(`${VISUAL_BASE_URL}/?s=winvis-${mode}-${page.name}#${page.route}`, { waitUntil: 'load' })
        /* Overlay ladder (boot-failure / onboarding / setup / crash, z≥1000)：
         * 注入持久 CSS 规则隐藏（自包含函数；React 重挂载同类节点同样命中）。 */
        await pw.evaluate(INJECT_OVERLAY_LADDER_CSS)

        const settled = await waitForShell(pw)
        expect(settled, 'app shell must render before the baseline shot').toBe(true)

        const hidden = await hideOverlayLadder(pw)
        expect(hidden, 'overlay ladder must be fully hidden before the shot').toBe(0)

        await pw.evaluate(() => document.fonts.ready)
        await pw.waitForTimeout(600)

        await expect(pw).toHaveScreenshot(`${page.name}-${mode}.png`, {
          maxDiffPixelRatio: VISUAL_MAX_DIFF_PIXEL_RATIO,
          animations: 'disabled',
          caret: 'hide',
        })
      })
    }
  }
})
