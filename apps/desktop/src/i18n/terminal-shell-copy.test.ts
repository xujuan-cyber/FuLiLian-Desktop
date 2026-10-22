import { describe, expect, it } from 'vitest'

import { ar } from './ar'
import { en } from './en'
import { ja } from './ja'
import { zh } from './zh'
import { zhHant } from './zh-hant'

/**
 * The `settings.appearance.terminalShell` keys frozen by step17 (ten) plus the
 * N1/N2 additions (eight: effective-shell reporting, startup side, on-demand
 * WSL detection). `en.ts` is the single source of truth for the names.
 */
const TERMINAL_SHELL_KEYS = [
  'sectionTitle',
  'sectionDesc',
  'localShellTitle',
  'shellAuto',
  'shellPwsh',
  'shellPowershell',
  'shellCmd',
  'wslDistroTitle',
  'wslDistroHint',
  'saveFailed',
  'effectiveShellTitle',
  'shellFallbackPwsh',
  'envSideTitle',
  'envSideWindows',
  'envSideWsl',
  'wslDetectAction',
  'wslDetectHint',
  'wslDetectEmpty'
] as const

/** Product-name keys that are intentionally identical across locales. */
const PRODUCT_NAME_KEYS = ['shellPwsh', 'shellPowershell', 'shellCmd', 'envSideWsl'] as const

const LOCALES = [
  { copy: zh, name: 'zh' },
  { copy: zhHant, name: 'zh-hant' },
  { copy: ja, name: 'ja' },
  { copy: ar, name: 'ar' }
] as const

describe('terminal shell locale copy', () => {
  it('en: carries exactly the frozen terminalShell keys', () => {
    const fallback = en.settings.appearance.terminalShell as unknown as Record<string, unknown>

    expect(Object.keys(fallback).sort()).toEqual([...TERMINAL_SHELL_KEYS].sort())
  })

  for (const { copy, name } of LOCALES) {
    it(`${name}: localizes every terminalShell key (never the English fallback)`, () => {
      const localized = copy.settings.appearance.terminalShell
      const fallback = en.settings.appearance.terminalShell

      // Every frozen key exists on the merged catalog (defineLocale fills the rest).
      expect(Object.keys(localized as unknown as Record<string, unknown>).sort()).toEqual(
        [...TERMINAL_SHELL_KEYS].sort()
      )

      for (const key of TERMINAL_SHELL_KEYS) {
        const value = localized[key]
        const english = fallback[key]

        expect(typeof value, `${name}.settings.appearance.terminalShell.${key} must be a string`).toBe('string')
        expect(value.length, `${name}.settings.appearance.terminalShell.${key} must not be blank`).toBeGreaterThan(0)

        // A key left out would silently inherit English through defineLocale;
        // the whole point of this suite is that every locale carries its own
        // copy. Product-name keys are exempt — 'PowerShell 7' is 'PowerShell 7'
        // in every language.
        if (!PRODUCT_NAME_KEYS.includes(key as (typeof PRODUCT_NAME_KEYS)[number])) {
          expect(value, `${name}.settings.appearance.terminalShell.${key} must not equal the English copy`).not.toBe(
            english
          )
        }
      }
    })
  }
})
