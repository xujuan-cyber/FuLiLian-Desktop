import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { loadAllTranslations, TRANSLATIONS } from './catalog'
import { en } from './en'
import type { Locale } from './types'

// A7 — the capability-preset copy must exist, in full, in all four locales.
//
// DESIGN.md is explicit: a string added to `en.ts` that skips `ja`/`zh`/
// `zh-hant` is a regression. The typed `Translations` object already forces
// `en` and `zh` to be structurally complete (that is what `npm run typecheck`
// buys), but `ja`/`zh-hant`/`ar` are built with `defineLocale(...)`, which
// *merges over English* — so a forgotten key there is silently filled in with
// English text and no type error ever fires.
//
// This test therefore reads the four source files and compares the key paths
// actually declared in each `presets:` block, then separately checks that the
// merged runtime values are genuinely translated rather than inherited.

const here = path.dirname(fileURLToPath(import.meta.url))

const LOCALE_FILES: Record<Locale, string> = {
  ar: 'ar.ts',
  en: 'en.ts',
  ja: 'ja.ts',
  zh: 'zh.ts',
  'zh-hant': 'zh-hant.ts'
}

/** Only four locales are under contract (DESIGN.md); `ar` falls back by design
 *  and is reported separately, never silently. */
const CONTRACT_LOCALES: Locale[] = ['en', 'ja', 'zh', 'zh-hant']

const KEY_LINE = /^(?:'([A-Za-z0-9-]+)'|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/

function blockOf(locale: Locale): null | string {
  const source = readFileSync(path.resolve(here, LOCALE_FILES[locale]), 'utf8')
  const start = source.indexOf('\n  presets: {')

  if (start === -1) {
    return null
  }

  const open = source.indexOf('{', start)
  let depth = 0

  for (let i = open; i < source.length; i += 1) {
    const char = source[i]

    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1

      if (depth === 0) {
        return source.slice(open + 1, i)
      }
    }
  }

  throw new Error(`unbalanced braces in ${LOCALE_FILES[locale]}`)
}

/** Dotted key paths declared in an indented object literal (leaves + groups). */
function pathsIn(block: string): string[] {
  const paths: string[] = []
  const stack: { indent: number; key: string }[] = []

  for (const line of block.split('\n')) {
    const trimmed = line.trimStart()

    if (!trimmed || trimmed.startsWith('//')) {
      continue
    }

    const match = KEY_LINE.exec(trimmed)

    if (!match) {
      continue
    }

    const indent = line.length - trimmed.length
    const key = match[1] ?? match[2]!

    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop()
    }

    const rest = trimmed.slice(match[0].length).trim()

    if (rest.startsWith('{')) {
      stack.push({ indent, key })
    } else {
      paths.push([...stack.map(entry => entry.key), key].join('.'))
    }
  }

  return paths.sort()
}

function declaredPaths(locale: Locale): string[] {
  const block = blockOf(locale)

  expect(block, `${LOCALE_FILES[locale]} has no presets block`).not.toBeNull()

  return pathsIn(block!)
}

/** Every leaf path of the English preset copy — the reference key set. */
function flatten(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key)
    )
  }

  return [prefix]
}

/** Resolve a preset-relative path (e.g. `names.dev.name`) in `locale`. */
function resolve(locale: Locale, path: string): unknown {
  return `presets.${path}`
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], TRANSLATIONS[locale])
}

const resolveText = (value: unknown): string => (typeof value === 'function' ? String(value(1, 'sample')) : String(value))

const referencePaths = flatten(en.presets).sort()

describe('capability-preset i18n', () => {
  // P9: the app catalog loads non-English bundles on demand; resolve the
  // runtime halves of these assertions against a fully-resident catalog.
  beforeAll(async () => {
    await loadAllTranslations()
  })

  it('covers every preset key in each contract locale', () => {
    for (const locale of CONTRACT_LOCALES) {
      expect(declaredPaths(locale), `${LOCALE_FILES[locale]} preset keys`).toEqual(referencePaths)
    }
  })

  it('keeps the source declaration and the typed reference in step', () => {
    // Guards the parser: if `en.ts` and the typed `Translations` disagree, the
    // comparison above would be measuring the wrong thing.
    expect(declaredPaths('en')).toEqual(referencePaths)
  })

  it('translates the visible copy instead of leaning on the English fallback', () => {
    for (const locale of CONTRACT_LOCALES.filter(value => value !== 'en')) {
      for (const presetPath of referencePaths) {
        // `toolsetList` is a pass-through formatter by design, and function
        // results are compared through the same sample call on both sides.
        if (presetPath === 'toolsetList') {
          continue
        }

        const translated = resolveText(resolve(locale, presetPath))
        expect(translated, `${LOCALE_FILES[locale]} ${presetPath} is still English`).not.toBe(
          resolveText(resolve('en', presetPath))
        )
      }
    }
  })

  it('resolves every preset key at runtime in every locale', () => {
    for (const locale of Object.keys(LOCALE_FILES) as Locale[]) {
      for (const presetPath of referencePaths) {
        expect(resolveText(resolve(locale, presetPath)), `${locale} ${presetPath}`).not.toBe('undefined')
      }
    }
  })
})
