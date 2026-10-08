import { useEffect, useReducer, useRef } from 'react'

import { ArrowUp, Bug, Pencil, Search, Terminal } from '@/lib/icons'
import { useI18n } from '@/i18n'
import {
  initialQuickComposerState,
  QUICK_CAPTURE_MODES,
  QUICK_TARGET_NEW,
  type QuickCaptureMode,
  type QuickComposerEvent,
  quickComposerReducer,
  type QuickComposerState
} from '@/store/quick-entry'

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'

/*
 * Token fallbacks are deliberate (step 16 REV-批次一 S2 / backlog BL-15).
 *
 * The inline styles below spell colours as `var(--token, #hex)`. That hex is not
 * a stray literal: this window is a transient floating card that can paint
 * before `ThemeProvider` has injected `--dt-*`, and `styles.css`'s
 * `--foreground: var(--dt-foreground)` chain then resolves to nothing. Without
 * the fallback the card would render uncoloured at exactly the moment
 * index.html's boot script works hardest to avoid a flash. All eight fallbacks
 * are registered as an exemption in DESIGN_PROPOSAL §2 — do not strip them back
 * to bare `var(--token)`.
 */

/** Chip vocabulary, one entry per work mode (DESIGN_PROPOSAL §4.1). */
const MODE_META: Record<
  QuickCaptureMode,
  { icon: typeof Bug; labelKey: 'modeCtf' | 'modeForensics' | 'modeNote' | 'modeProject' }
> = {
  ctf: { icon: Bug, labelKey: 'modeCtf' },
  forensics: { icon: Search, labelKey: 'modeForensics' },
  note: { icon: Pencil, labelKey: 'modeNote' },
  project: { icon: Terminal, labelKey: 'modeProject' }
}

/**
 * The persisted accelerator → keycap copy. `CommandOrControl` is Electron's
 * platform alias, so the keycap resolves it the way the user's platform reads
 * it; everything else passes through untouched.
 */
export function shortcutKeycapText(shortcut: string, isMac = /Mac/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)): string {
  return shortcut
    .split('+')
    .map(part => {
      const lower = part.trim().toLowerCase()

      if (lower === 'commandorcontrol') {
        return isMac ? '⌘' : 'Ctrl'
      }

      if (lower === 'command') {
        return isMac ? '⌘' : part.trim()
      }

      return part.trim()
    })
    .join(' ')
}

const surfaceStyle: CSSProperties = {
  alignItems: 'center',
  background: 'transparent',
  display: 'flex',
  height: '100vh',
  justifyContent: 'center',
  padding: 12,
  width: '100vw'
}

const cardStyle: CSSProperties = {
  background: 'var(--card, var(--ui-bg-elevated, var(--background)))',
  border: '1px solid var(--ui-stroke-secondary, var(--border, rgba(127,127,127,0.35)))',
  borderRadius: 'var(--radius-xl, 12px)',
  boxShadow: 'var(--dt-shadow-card, 0 18px 48px rgba(0,0,0,0.38))',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 14px',
  width: '100%'
}

const inputRowStyle: CSSProperties = {
  alignItems: 'center',
  background: 'var(--muted, var(--ui-bg-inset, transparent))',
  border: '1px solid var(--ui-stroke-secondary, var(--border, transparent))',
  borderRadius: 'var(--radius-lg, 8px)',
  display: 'flex',
  gap: 8,
  padding: '4px 8px'
}

const inputStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--foreground, #eee)',
  flex: 1,
  fontFamily: 'inherit',
  fontSize: 15,
  minWidth: 0,
  outline: 'none'
}

const chipRowStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6
}

const chipStyle = (selected: boolean): CSSProperties => ({
  alignItems: 'center',
  background: selected ? 'var(--accent, var(--ui-bg-inset, transparent))' : 'transparent',
  border: '1px solid var(--ui-stroke-secondary, var(--border, transparent))',
  borderRadius: 999,
  color: selected ? 'var(--accent-foreground, var(--foreground, #eee))' : 'var(--muted-foreground, #8a8a8a)',
  cursor: 'pointer',
  display: 'flex',
  fontSize: 12,
  gap: 4,
  padding: '2px 10px'
})

const selectStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--ui-stroke-secondary, rgba(127,127,127,0.35))',
  borderRadius: 'var(--radius-md, 6px)',
  color: 'var(--foreground, #eee)',
  fontSize: 12,
  maxWidth: 300,
  padding: '2px 6px'
}

const hintStyle: CSSProperties = {
  color: 'var(--muted-foreground, #8a8a8a)',
  fontSize: 11,
  lineHeight: 1.5
}

const keycapStyle: CSSProperties = {
  border: '1px solid var(--ui-stroke-secondary, rgba(127,127,127,0.35))',
  borderRadius: 4,
  color: 'var(--muted-foreground, #8a8a8a)',
  flexShrink: 0,
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 10.5,
  padding: '1px 6px',
  userSelect: 'none'
}

const submitStyle: CSSProperties = {
  alignItems: 'center',
  alignSelf: 'flex-end',
  background: 'var(--primary, #1F2328)',
  border: 'none',
  borderRadius: 999,
  color: 'var(--primary-foreground, #fff)',
  cursor: 'pointer',
  display: 'flex',
  flexShrink: 0,
  height: 30,
  justifyContent: 'center',
  width: 30
}

const dismissOnEscape = (dispatch: (event: QuickComposerEvent) => void) => (event: ReactKeyboardEvent) => {
  if (event.key === 'Escape') {
    // Esc folds the window back up without sending (step 16 · T7 keymap).
    event.preventDefault()
    dispatch({ type: 'dismiss' })
  }
}

