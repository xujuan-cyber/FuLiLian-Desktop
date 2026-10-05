import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { BASE_LOCALE, LOCALES, checkLocaleParity, diffAgainstBase, extractKeys, formatReport } from './i18n-key-check.mjs'

// Minimal locale fixtures mirroring the real bundles' shape: en as a full
// `export const en = {...}`, others wrapped in `defineLocale({...})`.
const EN = `import x from './x'
export const en = {
  common: { apply: 'Apply', save: 'Save' },
  keybinds: { actions: { 'view.newTerminal': 'New terminal' } },
  settings: { fieldLabels: FIELD_LABELS, greeting: 'Hello' },
  messaging: { platformIntro: {} },
}
`
const JA = `import { defineLocale } from './define-locale'
export const ja = defineLocale({
  common: { apply: '適用', save: '保存' },
  keybinds: { actions: { 'view.newTerminal': '新しいターミナル' } },
  settings: { fieldLabels: defineFieldCopy({ greeting: 'こんにちは' }), greeting: 'こんにちは' },
  messaging: { platformIntro: { telegram: 'Telegram' } },
})
`

function writeLocale(dir, name, text) {
  fs.writeFileSync(path.join(dir, `${name}.ts`), text, 'utf8')
  return path.join(dir, `${name}.ts`)
}

function makeFixture(extraLocales) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fulilian-i18n-gate-'))
  const files = { en: writeLocale(dir, 'en', EN) }
  for (const [name, text] of Object.entries(extraLocales ?? {})) files[name] = writeLocale(dir, name, text)
  return files
}

test('extractKeys walks nested objects, keeps dotted keys flat, and treats call expressions as leaves', () => {
  const { leaves, parseDiagnostics } = extractKeys(EN)
  assert.equal(parseDiagnostics.length, 0)
  assert.ok(leaves.has('common.apply'))
  assert.ok(leaves.has("keybinds.actions.view.newTerminal"))
  // identifier / call initializers are opaque leaves, not walked into
  assert.ok(leaves.has('settings.fieldLabels'))
  assert.ok(![...leaves.keys()].some(k => k.startsWith('settings.fieldLabels.')))
})

test('diffAgainstBase reports missing and extra keys', () => {
  const base = extractKeys(EN)
  const jaText = `export const ja = defineLocale({ common: { apply: '適用' } })`
  const loc = extractKeys(jaText)
  const { missing, extra } = diffAgainstBase(base, loc)
  assert.deepEqual(missing, ['common.save', 'keybinds.actions.view.newTerminal', 'settings.fieldLabels', 'settings.greeting'])
  assert.deepEqual(extra, [])
})

test('empty en records exempt both directions (dynamic per-platform records)', () => {
  const base = extractKeys(EN)
  const loc = extractKeys(JA)
  const { missing, extra } = diffAgainstBase(base, loc)
  assert.ok(!missing.includes('messaging.platformIntro'))
  assert.ok(!extra.includes('messaging.platformIntro.telegram'))
})

test('opaque subtrees compare as one leaf in every locale', () => {
  const base = extractKeys(EN)
  const loc = extractKeys(JA)
  const { missing, extra } = diffAgainstBase(base, loc)
  assert.ok(!missing.includes('settings.fieldLabels'))
  assert.ok(![...extra, ...missing].some(k => k.startsWith('settings.fieldLabels.')))
})

test('checkLocaleParity passes when every locale matches en', () => {
  const files = makeFixture({
    zh: JA.replace('export const ja', 'export const zh'),
    'zh-hant': JA.replace('export const ja', 'export const zhHant'),
    ja: JA,
    ar: JA.replace('export const ja', 'export const ar')
  })
  const report = checkLocaleParity(files)
  assert.equal(report.passed, true)
  assert.deepEqual(report.locales.map(l => l.name), LOCALES)
})

test('checkLocaleParity fails and names the missing key when one is removed from a locale', () => {
  // Tamper experiment: drop one leaf from the ja fixture.
  const tampered = JA.replace(`, save: '保存'`, '')
  const files = makeFixture({ ja: tampered, zh: JA, 'zh-hant': JA, ar: JA })
  const report = checkLocaleParity(files)
  assert.equal(report.passed, false)
  const ja = report.locales.find(l => l.name === 'ja')
  assert.deepEqual(ja.missing, ['common.save'])
  const text = formatReport(report)
  assert.ok(text.includes('ja: MISSING 1 key(s)'))
  assert.ok(text.includes('- common.save'))
})

test('checkLocaleParity fails when a locale file cannot be parsed into the expected shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fulilian-i18n-gate-'))
  const files = makeFixture({ ja: JA, zh: JA, ar: JA })
  files['zh-hant'] = path.join(dir, 'zh-hant.ts')
  // unterminated template is a syntax error
  fs.writeFileSync(files['zh-hant'], 'export const zhHant = defineLocale({ common: { apply: `unclosed })', 'utf8')
  const report = checkLocaleParity(files)
  assert.equal(report.passed, false)
  const zhh = report.locales.find(l => l.name === 'zh-hant')
  assert.equal(zhh.parseFailed, true)
  assert.ok(zhh.diagnostics.length > 0)
})

test('checkLocaleParity reports a missing locale file', () => {
  const files = makeFixture({ ja: JA })
  files['zh-hant'] = path.join(os.tmpdir(), 'does-not-exist-i18n.ts')
  const report = checkLocaleParity(files)
  assert.equal(report.passed, false)
  assert.equal(report.locales.find(l => l.name === 'zh-hant').parseFailed, true)
})

test('base locale and locale list contract', () => {
  assert.equal(BASE_LOCALE, 'en')
  assert.deepEqual(LOCALES, ['zh', 'zh-hant', 'ja', 'ar'])
})
