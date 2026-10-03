import { useEffect, useMemo, useRef, useState } from 'react'

import { saveFulilianConfig } from '@/fulilian'
import { useI18n } from '@/i18n'
import { notifyError } from '@/store/notifications'
import type { FulilianConfigRecord } from '@/types/fulilian'

import { fulilianConfigCacheWriter, useFulilianConfigRecord } from '../hooks/use-config-record'

import { getNested, setNested } from './helpers'

export const CONFIG_DRAFT_SAVE_DEBOUNCE_MS = 550

/**
 * A local editable draft of the shared config record, seeded once from the
 * shared cache and saved back through it with debounced autosave — the same
 * channel ConfigSettings uses (`GET/PUT /api/config`), so new guardrail/work
 * mode pages persist without inventing a second persistence path. Values are
 * read with component-level defaults via `value()` (缺省回退): untouched keys
 * never land in config.yaml until the user actually edits them.
 */
export function useConfigDraft() {
  const { t } = useI18n()
  const c = t.settings.config
  const [config, setConfig] = useState<FulilianConfigRecord | null>(null)

  const {
    data: loadedConfig,
    isError: configLoadFailed,
    refetch: refetchConfig
  } = useFulilianConfigRecord()

  const writeConfigCache = useMemo(() => fulilianConfigCacheWriter(), [])
  const saveVersionRef = useRef(0)
  const [saveVersion, setSaveVersion] = useState(0)
  const configSeeded = useRef(false)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (loadedConfig && !configSeeded.current) {
      configSeeded.current = true
      setConfig(loadedConfig)
    }
  }, [loadedConfig])

  // eslint-disable-next-line no-restricted-syntax -- autosave bookkeeping refs, not an atom mirror
  useEffect(() => {
    if (!config || saveVersion === 0) {
      return
    }

    const v = saveVersion

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await saveFulilianConfig(config)

          if (!result.ok) {
            throw new Error(c.autosaveFailed)
          }

          writeConfigCache(config)
        } catch (err) {
          if (saveVersionRef.current === v) {
            notifyError(err, c.autosaveFailed)
          }
        }
      })()
    }, CONFIG_DRAFT_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- copy is stable; avoid re-scheduling autosave on locale change
  }, [config, saveVersion])

  const applyConfig = (next: FulilianConfigRecord) => {
    saveVersionRef.current += 1
    setConfig(next)
    setSaveVersion(saveVersionRef.current)
  }

  const update = (key: string, value: unknown) => {
    if (config) {
      applyConfig(setNested(config, key, value))
    }
  }

  /** Config value at `key`, falling back to `fallback` when unset (缺省回退). */
  const value = <T,>(key: string, fallback: T): T => (config ? (getNested(config, key) as T | undefined) ?? fallback : fallback)

  return {
    config,
    failed: configLoadFailed && !config,
    ready: config != null,
    refetch: () => void refetchConfig(),
    update,
    value
  }
}
