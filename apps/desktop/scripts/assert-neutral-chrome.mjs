#!/usr/bin/env node
/**
 * assert-neutral-chrome.mjs — NEUTRAL_CHROME ↔ styles.css 一致性断言（F4a）。
 *
 * 契约出处（A1 侦察）：
 *   - TS 侧：`src/themes/chrome-background.ts` 的
 *     `export const NEUTRAL_CHROME = { light: '#FFFFFF', dark: '#10151C' } as const`
 *     （经 chromeBackground() 涂到原生标题栏，setTitleBarTheme）。
 *   - CSS 侧：`src/styles.css` 的 `--theme-neutral-chrome`，恰两处定义：
 *     `:root`（light）与 `:root.dark`（dark）；其余出现点均为 var() 消费或注释。
 *     applyTheme() 不写该变量（皮肤无关），故不存在第三定义点。
 *   - 双方注释均声明 "must stay in step"，此前无自动化守卫
 *     （步骤17 P5 回执遗留项①，2026-10-08）——本脚本补上该守卫。
 *
 * 逻辑：解析两侧值 → 归一化（大小写、3 位 hex 展开）→ 按 mode 双向比较；
 *       不一致、缺声明、多余声明、不可解析值均非零退出（fail-closed）。
 *
 * 用法（node 直跑，不依赖 vitest；工作目录任意）：
 *   node scripts/assert-neutral-chrome.mjs          # 退出码 0=一致 1=不一致 2=结构/解析错误
 *
 * 设计约束：不改产品代码；发现真实不一致只报不改（T-F4a 范围红线）。
 * 本脚本仅依赖 node 内置模块，不进 vitest 产品测试面
 * （单测：node --test scripts/assert-neutral-chrome.test.mjs）。
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const TS_REL = '../src/themes/chrome-background.ts'
const CSS_REL = '../src/styles.css'
const VAR_NAME = '--theme-neutral-chrome'
// A1 侦察（2026-10-25）：styles.css 的两个 :root 块均位于 `@layer base { ... }` 内，
// 故声明点的完整选择器路径为 '@layer base > :root' / '@layer base > :root.dark'。
// 期望路径按完整前缀匹配：裸 :root 或 @media 内的声明都会被判「计划外」（fail-closed）。
const LIGHT_SELECTOR = '@layer base > :root'
const DARK_SELECTOR = '@layer base > :root.dark'

/** 把 CSS 块注释替换为等长空白，保持行号可定位（CSS 内无含注释结束符的字符串场景）。 */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 归一化颜色值：小写、3 位 hex 展开；不支持/非法格式返回 null（fail-closed）。 */
export function normalizeColor(value) {
  const v = String(value).trim().toLowerCase()
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  return null
}

