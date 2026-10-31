import { useStore } from '@nanostores/react'
import {
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useNavigate } from 'react-router'

import { controlVariants } from '@/components/ui/control'
import { KbdCombo } from '@/components/ui/kbd'
import { useI18n } from '@/i18n'
import { Search } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $bindings, bindingsFor } from '@/store/keybinds'

import { SETTINGS_ROUTE } from '../routes'

import { filterSettingsSearchEntries, type SettingsSearchEntry, settingsSearchTargetQuery } from './settings-search'
import { useSettingsSearchCatalog } from './use-settings-search'

/** Imperative surface the shell needs for its type-to-search reflex. */
export interface SettingsSearchFieldHandle {
  /** Focus the field, optionally seeded with the keystroke that asked for it. */
  focusWith: (text?: string) => void
}

// The rail is 13rem wide and only ~10 rows tall on a short window: eight hits
// is enough to reach any setting without the popover covering the nav it
// belongs to. The list still scrolls if a row grows (larger UI scale).
const MAX_RESULTS = 8

/**
 * The Settings rail's search box. It replaces the old ⌘K pill that rode the
 * card's top edge: that was chrome (a `<button>` pretending to be a field)
 * pinned as the overlay card's sibling, so it floated over the card's own
 * toolbar. This is a real input inside the rail, filtering the same catalog the
 * ⌘K settings page uses — one index, two surfaces.
 */
export const SettingsSearchField = forwardRef<SettingsSearchFieldHandle, { className?: string }>(
  function SettingsSearchField({ className }, ref) {
    const { t } = useI18n()
    const navigate = useNavigate()
    const rootRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const listId = useId()
    const [query, setQuery] = useState('')
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const bindings = useStore($bindings)
    const combo = bindingsFor('nav.commandPalette', bindings)[0]

    // Catalog queries (schema, env vars, plugins) stay cold until the field is
    // actually used — opening Settings must not fire them on its own. Same
    // reason the palette only asks for the deep lists once the user types.
    const catalog = useSettingsSearchCatalog(open || query.trim().length > 0)
    const { appearanceEntries, configEntries, credentialEntries, pluginEntries } = catalog

    const entries = useMemo<SettingsSearchEntry[]>(
      () => [...appearanceEntries, ...configEntries, ...pluginEntries, ...credentialEntries],
      [appearanceEntries, configEntries, pluginEntries, credentialEntries]
    )

    // The palette's own scorer — same ranking, same multi-term AND matching, so
    // a query typed here and the same query typed into ⌘K agree on the hits.
    const results = useMemo(
      () => filterSettingsSearchEntries(entries, query).slice(0, MAX_RESULTS),
      [entries, query]
    )

    const showResults = open && results.length > 0
    const active = results[activeIndex]

    const commit = useCallback(
      (entry: SettingsSearchEntry) => {
        navigate({ pathname: SETTINGS_ROUTE, search: `?${settingsSearchTargetQuery(entry.target)}` })
        setOpen(false)
        inputRef.current?.blur()
      },
      [navigate]
    )

    useImperativeHandle(
      ref,
      () => ({
        focusWith: (text?: string) => {
          if (text) {
            setQuery(text)
          }

          setOpen(true)
          setActiveIndex(0)

          // Deferred: the ⌘K dispatcher (window capture) may be releasing its
          // own focus hand-back on this very tick.
          queueMicrotask(() => {
            const input = inputRef.current

            if (!input) {
              return
            }

            input.focus()

            const end = input.value.length
            input.setSelectionRange(end, end)
          })
        }
      }),
      []
    )

    useEffect(() => {
      setActiveIndex(0)
    }, [query])

    // A click anywhere outside drops the popover without stealing the click.
    useEffect(() => {
      if (!open) {
        return
      }

      const onPointerDown = (event: PointerEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) {
          setOpen(false)
        }
      }

      document.addEventListener('pointerdown', onPointerDown, true)

      return () => document.removeEventListener('pointerdown', onPointerDown, true)
    }, [open])

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        // Consume it here: the overlay's own Esc closes Settings, and the user
        // asked to leave the search, not the page.
        event.preventDefault()
        event.stopPropagation()
        setQuery('')
        setOpen(false)
        inputRef.current?.blur()

        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (results.length === 0) {
          return
        }

        event.preventDefault()
        setOpen(true)
        setActiveIndex(index => {
          const next = event.key === 'ArrowDown' ? index + 1 : index - 1

          return (next + results.length) % results.length
        })

        return
      }

      if (event.key === 'Enter' && active) {
        event.preventDefault()
        commit(active)
      }
    }

    return (
      <div className={cn('relative', className)} ref={rootRef}>
        <div className={cn(controlVariants({ size: 'sm' }), 'flex h-8 items-center gap-1.5 px-2')}>
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            aria-activedescendant={showResults && active ? `${listId}-${active.id}` : undefined}
            aria-autocomplete="list"
            aria-controls={showResults ? listId : undefined}
            aria-expanded={showResults}
            aria-label={t.settings.search.placeholder}
            autoComplete="off"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs leading-4 text-foreground outline-none placeholder:text-muted-foreground"
            onChange={event => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={t.settings.search.placeholder}
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="text"
            value={query}
          />
          {combo && <KbdCombo combo={combo} size="sm" variant="ghost" />}
        </div>

        {showResults && (
          <div
            className="absolute inset-x-0 top-[calc(100%+0.25rem)] z-30 max-h-[18rem] overflow-y-auto rounded-[2.5px] border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-1 shadow-md"
            data-slot="settings-search-results"
            id={listId}
            role="listbox"
          >
            {results.map((entry, index) => {
              const Icon = entry.icon

              return (
                <div
                  aria-selected={index === activeIndex}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-[2.5px] px-2 py-1.5 text-left transition-colors',
                    index === activeIndex
                      ? 'bg-(--chrome-action-hover) text-foreground'
                      : 'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'
                  )}
                  id={`${listId}-${entry.id}`}
                  key={entry.id}
                  onClick={() => commit(entry)}
                  // Keep the caret in the field so the next keystroke still
                  // filters instead of landing on a button.
                  onMouseDown={event => event.preventDefault()}
                  role="option"
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-foreground">{entry.label}</span>
                    <span className="block truncate text-[0.6875rem] text-(--ui-text-tertiary)">{entry.context}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }
)
