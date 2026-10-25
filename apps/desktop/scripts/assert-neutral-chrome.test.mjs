/**
 * assert-neutral-chrome.test.mjs — F4a 断言脚本单测（node --test，不进产品测试面）。
 * 运行：node --test scripts/assert-neutral-chrome.test.mjs
 * 覆盖：绿例（含 3 位 hex 等价、注释内 decoy 忽略、@layer 包裹结构）、值不一致红、
 *       缺声明红、计划外声明点红（裸 :root / @media 内）、不可解析值 fail-closed、
 *       真实仓库文件现状绿。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluate,
  extractNeutralChrome,
  extractNeutralChromeDeclarations,
  normalizeColor,
  stripCssComments
} from './assert-neutral-chrome.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

const TS_GREEN = `// comment with decoy NEUTRAL_CHROME = { light: '#000000', dark: '#000000' }
export const NEUTRAL_CHROME = { light: '#FFFFFF', dark: '#10151C' } as const
`

// 与真实 styles.css 同构：:root / :root.dark 包裹在 @layer base 内。
const CSS_GREEN = `@layer base {
:root {
  /* decoy: --theme-neutral-chrome: #000000; */
  --theme-neutral-chrome: #ffffff;
  --theme-neutral-sidebar: #f2f3f5;
}
:root.dark {
  --theme-neutral-chrome: #10151c;
}
.other { color: red; }
}
`

const BARE_CSS = `:root {
  --theme-neutral-chrome: #ffffff;
}
:root.dark {
  --theme-neutral-chrome: #10151c;
}
`

test('normalizeColor: 大小写归一 + 3 位 hex 展开 + 非法值 null', () => {
  assert.equal(normalizeColor('#FFFFFF'), '#ffffff')
  assert.equal(normalizeColor(' #ABC '), '#aabbcc')
  assert.equal(normalizeColor('#10151c'), '#10151c')
  assert.equal(normalizeColor('rgb(1,2,3)'), null)
  assert.equal(normalizeColor('#12345'), null)
})

test('extractNeutralChrome: 命中 export 常量、忽略注释 decoy', () => {
  assert.deepEqual(extractNeutralChrome(TS_GREEN), { light: '#FFFFFF', dark: '#10151C' })
  assert.equal(extractNeutralChrome('const NEUTRAL_CHROME = 1'), null)
  assert.equal(extractNeutralChrome('export const NEUTRAL_CHROME = { light: 1 }'), null)
})

test('extractNeutralChromeDeclarations: 嵌套路径 + 注释 decoy 忽略 + 行号正确', () => {
  const decls = extractNeutralChromeDeclarations(CSS_GREEN)
  assert.equal(decls.length, 2)
  assert.deepEqual(decls[0], { selector: '@layer base > :root', value: '#ffffff', line: 4 })
  assert.deepEqual(decls[1], { selector: '@layer base > :root.dark', value: '#10151c', line: 8 })
  // 注释被等长空白替换，不影响长度与行号
  const stripped = stripCssComments('a { /* x\ny */ --k: 1; }')
  assert.equal(stripped.length, 'a { /* x\ny */ --k: 1; }'.length)
})

test('evaluate: @layer 包裹结构一致 → ok', () => {
  const r = evaluate(TS_GREEN, CSS_GREEN)
  assert.equal(r.status, 'ok')
  assert.equal(r.problems.length, 0)
})

test('evaluate: 3 位 hex 与 6 位等价 → ok', () => {
  const r = evaluate(
    "export const NEUTRAL_CHROME = { light: '#fff', dark: '#10151C' } as const",
    CSS_GREEN
  )
  assert.equal(r.status, 'ok')
})

test('evaluate: CSS dark 值漂移 → mismatch（红证①的解析等价）', () => {
  const drifted = CSS_GREEN.replace('--theme-neutral-chrome: #10151c;', '--theme-neutral-chrome: #0d0d0e;')
  const r = evaluate(TS_GREEN, drifted)
  assert.equal(r.status, 'mismatch')
  assert.ok(r.problems[0].includes('dark: 不一致'))
})

test('evaluate: TS 侧漂移 → mismatch（红证②的解析等价）', () => {
  const drifted = TS_GREEN.replace("'#FFFFFF'", "'#F3F3F3'")
  const r = evaluate(drifted, CSS_GREEN)
  assert.equal(r.status, 'mismatch')
  assert.ok(r.problems[0].includes('light: 不一致'))
})

test('evaluate: 缺 :root.dark 声明 → mismatch', () => {
  const missing = CSS_GREEN.replace('--theme-neutral-chrome: #10151c;\n', '')
  const r = evaluate(TS_GREEN, missing)
  assert.equal(r.status, 'mismatch')
  assert.ok(r.problems.some((p) => p.includes('缺少 @layer base > :root.dark')))
})

test('evaluate: 裸 :root（无 @layer base 前缀）→ 计划外 mismatch', () => {
  const r = evaluate(TS_GREEN, BARE_CSS)
  assert.equal(r.status, 'mismatch')
  assert.ok(r.problems.some((p) => p.includes('计划外声明点 :root')))
})

test('evaluate: @media 内同选择器 → 计划外 mismatch', () => {
  const extra = CSS_GREEN + '\n@media (min-width: 1px) {\n  :root {\n    --theme-neutral-chrome: #ffffff;\n  }\n}\n'
  const r = evaluate(TS_GREEN, extra)
  assert.equal(r.status, 'mismatch')
  assert.ok(r.problems.some((p) => p.includes('@media (min-width: 1px) > :root')))
})

test('evaluate: 不可解析值 → fail-closed mismatch', () => {
  const bad = CSS_GREEN.replace('--theme-neutral-chrome: #ffffff;', '--theme-neutral-chrome: rgb(255,255,255);')
  const r = evaluate(TS_GREEN, bad)
  assert.equal(r.status, 'mismatch')
  assert.ok(r.problems.some((p) => p.includes('值不可解析')))
})

test('evaluate: TS 侧常量缺失 → error（退出码 2 口径）', () => {
  const r = evaluate('export const OTHER = 1', CSS_GREEN)
  assert.equal(r.status, 'error')
})

test('真实仓库文件现状：一致（现状绿）', () => {
  const ts = readFileSync(resolve(SCRIPT_DIR, '../src/themes/chrome-background.ts'), 'utf8')
  const css = readFileSync(resolve(SCRIPT_DIR, '../src/styles.css'), 'utf8')
  const r = evaluate(ts, css)
  assert.equal(r.status, 'ok')
  assert.deepEqual(
    r.summary.ts,
    { light: '#FFFFFF', dark: '#10151C' },
    '真实常量值漂移时此断言失败——请同步更新契约认知'
  )
})
