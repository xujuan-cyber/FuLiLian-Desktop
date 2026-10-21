import { normalize } from '@/lib/text'

import type { Locale, TextDirection } from './types'

// Fulilian ships Chinese-first: the default UI language is Simplified Chinese,
// and the picker still allows switching to any other locale.
export const DEFAULT_LOCALE: Locale = 'zh'

export const LOCALE_OPTIONS = [
  {
    id: 'en',
    dir: 'ltr',
    name: 'English',
    englishName: 'English',
    configValue: 'en'
  },
  {
    id: 'zh',
    dir: 'ltr',
    name: '简体中文',
    englishName: 'Simplified Chinese',
    configValue: 'zh'
  },
  {
    id: 'zh-hant',
    dir: 'ltr',
    name: '繁體中文',
    englishName: 'Traditional Chinese',
    configValue: 'zh-hant'
  },
  {
    id: 'ja',
    dir: 'ltr',
    name: '日本語',
    englishName: 'Japanese',
    configValue: 'ja'
  },
  {
    id: 'ar',
    dir: 'rtl',
    name: 'العربية',
    englishName: 'Arabic',
    configValue: 'ar'
  }
] as const satisfies readonly { configValue: string; dir: TextDirection; englishName: string; id: Locale; name: string }[]

// `name` is the endonym (native name) shown in the picker so users recognize
// their language regardless of the current UI language. No country flags:
// languages are not countries. `englishName` is search-only (not shown) so an
// English speaker can type "japanese"/"traditional" to filter the list.
export const LOCALE_META: Record<Locale, { dir: TextDirection; name: string; englishName: string }> = Object.fromEntries(
  LOCALE_OPTIONS.map(locale => [locale.id, { dir: locale.dir, name: locale.name, englishName: locale.englishName }])
) as Record<Locale, { dir: TextDirection; name: string; englishName: string }>

/** Writing direction of a locale. Arabic is the only RTL language we ship. */
export function localeDir(locale: Locale): TextDirection {
  return LOCALE_META[locale]?.dir ?? 'ltr'
}

const LOCALE_ALIASES: Record<string, Locale> = {
  en: 'en',
  'en-us': 'en',
  en_us: 'en',
  zh: 'zh',
  'zh-cn': 'zh',
  zh_cn: 'zh',
  'zh-hans': 'zh',
  zh_hans: 'zh',
  'zh-hans-cn': 'zh',
  zh_hans_cn: 'zh',
  'zh-tw': 'zh-hant',
  zh_tw: 'zh-hant',
  'zh-hk': 'zh-hant',
  zh_hk: 'zh-hant',
  'zh-mo': 'zh-hant',
  zh_mo: 'zh-hant',
  'zh-hant': 'zh-hant',
  zh_hant: 'zh-hant',
  'zh-hant-tw': 'zh-hant',
  zh_hant_tw: 'zh-hant',
  'zh-hant-hk': 'zh-hant',
  zh_hant_hk: 'zh-hant',
  ja: 'ja',
  'ja-jp': 'ja',
  ja_jp: 'ja',
  ar: 'ar',
  'ar-sa': 'ar',
  ar_sa: 'ar',
  'ar-ae': 'ar',
  ar_ae: 'ar',
  'ar-eg': 'ar',
  ar_eg: 'ar',
  arabic: 'ar',
  العربية: 'ar'
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALE_OPTIONS.some(locale => locale.id === value)
}

export function normalizeLocale(value: unknown): Locale {
  if (typeof value !== 'string') {
    return DEFAULT_LOCALE
  }

  return LOCALE_ALIASES[normalize(value)] ?? DEFAULT_LOCALE
}

export function isSupportedLocaleValue(value: unknown): boolean {
  return typeof value === 'string' && LOCALE_ALIASES[normalize(value)] != null
}

export function localeConfigValue(locale: Locale): string {
  return LOCALE_OPTIONS.find(item => item.id === locale)?.configValue ?? DEFAULT_LOCALE
}
