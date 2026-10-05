// i18n key parity gate (step16 T10).
//
// Fails the build when any locale (zh / zh-hant / ja / ar) is missing a
// translatable key that `en` — the base of every locale and the runtime
// fallback — defines. Exit code 0 means: every English leaf key exists in
// every locale file. Missing keys are printed grouped by top-level section
// so the fix is mechanical.
//
// Extraction mirrors the runtime shape of the bundles (see
// `src/i18n/define-locale.ts`): a locale file is a tree of object literals
// whose leaves are strings / template functions / opaque call results. Two
// deliberate exemptions keep the comparison honest instead of naive:
//
//   1. Opaque subtrees — `settings.fieldLabels` and `settings.fieldDescriptions`.
//      `en` binds them to identifiers (FIELD_LABELS / FIELD_DESCRIPTIONS) and
//      the other locales to their own `defineFieldCopy(...)` record or a flat
//      dotted-key object; the concrete keys inside are schema-driven dynamic
//      copy, not a statically comparable contract, so the whole subtree is
//      treated as one leaf everywhere.
//   2. Empty English records — any subtree where `en` declares an object
//      literal with no properties (today: `messaging.platformIntro`, a
//      `Record<string, string>` filled per-platform at the locales' own
//      discretion). `en` provides no key list to require, so the subtree is
//      exempt from both directions of the diff.
//
// Extra keys (a locale defines a key `en` does not have) are reported as
// warnings but do NOT fail the build: they are inert at runtime (the merged
// bundle simply carries an unread entry), and deleting them is outside the
// "only add missing keys" discipline of the i18n data files. They are listed
// so staleness stays visible.
//
// Usage: node scripts/i18n-key-check.mjs [--quiet]
// Exit:  0 = parity (or warnings only), 1 = missing keys or parse failure.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
// npm hoists typescript to the workspace root; walking up from this script
// finds it without adding a runtime dependency to the app.
const ts = require('typescript')

export const LOCALES = ['zh', 'zh-hant', 'ja', 'ar']
export const BASE_LOCALE = 'en'

// Subtrees whose concrete keys are schema-driven dynamic copy — compared as a
// single opaque leaf in every locale (see header comment, exemption 1).
const OPAQUE_SUBTREES = new Set(['settings.fieldLabels', 'settings.fieldDescriptions'])

/** Extract the leaf key paths of a locale source file.
 *
 *  Returns `{ leaves: Map<keyPath, initializerText>, emptyRecords: Set<keyPath>,
 *  parseDiagnostics: string[] }`. Recursion descends only into direct object
 *  literal initializers; call expressions (`defineFieldCopy({...})`) and every
 *  other initializer kind are leaves — matching how `defineLocale` merges
 *  bundles (wholesale override, no deep merge of non-object values). */
export function extractKeys(sourceText, fileName = 'locale.ts') {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const leaves = new Map()
  const emptyRecords = new Set()
  const parseDiagnostics = []

  function walkObject(obj, prefix) {
    if (obj.properties.length === 0 && prefix) emptyRecords.add(prefix)
    for (const prop of obj.properties) {
      if (prop.kind === ts.SyntaxKind.SpreadAssignment) {
        parseDiagnostics.push(`${prefix}: spread assignment cannot be attributed to keys`)
        continue
      }
      if (!ts.isPropertyAssignment(prop)) {
        parseDiagnostics.push(`${prefix}: unsupported property kind ${ts.SyntaxKind[prop.kind]}`)
        continue
      }
      let name
      if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)) {
        name = prop.name.text
      } else {
        parseDiagnostics.push(`${prefix}: unsupported property name ${ts.SyntaxKind[prop.name.kind]}`)
        continue
      }
      const keyPath = prefix ? `${prefix}.${name}` : name
      const init = prop.initializer
      if (ts.isObjectLiteralExpression(init) && !OPAQUE_SUBTREES.has(keyPath)) {
        walkObject(init, keyPath)
      } else {
        leaves.set(keyPath, init.getText(sf))
      }
    }
  }

  function visit(node) {
    // Matches `export const en = {...}` and `export const ar = defineLocale({...})`.
    if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        let init = decl.initializer
        if (init && ts.isCallExpression(init) && init.arguments.length === 1) init = init.arguments[0]
        if (init && ts.isObjectLiteralExpression(init)) walkObject(init, '')
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  // Surface genuine syntax errors (unterminated strings, stray braces) so a
  // half-written locale file fails the gate instead of passing with a
  // partially extracted key set.
  for (const d of sf.parseDiagnostics ?? []) {
    parseDiagnostics.push(`${ts.flattenDiagnosticMessageText(d.messageText, ' ')} @ ${d.start ?? -1}`)
  }
  return { leaves, emptyRecords, parseDiagnostics }
}

