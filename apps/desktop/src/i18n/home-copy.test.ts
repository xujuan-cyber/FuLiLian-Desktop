import { describe, expect, it } from 'vitest'

import { ar } from './ar'
import { en } from './en'
import { ja } from './ja'
import type { Translations } from './types'
import { zh } from './zh'
import { zhHant } from './zh-hant'

// Guard for the "add keys in all five languages" rule. `ja`, `ar` and
// `zh-hant` are built with `defineLocale()` over `en`, so a missing key
// silently degrades to English instead of failing typecheck — comparing the
// values is the only way to catch that.
const LOCALES: Record<string, Translations> = { en, zh, 'zh-hant': zhHant, ja, ar }

// Copy that is rendered on the first screen. `chipsNote` is deliberately
// excluded: it is kept for the "never delete a key" rule but no longer shown.
function renderedHome(t: Translations): Record<string, string> {
  const h = t.home

  return {
    'greeting.morning': h.greeting.morning,
    'greeting.afternoon': h.greeting.afternoon,
    'greeting.evening': h.greeting.evening,
    lede: h.lede,
    'chips.programming': h.chips.programming,
    'chips.programmingTip': h.chips.programmingTip,
    'chips.forensics': h.chips.forensics,
    'chips.ctf': h.chips.ctf,
    'chips.idle': h.chips.idle,
    'chips.placeholderTip': h.chips.placeholderTip,
    'section.title': h.section.title,
    'section.more': h.section.more,
    'modeCards.forensics': h.modeCards.forensics,
    'modeCards.forensicsDesc': h.modeCards.forensicsDesc,
    'modeCards.ctf': h.modeCards.ctf,
    'modeCards.ctfDesc': h.modeCards.ctfDesc,
    'modeCards.project': h.modeCards.project,
    'modeCards.projectDesc': h.modeCards.projectDesc
  }
}

describe('home copy across locales', () => {
  it('is present and non-empty in all five languages', () => {
    for (const [locale, t] of Object.entries(LOCALES)) {
      for (const [key, value] of Object.entries(renderedHome(t))) {
        expect(value.trim(), `${locale}.home.${key}`).not.toBe('')
      }
    }
  })

  it('is actually translated, not inherited from the English base', () => {
    const base = renderedHome(en)

    for (const [locale, t] of Object.entries(LOCALES)) {
      if (locale === 'en') {
        continue
      }

      const own = renderedHome(t)

      for (const [key, value] of Object.entries(own)) {
        expect(value, `${locale}.home.${key} still reads as the English string`).not.toBe(base[key])
      }
    }
  })

  it('keeps Traditional Chinese distinct from Simplified Chinese', () => {
    const simplified = renderedHome(zh)
    const traditional = renderedHome(zhHant)

    for (const [key, value] of Object.entries(traditional)) {
      expect(value, `zh-hant.home.${key} is a copy of zh`).not.toBe(simplified[key])
    }
  })

  it('never ships engineering vocabulary in rendered copy', () => {
    for (const [locale, t] of Object.entries(LOCALES)) {
      for (const [key, value] of Object.entries(renderedHome(t))) {
        expect(value, `${locale}.home.${key}`).not.toMatch(/kind|data layer|データ層|数据层|資料層|طبقة بيانات|静态占位|プレースホルダー|placeholder/i)
      }
    }
  })

  it('keeps one language per screen', () => {
    // Latin words are allowed only for product/format names.
    const latinAllowed = /\b(CTF|flag|git)\b/gi

    for (const locale of ['zh', 'zh-hant', 'ja', 'ar']) {
      for (const [key, value] of Object.entries(renderedHome(LOCALES[locale]))) {
        const stripped = value.replace(latinAllowed, '')
        expect(stripped, `${locale}.home.${key} mixes Latin copy in`).not.toMatch(/[A-Za-z]{2,}/)
      }
    }

    for (const [key, value] of Object.entries(renderedHome(en))) {
      expect(value, `en.home.${key} contains CJK`).not.toMatch(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/)
      expect(value, `en.home.${key} contains Arabic`).not.toMatch(/[\u0600-\u06ff]/)
    }
  })
})