/**
 * The Quick Capture window — the whole renderer surface of the global-hotkey
 * mini window (step 16 · T7): one input, the four work-mode chips, the target
 * container picker, and a submit that saves a DRAFT instead of firing a
 * prompt, so capturing never interrupts whatever the main window is doing.
 *
 * All behavior rides `quickComposerReducer` (pure, unit-tested): submit sends
 * the trimmed text + mode + target through the shell and asks to hide; an
 * empty submit does neither so a stray Enter can't make the window vanish;
 * Escape and losing focus dismiss without sending. Capture writes are LOCAL
 * (the composer draft stash / the note inbox), so the window stays usable with
 * the gateway down — the pushed connection state only drives a hint.
 *
 * Honesty note (step 16 · T4 seam): the kind data layer does not exist yet, so
 * the picker lists REAL targets only — the new-draft slot and the recent
 * sessions the primary renderer pushes. The mode chip rides the payload as
 * recorded intent; no forensics/CTF container is ever fabricated.
 */
export function QuickCaptureApp() {
  const { t } = useI18n()
  const qc = t.quickCapture
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, dispatch] = useReducer((current: QuickComposerState, event: QuickComposerEvent) => {
    const { send, state: next } = quickComposerReducer(current, event)
    const api = window.fulilianDesktop?.quickEntry

    if (send) {
      api?.submit(send)
    } else if (!next.visible && current.visible) {
      api?.dismiss()
    }

    return next
  }, initialQuickComposerState)
  const [keycap, setKeycap] = useReducer((_current: string, next: string) => next, '')

  // Re-summoned by the chord: the shell reuses the window, so reset the draft
  // and take the keyboard back for a fresh capture. Also adopt the pushes
  // (connection + recent sessions) relayed from the primary renderer.
  useEffect(() => {
    const api = window.fulilianDesktop?.quickEntry

    const offShown = api?.onShown(() => {
      dispatch({ type: 'shown' })
      requestAnimationFrame(() => inputRef.current?.focus())
    })

    const offState = api?.onState(payload => {
      dispatch({
        connected: payload?.connected === true,
        sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
        type: 'state'
      })
    })

    // The keycap shows the LIVE chord (the user can rebind it in Settings), so
    // it is read from the same authoritative source the settings row uses.
    void api
      ?.getSettings()
      .then(settings => setKeycap(shortcutKeycapText(settings.shortcut)))
      .catch(() => setKeycap(''))

    inputRef.current?.focus()

    return () => {
      offShown?.()
      offState?.()
    }
  }, [])

  return (
    <div style={surfaceStyle}>
      <div style={cardStyle}>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          <span style={{ color: 'var(--foreground, #eee)', fontSize: 13, fontWeight: 600, userSelect: 'none' }}>
            {qc.title}
          </span>
          {keycap && <span style={keycapStyle}>{keycap}</span>}
        </div>
        <div style={inputRowStyle}>
          <input
            aria-label={qc.title}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            onBlur={event => {
              // Moving focus to a chip or the picker is not leaving the window.
              if (!event.relatedTarget) {
                dispatch({ type: 'blur' })
              }
            }}
            onChange={event => dispatch({ draft: event.target.value, type: 'edit' })}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                // ↵ submits; the shell hides the window (auto-hide on submit).
                event.preventDefault()
                dispatch({ type: 'submit' })
              } else if (event.key === 'Escape') {
                event.preventDefault()
                dispatch({ type: 'dismiss' })
              }
            }}
            placeholder={qc.placeholder}
            ref={inputRef}
            spellCheck={false}
            style={inputStyle}
            value={state.draft}
          />
        </div>
        <div aria-label={qc.title} role="group" style={chipRowStyle}>
          {QUICK_CAPTURE_MODES.map(mode => {
            const { icon: Icon, labelKey } = MODE_META[mode]

            return (
              <button
                aria-pressed={state.mode === mode}
                key={mode}
                onClick={() => dispatch({ mode, type: 'mode' })}
                onKeyDown={dismissOnEscape(dispatch)}
                style={chipStyle(state.mode === mode)}
                type="button"
              >
                <Icon aria-hidden size={13} stroke={1.8} />
                {qc[labelKey]}
              </button>
            )
          })}
        </div>
        {state.mode !== 'note' && (
          <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
            <label htmlFor="quick-capture-target" style={{ ...hintStyle, flexShrink: 0, userSelect: 'none' }}>
              {qc.targetLabel}
            </label>
            <select
              aria-label={qc.targetLabel}
              id="quick-capture-target"
              onChange={event => dispatch({ target: event.target.value, type: 'target' })}
              onKeyDown={dismissOnEscape(dispatch)}
              style={selectStyle}
              value={state.target}
            >
              <option value={QUICK_TARGET_NEW}>{qc.targetNewDraft}</option>
              {state.sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
            {state.sessions.length === 0 && <span style={hintStyle}>{qc.targetEmpty}</span>}
          </div>
        )}
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          <span style={{ ...hintStyle, flex: 1 }}>
            {state.mode === 'note' ? qc.hintNote : qc.hintDraft}
            {!state.connected && ` ${qc.offlineHint}`}
          </span>
          <button
            aria-label={qc.title}
            onClick={() => dispatch({ type: 'submit' })}
            style={submitStyle}
            type="button"
          >
            <ArrowUp aria-hidden size={16} stroke={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