/** 从 TS 源文本提取 NEUTRAL_CHROME 的 { light, dark } 原始值；找不到返回 null。 */
export function extractNeutralChrome(tsSource) {
  const m = /export\s+const\s+NEUTRAL_CHROME\s*=\s*\{([^}]*)\}/.exec(tsSource)
  if (!m) return null
  const light = /light\s*:\s*(['"])([^'"]+)\1/.exec(m[1])
  const dark = /dark\s*:\s*(['"])([^'"]+)\1/.exec(m[1])
  if (!light || !dark) return null
  return { light: light[2], dark: dark[2] }
}

/**
 * 从 CSS 源文本提取全部 `--theme-neutral-chrome` 声明（块选择器感知：
 * 记录完整嵌套路径，如 `@media ... > :root`），返回 [{ selector, value, line }]。
 * 路径化选择器保证 @media/@supports 内的同名声明不会被误认成 base 声明。
 */
export function extractNeutralChromeDeclarations(cssSource) {
  const text = stripCssComments(cssSource)
  const decls = []
  const stack = []
  let buf = ''
  const lineAt = (idx) => 1 + (text.slice(0, idx).match(/\n/g)?.length ?? 0)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      stack.push(buf.trim())
      buf = ''
    } else if (ch === '}') {
      stack.pop()
      buf = ''
    } else if (ch === ';') {
      const m = new RegExp(`^\\s*${VAR_NAME}\\s*:\\s*(.+)$`, 'i').exec(buf)
      if (m) {
        decls.push({
          selector: stack.join(' > '),
          value: m[1].trim(),
          line: lineAt(i)
        })
      }
      buf = ''
    } else {
      buf += ch
    }
  }
  return decls
}

/**
 * 核心评估：比较 TS 常量与 CSS 声明。返回
 * { status: 'ok'|'mismatch'|'error', problems: string[], summary: object }。
 */
export function evaluate(tsSource, cssSource) {
  const problems = []
  const ts = extractNeutralChrome(tsSource)
  if (!ts) {
    return {
      status: 'error',
      problems: [`TS 侧未找到 ${VAR_NAME} 的契约常量 NEUTRAL_CHROME { light, dark }（${TS_REL}）`],
      summary: null
    }
  }
  const decls = extractNeutralChromeDeclarations(cssSource)
  const bySelector = new Map()
  for (const d of decls) {
    if (!bySelector.has(d.selector)) bySelector.set(d.selector, [])
    bySelector.get(d.selector).push(d)
  }
  const expected = [
    { key: 'light', selector: LIGHT_SELECTOR },
    { key: 'dark', selector: DARK_SELECTOR }
  ]
  const pairs = []
  for (const { key, selector } of expected) {
    const found = bySelector.get(selector) ?? []
    if (found.length === 0) {
      problems.push(`CSS 侧缺少 ${selector} 下的 ${VAR_NAME} 声明（${key} 端点，styles.css）`)
      continue
    }
    if (found.length > 1) {
      problems.push(
        `CSS 侧 ${selector} 下 ${VAR_NAME} 有 ${found.length} 处重复声明（行 ${found.map((f) => f.line).join(', ')}），契约要求唯一`
      )
    }
    pairs.push({ key, selector, cssValue: found[0].value, tsValue: ts[key], line: found[0].line })
  }
  const expectedSelectors = new Set(expected.map((e) => e.selector))
  for (const [selector, list] of bySelector) {
    if (!expectedSelectors.has(selector)) {
      problems.push(
        `CSS 侧出现计划外声明点 ${selector || '(未知选择器)'} 下的 ${VAR_NAME}（行 ${list.map((f) => f.line).join(', ')}）——契约只允许 ${LIGHT_SELECTOR} 与 ${DARK_SELECTOR}`
      )
    }
  }
  for (const p of pairs) {
    const normCss = normalizeColor(p.cssValue)
    const normTs = normalizeColor(p.tsValue)
    if (normCss === null || normTs === null) {
      problems.push(
        `${p.key}: 值不可解析（fail-closed）—— ts=${p.tsValue} css(${p.selector}:${p.line})=${p.cssValue}`
      )
      continue
    }
    if (normCss !== normTs) {
      problems.push(
        `${p.key}: 不一致 —— NEUTRAL_CHROME.${p.key}=${p.tsValue} vs styles.css ${p.selector}:${p.line} ${VAR_NAME}=${p.cssValue}`
      )
    }
  }
  return { status: problems.length === 0 ? 'ok' : 'mismatch', problems, summary: { ts, pairs } }
}

function main() {
  const tsPath = resolve(SCRIPT_DIR, TS_REL)
  const cssPath = resolve(SCRIPT_DIR, CSS_REL)
  let tsSource, cssSource
  try {
    tsSource = readFileSync(tsPath, 'utf8')
  } catch (e) {
    console.error(`[neutral-chrome] 无法读取 ${tsPath}: ${e.message}`)
    process.exit(2)
  }
  try {
    cssSource = readFileSync(cssPath, 'utf8')
  } catch (e) {
    console.error(`[neutral-chrome] 无法读取 ${cssPath}: ${e.message}`)
    process.exit(2)
  }
  const { status, problems, summary } = evaluate(tsSource, cssSource)
  console.log(`[neutral-chrome] NEUTRAL_CHROME ↔ styles.css ${VAR_NAME} 一致性断言`)
  if (summary) {
    for (const p of summary.pairs) {
      console.log(
        `  ${p.key.padEnd(5)} ts NEUTRAL_CHROME.${p.key}=${p.tsValue}  vs  css ${p.selector}:${p.line}=${p.cssValue}`
      )
    }
  }
  if (status === 'ok') {
    console.log('[neutral-chrome] OK: 双侧一致')
    process.exit(0)
  }
  for (const p of problems) console.error(`[neutral-chrome] MISMATCH: ${p}`)
  console.error(
    `[neutral-chrome] FAIL: ${problems.length} 项不一致/异常（status=${status}）。` +
      `修复归属交编排者裁决，勿在本守卫内顺手改产品代码。`
  )
  process.exit(status === 'error' ? 2 : 1)
}

// 直接执行时跑 main；被 node --test 导入时不跑。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
