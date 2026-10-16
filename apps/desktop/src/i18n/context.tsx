import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { type FulilianConfigRecord, getFulilianConfigRecord, saveFulilianConfig } from '@/fulilian'

import { getTranslations, hasTranslations, loadTranslations } from './catalog'
import { DEFAULT_LOCALE, localeConfigValue, normalizeLocale } from './languages'
import { setRuntimeI18nLocale } from './runtime'
import type { Locale, Translations } from './types'

export { LOCALE_META } from './languages'

export interface I18nConfigClient {
  getConfig: () => Promise<FulilianConfigRecord>
  saveConfig: (config: FulilianConfigRecord) => Promise<{ ok: boolean }>
}

const defaultConfigClient: I18nConfigClient = {
  getConfig: () => {
    if (typeof window === 'undefined' || !window.fulilianDesktop?.api) {
      return Promise.resolve({})
    }

    return getFulilianConfigRecord()
  },
  saveConfig: config => {
    if (typeof window === 'undefined' || !window.fulilianDesktop?.api) {
      return Promise.resolve({ ok: true })
    }

    return saveFulilianConfig(config)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getConfigDisplayLanguage(config: FulilianConfigRecord): unknown {
  return isRecord(config.display) ? config.display.language : undefined
}

export function withConfigDisplayLanguage(config: FulilianConfigRecord, locale: Locale): FulilianConfigRecord {
  const display = isRecord(config.display) ? config.display : {}

  return {
    ...config,
    display: {
      ...display,
      language: localeConfigValue(locale)
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

const RTL_LOCALES = new Set<Locale>(['ar'])

function applyDocumentLocale(locale: Locale) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.lang = locale
  document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'
}

export interface I18nContextValue {
  configLoadError: Error | null
  isLoadingConfig: boolean
  isSavingLocale: boolean
  locale: Locale
  saveError: Error | null
  setLocale: (next: Locale) => Promise<void>
  t: Translations
}

const I18nContext = createContext<I18nContextValue>({
  configLoadError: null,
  isLoadingConfig: false,
  isSavingLocale: false,
  locale: DEFAULT_LOCALE,
  saveError: null,
  setLocale: async () => {},
  t: getTranslations(DEFAULT_LOCALE)
})

export interface I18nProviderProps {
  children: ReactNode
  configClient?: I18nConfigClient | null
  initialLocale?: unknown
}

export function I18nProvider({ children, configClient = defaultConfigClient, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => normalizeLocale(initialLocale))
  // P9 patch (step 17, M1): `t` is no longer its own state slice — it is derived
  // from `locale` DURING RENDER (`const t` below), so the active language and
  // `locale` cannot diverge inside a commit. Only `en` ships on the first frame;
  // a non-English locale swaps in once its chunk lands. `translationsVersion`
  // exists solely to force that swap's re-render, because the catalog is a
  // module-level cache the render phase cannot itself await.
  const [, setTranslationsVersion] = useState(0)
  const [isLoadingConfig, setIsLoadingConfig] = useState(false)
  const [isSavingLocale, setIsSavingLocale] = useState(false)
  const [configLoadError, setConfigLoadError] = useState<Error | null>(null)
  const [saveError, setSaveError] = useState<Error | null>(null)
  // P16 (step 17): monotonic id for in-flight locale transitions — a newer
  // `setLocale` call supersedes the swap an older one has pending.
  const transitionSeqRef = useRef(0)

  useEffect(() => {
    setRuntimeI18nLocale(locale)
    applyDocumentLocale(locale)

    // The render already shows `getTranslations(locale)` (the English fallback
    // while the chunk is absent). Only a not-yet-resident locale needs loading;
    // when it lands we bump `translationsVersion` to re-render, which re-derives
    // `t` from the SAME `locale` already on screen — no cross-locale mismatch.
    if (hasTranslations(locale)) {
      return
    }

    let cancelled = false

    const bump = () => {
      if (!cancelled) {
        setTranslationsVersion(version => version + 1)
      }
    }

    // A failed chunk falls back to English (catalog contract); the bump just
    // re-renders on that fallback rather than wedging the provider.
    void loadTranslations(locale).then(bump, bump)

    return () => {
      cancelled = true
    }
  }, [locale])

  useEffect(() => {
    if (!configClient) {
      return
    }

    let cancelled = false

    setIsLoadingConfig(true)
    setConfigLoadError(null)

    configClient
      .getConfig()
      .then(config => {
        if (!cancelled) {
          setLocaleState(normalizeLocale(getConfigDisplayLanguage(config)))
        }
      })
      .catch(error => {
        if (!cancelled) {
          setConfigLoadError(toError(error))
          setLocaleState(DEFAULT_LOCALE)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingConfig(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [configClient, initialLocale])

  // P16 (step 17): switching languages used to commit the new `locale` state
  // immediately, so the whole tree re-rendered against the English fallback
  // while the lazy chunk was still in flight and then re-rendered AGAIN when
  // the chunk landed. Instead, keep the old locale on screen (transition
  // state), resolve the chunk out of band, and swap exactly once. A failed
  // chunk resolves to the English fallback (catalog contract), so the swap
  // still happens; a failed save rejects before the swap, leaving the old
  // locale on screen with nothing to roll back. `locale`/`t` stay same-commit
  // (17d1418): both re-derive from `locale` on the single swap render.
  const setLocale = useCallback(
    async (next: Locale) => {
      const target = normalizeLocale(next)

      setSaveError(null)

      const transitionId = ++transitionSeqRef.current

      const chunkReady: Promise<void> = hasTranslations(target)
        ? Promise.resolve()
        : loadTranslations(target).then(
            () => undefined,
            () => undefined
          )

      const saveFlow: Promise<void> = (async () => {
        if (!configClient) {
          return
        }

        setIsSavingLocale(true)

        try {
          const latestConfig = await configClient.getConfig()
          const result = await configClient.saveConfig(withConfigDisplayLanguage(latestConfig, target))

          if (!result.ok) {
            throw new Error('Failed to save language')
          }
        } catch (error) {
          const nextError = toError(error)

          setSaveError(nextError)
          throw nextError
        } finally {
          setIsSavingLocale(false)
        }
      })()

      // Swap only after BOTH the chunk is resident and the config save
      // settled; a save failure propagates to the caller (switcher toast) and
      // the screen keeps showing the old locale. A newer `setLocale` call
      // supersedes this transition's swap.
      await Promise.all([chunkReady, saveFlow])

      if (transitionSeqRef.current === transitionId) {
        setLocaleState(target)
      }
    },
    [configClient]
  )

  // Derived synchronously from `locale`, so `t` and `locale` are always the same
  // language inside a commit. A `translationsVersion` bump (when a lazy chunk
  // lands) re-runs this render and re-reads the catalog for the same `locale`.
  const t = getTranslations(locale)

  const value = useMemo<I18nContextValue>(
    () => ({
      configLoadError,
      isLoadingConfig,
      isSavingLocale,
      locale,
      saveError,
      setLocale,
      t
    }),
    [configLoadError, isLoadingConfig, isSavingLocale, locale, saveError, setLocale, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
