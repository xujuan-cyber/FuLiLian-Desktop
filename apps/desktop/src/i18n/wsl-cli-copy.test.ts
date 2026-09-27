import { describe, expect, it } from 'vitest'

import { en } from './en'
import { ja } from './ja'
import { zhHant } from './zh-hant'

/**
 * The twelve `settings.toolsets.wslCli` keys frozen by step09 v1 (`types.ts`).
 * `en.ts` is the single source of truth for the names and signatures.
 */
const WSL_CLI_TEXT_KEYS = [
  'sectionTitle',
  'hint',
  'loading',
  'reprobe',
  'available',
  'unavailable',
  'unknown',
  'probeFailedTitle',
  'failedProbe',
  'bridgeUnavailable'
] as const

/** The three `rightSidebar` terminal-CLI switcher keys frozen by step09 v1. */
const SWITCHER_KEYS = ['wslCliSwitcher', 'wslCliMenuLabel', 'wslCliLocal'] as const

const LOCALES = [
  { copy: zhHant, name: 'zh-hant' },
  { copy: ja, name: 'ja' }
] as const

describe('wsl CLI locale copy', () => {
  for (const { copy, name } of LOCALES) {
    it(`${name}: localizes all twelve toolsets.wslCli keys (never the English fallback)`, () => {
      const localized = copy.settings.toolsets.wslCli
      const fallback = en.settings.toolsets.wslCli as unknown as Record<string, unknown>

      // All twelve keys exist on the merged catalog (defineLocale fills the rest).
      expect(Object.keys(fallback).sort()).toEqual(
        [
          'available',
          'bridgeUnavailable',
          'failedOptin',
          'failedProbe',
          'hint',
          'loading',
          'probeFailedBody',
          'probeFailedTitle',
          'reprobe',
          'sectionTitle',
          'unavailable',
          'unknown'
        ].sort()
      )

      for (const key of WSL_CLI_TEXT_KEYS) {
        const value = localized[key]
        const english = fallback[key]

        expect(typeof value, `${name}.settings.toolsets.wslCli.${key} must be a string`).toBe('string')
        expect(value.length, `${name}.settings.toolsets.wslCli.${key} must not be blank`).toBeGreaterThan(0)
        // A key left out would silently inherit English through defineLocale; the
        // whole point of this fix is that these two locales carry their own copy.
        expect(value, `${name}.settings.toolsets.wslCli.${key} must not equal the English copy`).not.toBe(english)
      }

      // Called out explicitly in the acceptance criteria.
      expect(localized.sectionTitle).not.toBe(fallback.sectionTitle)
      expect(localized.sectionTitle.trim().length).toBeGreaterThan(0)
    })

    it(`${name}: keeps probeFailedBody / failedOptin callable functions`, () => {
      const localized = copy.settings.toolsets.wslCli
      const fallback = en.settings.toolsets.wslCli

      expect(typeof localized.probeFailedBody).toBe('function')
      expect(typeof localized.failedOptin).toBe('function')

      const body = localized.probeFailedBody('spawn-failed')
      expect(typeof body).toBe('string')
      expect(body.length).toBeGreaterThan(0)
      expect(body).toContain('spawn-failed')
      expect(body).not.toBe(fallback.probeFailedBody('spawn-failed'))

      const failed = localized.failedOptin('claude')
      expect(typeof failed).toBe('string')
      expect(failed.length).toBeGreaterThan(0)
      expect(failed).toContain('claude')
      expect(failed).not.toBe(fallback.failedOptin('claude'))
    })

    it(`${name}: localizes the three rightSidebar terminal-CLI switcher keys`, () => {
      for (const key of SWITCHER_KEYS) {
        const value = copy.rightSidebar[key]
        const english = en.rightSidebar[key]

        expect(typeof value, `${name}.rightSidebar.${key} must be a string`).toBe('string')
        expect(value.trim().length, `${name}.rightSidebar.${key} must not be blank`).toBeGreaterThan(0)
        expect(value, `${name}.rightSidebar.${key} must not equal the English copy`).not.toBe(english)
      }

      // The switcher trigger label is the one the rail renders; pin the exact pair.
      expect(copy.rightSidebar.wslCliSwitcher).not.toBe(en.rightSidebar.wslCliSwitcher)
      expect(copy.rightSidebar.wslCliMenuLabel).not.toBe(en.rightSidebar.wslCliMenuLabel)
      expect(copy.rightSidebar.wslCliLocal).not.toBe(en.rightSidebar.wslCliLocal)
    })
  }
})
