import { en } from './en'
import type { Locale, Translations } from './types'

// P9 (step 17): the locale catalog is split PER LANGUAGE and loaded on demand.
//
// Before, all five bundles were imported statically, so every cold start
// parsed + evaluated ~760 KB of i18n (four languages the user will almost
// never look at) before the first paint. Only `en` — the default locale AND
// the fallback every `defineLocale(...)` merges over — is needed on the first
// frame; the rest load the moment the active `display.language` selects them
// (the same async gap the config fetch already has) and are cached after.
//
// `en` stays a static import: it is the base of every locale (`defineLocale`
// merges over it) and the always-available fallback, so it must never be
// behind an await.
const loaded: Partial<Record<Locale, Translations>> = { en }

/** The active bundle for `locale`, or the English fallback when it has not
 *  been loaded yet. Synchronous by contract so translators can keep their
 *  existing shape; resolution falls back exactly like `translateFrom` does. */
export function getTranslations(locale: Locale): Translations {
  return loaded[locale] ?? en
}

/** Whether `locale`'s own bundle is resident (false for every non-English
 *  locale until `loadTranslations` resolves). */
export function hasTranslations(locale: Locale): boolean {
  return loaded[locale] !== undefined
}

/** Fetch and cache a locale's bundle. Idempotent — the import is memoized by
 *  the bundler and the result by `loaded`, so concurrent callers share one
 *  network/chunk fetch. Unknown locales resolve to the English fallback. */
export async function loadTranslations(locale: Locale): Promise<Translations> {
  if (loaded[locale]) {
    return loaded[locale]!
  }

  switch (locale) {
    case 'zh': {
      loaded.zh = (await import('./zh')).zh

      break
    }

    case 'zh-hant': {
      loaded['zh-hant'] = (await import('./zh-hant')).zhHant

      break
    }

    case 'ja': {
      loaded.ja = (await import('./ja')).ja

      break
    }

    case 'ar': {
      loaded.ar = (await import('./ar')).ar

      break
    }

    default:
      return en
  }

  return loaded[locale] ?? en
}

/** Load every locale. Test/utility convenience only — the app never needs
 *  more than the active language plus English. */
export async function loadAllTranslations(): Promise<void> {
  await Promise.all([loadTranslations('zh'), loadTranslations('zh-hant'), loadTranslations('ja'), loadTranslations('ar')])
}

/** Synchronous, fallback-aware view of the catalog for callers that cannot
 *  await (kept for the existing `TRANSLATIONS[locale]` call sites and tests).
 *  Unloaded locales read as English instead of `undefined`. */
export const TRANSLATIONS: Record<Locale, Translations> = new Proxy(loaded as Record<Locale, Translations>, {
  get(target, prop: string) {
    return target[prop as Locale] ?? en
  }
})
