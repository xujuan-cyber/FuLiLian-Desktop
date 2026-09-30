import { useCallback, useEffect, useRef, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { SearchField } from '@/components/ui/search-field'
import { ResponsiveTabs } from '@/components/ui/tab-dropdown'
import { LogView } from '@/components/ui/log-view'
import { getLogs } from '@/fulilian'
import { useI18n } from '@/i18n'
import { AlertCircle } from '@/lib/icons'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'

// The backend's full log-file table (`fulilian_cli/logs.py` LOG_FILES). The
// System tab's tail filter shares this list — gui/mcp were previously only
// reachable through the raw endpoint, never the UI (R11).
export const LOG_FILES = ['agent', 'errors', 'gateway', 'gui', 'desktop', 'mcp'] as const
export const LOG_LEVELS = ['ALL', 'INFO', 'WARNING', 'ERROR'] as const

// A dedicated diagnostics page can afford a deeper tail than the System tab's
// 200-line health glance.
export const LOG_PAGE_LINES = 500

/** The R11 diagnostics page: full file table × level × server-side keyword
 *  search over the existing `GET /api/logs` — no new backend surface (U2).
 *  Pure frontend: every filter rides the existing query params, and an empty
 *  result renders the honest "no logs" state. */
export function LogsPanel() {
  const { t } = useI18n()
  const cc = t.commandCenter
  const [file, setFile] = useState<(typeof LOG_FILES)[number]>('agent')
  const [level, setLevel] = useState<(typeof LOG_LEVELS)[number]>('ALL')
  const [query, setQuery] = useState('')
  const [lines, setLines] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  // Server-side search: the endpoint takes `search` directly, so a keyword
  // filters before the payload crosses the wire — same semantics as
  // `fulilian logs --search`, not a client-side substring pass.
  const debouncedQuery = useDebouncedValue(query.trim(), 250)

  const refresh = useCallback(async () => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError('')

    try {
      const response = await getLogs({
        file,
        level,
        lines: LOG_PAGE_LINES,
        search: debouncedQuery || undefined
      })

      if (requestRef.current === requestId) {
        setLines(response.lines)
      }
    } catch (e) {
      if (requestRef.current === requestId) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [debouncedQuery, file, level])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useRefreshHotkey(refresh)

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4">
      <div>
        {error && (
          <span className="mb-2 inline-flex items-center gap-1 text-[length:var(--conversation-caption-font-size)] text-destructive">
            <AlertCircle className="size-3.5" />
            {error}
          </span>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ResponsiveTabs
              onChange={id => setFile(id as (typeof LOG_FILES)[number])}
              tabs={LOG_FILES.map(value => ({ id: value, label: value }))}
              value={file}
            />
            <ResponsiveTabs
              onChange={id => setLevel(id as (typeof LOG_LEVELS)[number])}
              tabs={LOG_LEVELS.map(value => ({
                id: value,
                label: value === 'ALL' ? 'all' : value.toLowerCase()
              }))}
              value={level}
            />
          </div>
          <SearchField
            containerClassName="w-44"
            onChange={next => setQuery(next)}
            placeholder={cc.logSearchPlaceholder}
            value={query}
          />
        </div>
      </div>
      {loading && lines === null ? (
        <PageLoader className="min-h-32" label={cc.loadingLogs} />
      ) : lines !== null && lines.length === 0 ? (
        <div className="grid min-h-48 place-items-center px-6 text-center">
          <div className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
            {cc.noLogs}
          </div>
        </div>
      ) : (
        <LogView className="min-h-0 flex-1 bg-(--ui-bg-quinary)">{(lines ?? []).join('\n')}</LogView>
      )}
    </div>
  )
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)

    return () => window.clearTimeout(id)
  }, [delayMs, value])

  return debounced
}