function isUnderExemptRecord(keyPath, emptyRecords) {
  const parts = keyPath.split('.')
  return parts.some((_, i) => emptyRecords.has(parts.slice(0, i + 1).join('.')))
}

/** Diff one locale's leaves against the English base.
 *
 *  Missing keys (en has, locale lacks) are the hard failure. Extra keys
 *  (locale has, en lacks — stale or locale-private dynamic records) are
 *  warnings only; see header comment. Exemption 2 applies to both directions
 *  via the base's empty records; a locale's own empty records also mask its
 *  extras (a record it deliberately empties has no leaf keys to compare). */
export function diffAgainstBase(base, locale) {
  const missing = []
  for (const keyPath of base.leaves.keys()) {
    if (isUnderExemptRecord(keyPath, base.emptyRecords)) continue
    if (!locale.leaves.has(keyPath)) missing.push(keyPath)
  }
  const extra = []
  for (const keyPath of locale.leaves.keys()) {
    if (isUnderExemptRecord(keyPath, base.emptyRecords) || isUnderExemptRecord(keyPath, locale.emptyRecords)) continue
    if (!base.leaves.has(keyPath)) extra.push(keyPath)
  }
  missing.sort()
  extra.sort()
  return { missing, extra }
}

function groupBySection(keyPaths) {
  const groups = new Map()
  for (const keyPath of keyPaths) {
    const section = keyPath.split('.')[0]
    if (!groups.has(section)) groups.set(section, [])
    groups.get(section).push(keyPath)
  }
  return groups
}

/** Run the full check over the five locale files. Returns a report object;
 *  `passed` is false when keys are missing or a file failed to parse. */
export function checkLocaleParity(files, { base = BASE_LOCALE, locales = LOCALES } = {}) {
  const parsed = new Map()
  const report = { base, locales: [], passed: true }

  for (const name of [base, ...locales]) {
    const file = files[name]
    if (!file || !fs.existsSync(file)) {
      report.locales.push({ name, parseFailed: true, diagnostics: [`file not found: ${file}`] })
      report.passed = false
      continue
    }
    parsed.set(name, extractKeys(fs.readFileSync(file, 'utf8'), path.basename(file)))
  }

  const baseParsed = parsed.get(base)
  if (!baseParsed) return report
  if (baseParsed.parseDiagnostics.length > 0) {
    report.locales.push({ name: base, parseFailed: true, diagnostics: baseParsed.parseDiagnostics })
    report.passed = false
  }

  for (const name of locales) {
    const parsedLocale = parsed.get(name)
    if (!parsedLocale) continue
    if (parsedLocale.parseDiagnostics.length > 0) {
      report.locales.push({ name, parseFailed: true, diagnostics: parsedLocale.parseDiagnostics })
      report.passed = false
      continue
    }
    const { missing, extra } = diffAgainstBase(baseParsed, parsedLocale)
    report.locales.push({ name, missing, extra })
    if (missing.length > 0) report.passed = false
  }

  return report
}

export function formatReport(report) {
  const lines = []
  for (const entry of report.locales) {
    if (entry.parseFailed) {
      lines.push(`${entry.name}: PARSE FAILED`)
      for (const d of entry.diagnostics) lines.push(`  ! ${d}`)
      continue
    }
    if (entry.missing.length === 0 && entry.extra.length === 0) {
      lines.push(`${entry.name}: OK (key parity with ${report.base})`)
      continue
    }
    if (entry.missing.length > 0) {
      lines.push(`${entry.name}: MISSING ${entry.missing.length} key(s) vs ${report.base}`)
      for (const [section, keys] of groupBySection(entry.missing)) {
        lines.push(`  [${section}] ${keys.length}`)
        for (const k of keys) lines.push(`    - ${k}`)
      }
    }
    if (entry.extra.length > 0) {
      lines.push(`${entry.name}: WARNING — ${entry.extra.length} extra key(s) not in ${report.base} (inert at runtime, kept — only-add discipline)`)
      for (const k of entry.extra) lines.push(`    + ${k}`)
    }
  }
  return lines.join('\n')
}

function main(argv) {
  const quiet = argv.includes('--quiet')
  const i18nDir = path.resolve(import.meta.dirname, '../src/i18n')
  const files = { en: path.join(i18nDir, 'en.ts') }
  for (const name of LOCALES) files[name] = path.join(i18nDir, `${name}.ts`)

  const report = checkLocaleParity(files)
  const text = formatReport(report)
  if (!quiet || !report.passed) console.log(text)
  if (!report.passed) {
    console.error('\ni18n key parity gate FAILED: add the missing keys to each locale (en is the source).')
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
