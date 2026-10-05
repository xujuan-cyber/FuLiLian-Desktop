/**
 * Windows 本机视觉回归通道（步骤16 · T11）· Playwright 配置。
 *
 * 独立通道：既有 `playwright.config.ts`（Linux/WLR Electron 快照）零改动；
 * 本配置自 `apps/desktop` 经 `npx playwright test --config=e2e/visual/visual.config.ts`
 * 显式调用（package.json `test:visual:win`）。⚠ 路径全部锚定在本文件所在目录
 * （Playwright 以「加载的配置文件」为相对根——曾经由根级转发文件加载时 testDir
 * 被错锚到 apps/desktop，误捕 src 下全部单测文件，见回执；故弃用转发文件，
 * 唯一配置本体在此）。阈值与页面清单集中定义在 `./visual-common`。
 */
import { defineConfig } from '@playwright/test'

import {
  VISUAL_BASE_URL,
  VISUAL_MAX_DIFF_PIXEL_RATIO,
  VISUAL_PORT,
  VISUAL_VIEWPORT,
} from './visual-common'

export default defineConfig({
  /* Specs for THIS channel only — the e2e/*.spec.ts Electron suite keeps its
   * own config and is never picked up here. */
  testDir: '.',
  timeout: 120_000,
  retries: 0,
  /* CPU 纪律（步骤16 并行运行模式）：同一时刻只允许 1 个重进程 —— 单 worker 串行。 */
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  /* Playwright artifacts land in the already-gitignored test-results/. */
  outputDir: '../../test-results/visual-win',
  /* Baselines: 8 pages × light/dark, committed at e2e/visual-baselines/
   * (snapshotDir is resolved relative to this config file). */
  snapshotDir: '../visual-baselines',
  snapshotPathTemplate: '{snapshotDir}/{arg}{ext}',
  use: {
    /* Playwright 自带 Chromium 本机未安装；走系统 Chrome（step15 rig 实测配方）。 */
    channel: 'chrome',
    headless: true,
    viewport: VISUAL_VIEWPORT,
    contextOptions: {
      /* 与既有通道同口径：动效瞬时完成，避免截到过渡中间态。 */
      reducedMotion: 'reduce',
    },
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: VISUAL_MAX_DIFF_PIXEL_RATIO,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  webServer: {
    /* T11-4：唯一实例、高位非常用端口（5273）、跑完由 playwright 关闭。
     * reuseExistingServer 必须 false：复用残留实例会吃到陈旧的样式转换缓存
     * （实测：篡改 token 后复用实例仍吐旧 CSS，反向验收被静默假绿）——
     * 每跑必新起实例，端口被占则快速失败，诚实暴露孤儿进程。 */
    command: `npx vite --host 127.0.0.1 --port ${VISUAL_PORT} --strictPort`,
    url: VISUAL_BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
