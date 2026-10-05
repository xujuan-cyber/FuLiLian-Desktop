#!/usr/bin/env node
/**
 * previews:render —— 设计预览管线脚本化（步骤16 · T11-1）。
 *
 * 把既有「headless Chrome 截 design/previews 姊妹目录 HTML → PNG」的人工流程
 * （design/previews-optimization/README.md 的配方）脚本化：
 *   - 可重复执行：产物目录固定 `apps/desktop/.previews-render/<预览目录名>/`；
 *   - EXIT 码诚实：Chrome 缺失、渲染失败、产物缺失任一 ⇒ 非零退出；
 *   - 串行渲染（并行运行模式 CPU 纪律）；渲染失败不中断其余页，结尾汇总。
 *
 * 默认渲染 design/ 下全部预览目录（previews / previews-optimization / previews-v2）。
 * 用法：
 *   node scripts/render-previews.mjs [预览目录名...]   # 如 `previews-optimization`
 * 环境变量：
 *   FULILIAN_DESIGN_DIR  设计根目录（默认依次尝试 <repo>/design 与本机工作区
 *                        D:/Documents/WorkBuddy/FuLilian-Desktop/design）
 *   FULILIAN_CHROME      Chrome 可执行文件路径（默认探平台惯例路径）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url)) // apps/desktop/scripts
const DESKTOP = path.resolve(HERE, '..') // apps/desktop
const REPO = path.resolve(DESKTOP, '..') // 仓库根
const OUT_ROOT = path.join(DESKTOP, '.previews-render')

const DEFAULT_SUBDIRS = ['previews', 'previews-optimization', 'previews-v2']
const CHROME_CANDIDATES =
  process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['google-chrome', 'chromium', 'chromium-browser']

function resolveChrome() {
  if (process.env.FULILIAN_CHROME && existsSync(process.env.FULILIAN_CHROME)) {
    return process.env.FULILIAN_CHROME
  }
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

function resolveDesignRoot() {
  if (process.env.FULILIAN_DESIGN_DIR) return process.env.FULILIAN_DESIGN_DIR
  const inRepo = path.join(REPO, 'design')
  if (existsSync(inRepo)) return inRepo
  // 本机协同布局：E 仓（代码）不含 design/，设计件在工作区文档仓。
  const workspace = 'D:/Documents/WorkBuddy/FuLilian-Desktop/design'
  if (existsSync(workspace)) return workspace
  return null
}

const requested = process.argv.slice(2)
const designRoot = resolveDesignRoot()
if (!designRoot) {
  console.error('[previews:render] FAIL: 设计根目录不可定位（设 FULILIAN_DESIGN_DIR）')
  process.exit(1)
}
const chrome = resolveChrome()
if (!chrome) {
  console.error('[previews:render] FAIL: 未找到 Chrome（设 FULILIAN_CHROME）')
  process.exit(1)
}

const subdirs = requested.length > 0 ? requested : DEFAULT_SUBDIRS
mkdirSync(OUT_ROOT, { recursive: true })

const jobs = []
for (const sub of subdirs) {
  const dir = path.join(designRoot, sub)
  if (!existsSync(dir)) {
    console.error(`[previews:render] FAIL: 预览目录不存在: ${dir}`)
    process.exit(1)
  }
  const htmls = readdirSync(dir)
    .filter(f => f.endsWith('.html'))
    .sort()
  if (htmls.length === 0) {
    console.error(`[previews:render] FAIL: 目录内无 HTML: ${dir}`)
    process.exit(1)
  }
  for (const html of htmls) jobs.push({ sub, dir, html })
}

let failures = 0
const rendered = []
for (const job of jobs) {
  const outDir = path.join(OUT_ROOT, job.sub)
  mkdirSync(outDir, { recursive: true })
  const outPng = path.join(outDir, `${path.basename(job.html, '.html')}.png`)
  rmSync(outPng, { force: true })
  /* 冻结动画（design 原件只读）：部分预览 HTML 含无限循环动画（previews/
   * 02-forensics.html 的 pulse/rot、previews-v2/12-session.html 的 rot spinner），
   * Chrome --screenshot 在任意帧抓拍 ⇒ 两次运行逐字节不同（实测在这些稳定态间
   * 跳变；--deterministic-mode/--virtual-time-budget 均无法完全消除）。本脚本把
   * HTML 读出后注入一条「animation-play-state:paused」冻结规则写到渲染副本
   * （全部预览 HTML 自包含、无外部资源引用，副本位置不影响渲染），截副本 ⇒
   * 动画恒停在第 0 帧，产物逐字节稳定（A5-②）。原件零触碰。 */
  const FROZEN_HTML = path.join(
    OUT_ROOT,
    `.frozen-${job.sub}-${job.html}`
  )
  const source = readFileSync(path.join(job.dir, job.html), 'utf8')
  const freeze =
    '<style>*,*::before,*::after{animation-play-state:paused !important;transition:none !important}</style>'
  const frozen =
    /<head[^>]*>/i.test(source)
      ? source.replace(/<head[^>]*>/i, m => m + freeze)
      : freeze + source
  writeFileSync(FROZEN_HTML, frozen)
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--window-size=1600,1000',
    '--default-background-color=FFFFFFFF',
    /* 确定性渲染辅助（与冻结动画叠加）：虚拟时钟快进到固定点 + headless shell
     * 确定性开关（禁线程化动画/绘制）。 */
    '--deterministic-mode',
    '--virtual-time-budget=5000',
    `--screenshot=${outPng}`,
    pathToFileURL(FROZEN_HTML).href,
  ]
  const res = spawnSync(chrome, args, { encoding: 'utf8', timeout: 60_000, windowsHide: true })
  rmSync(FROZEN_HTML, { force: true })
  const ok = res.status === 0 && existsSync(outPng) && statSync(outPng).size > 0
  if (ok) {
    rendered.push(path.relative(DESKTOP, outPng))
    console.log(`[previews:render] ok   ${job.sub}/${job.html} -> ${path.basename(outPng)}`)
  } else {
    failures += 1
    console.error(`[previews:render] FAIL ${job.sub}/${job.html} (exit=${res.status})`)
    if (res.stderr) console.error(res.stderr.split('\n').slice(0, 5).join('\n'))
  }
}

console.log(`[previews:render] ${rendered.length}/${jobs.length} rendered -> ${path.relative(REPO, OUT_ROOT)}`)
if (failures > 0) {
  console.error(`[previews:render] FAIL: ${failures} page(s) failed`)
  process.exit(1)
}
