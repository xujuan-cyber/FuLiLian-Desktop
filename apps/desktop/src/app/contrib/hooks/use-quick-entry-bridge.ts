import { useEffect, useRef } from 'react'

import {
  initQuickEntryBridge,
  QUICK_TARGET_CURRENT,
  QUICK_TARGET_NEW,
  QUICK_TARGET_NOTE,
  type QuickEntrySessionOption,
  type QuickEntrySubmitPayload,
  setQuickEntrySubmitHandler
} from '@/store/quick-entry'
import { appendQuickCaptureNote } from '@/store/quick-capture-inbox'
import {
  requestComposerDraftSync,
  stashSessionDraft,
  takeSessionDraft
} from '@/store/composer'
import { $gatewayState, $sessions } from '@/store/session'
import { sessionTileDelegate } from '@/store/session-states'
import { isAuxiliaryWindow } from '@/store/windows'

interface QuickEntryBridgeParams {
  startFreshSessionDraft: () => void
  submitText: (text: string) => Promise<unknown> | unknown
}

// The picker is a capture aid, not a session browser — a handful of recent
// rows is the whole point.
const QUICK_ENTRY_SESSION_OPTIONS = 5

function sessionOptions(): QuickEntrySessionOption[] {
  return $sessions
    .get()
    .filter(session => !session.archived)
    .slice(0, QUICK_ENTRY_SESSION_OPTIONS)
    .map(session => ({
      id: session.id,
      title: session.title?.trim() || session.preview?.trim() || session.id
    }))
}

/**
 * Step 16 · T7 capture semantics: land the text as a DRAFT in the target
 * container's composer slot — the SAME per-session stash the composer itself
 * persists to (`store/composer`), so nothing new is invented and the draft is
 * exactly what the user finds when they open that session.
 *
 * The flush/reload pair is the HUD handoff sequence: whatever the mounted
 * composer is holding goes into the stash first, the captured text is merged
 * on top (never clobbering an existing draft), and the composer repaints if
 * its scope matches the target. Exported so the write path stays unit-testable
 * without mounting the hook.
 */
export function applyQuickCaptureToDraft(payload: { target: string; text: string }): void {
  const scope = payload.target === QUICK_TARGET_NEW ? null : payload.target

  requestComposerDraftSync('flush', 'main')

  const existing = takeSessionDraft(scope)
  const separator = existing.text.trim() ? '\n\n' : ''
  stashSessionDraft(scope, `${existing.text}${separator}${payload.text}`, existing.attachments)

  requestComposerDraftSync('reload', 'main')
}

/**
 * Wires the global-hotkey quick capture window back into the app, both ways:
 *
 * - **Inbound:** a capture payload rides its mode. The note mode lands in the
 *   no-container inbox (`store/quick-capture-inbox`); every other mode writes
 *   the target container's session draft via `applyQuickCaptureToDraft`. The
 *   LEGACY wire shape (no mode — an older quick window) keeps the v1
 *   prompt-send routing: current chat → `submitText`, a picked stored session
 *   → the session-tile delegate (resume + submit in the background), new →
 *   fresh draft + submit. One payload channel, no bespoke RPC.
 * - **Outbound:** gateway connection state + the recent-session list are
 *   pushed to the capture window (via main, which caches the latest push), so
 *   its picker lists real targets and its hint reflects the gateway truth —
 *   capture itself writes locally and never needs the wire.
 *
 * Handlers register ONCE through refs tracking the latest callbacks —
 * re-registering on identity churn leaves a nulled-handler window that can drop
 * a submit (the same bug shape use-pet-bridge guards). Primary window only: a
 * secondary session window must not also claim the global capture channel, or
 * one keystroke would send N prompts.
 */
export function useQuickEntryBridge({ startFreshSessionDraft, submitText }: QuickEntryBridgeParams): void {
  const submitTextRef = useRef(submitText)
  submitTextRef.current = submitText
  const startFreshRef = useRef(startFreshSessionDraft)
  startFreshRef.current = startFreshSessionDraft

  useEffect(() => {
    if (isAuxiliaryWindow()) {
      return
    }

    setQuickEntrySubmitHandler((payload: QuickEntrySubmitPayload) => {
      // v2 capture payload (mode present): write locally, never send a prompt.
      if (payload.mode) {
        if (payload.mode === 'note' || payload.target === QUICK_TARGET_NOTE) {
          appendQuickCaptureNote(payload.text)

          return
        }

        applyQuickCaptureToDraft(payload)

        return
      }

      // Legacy v1 payload: the old fire-a-prompt routing.
      const { target, text } = payload

      if (target === QUICK_TARGET_NEW) {
        // Same as the user clicking New Chat and typing: fresh draft, then the
        // normal submit creates the backend session.
        startFreshRef.current()
        void submitTextRef.current(text)

        return
      }

      if (target !== QUICK_TARGET_CURRENT) {
        // A picked stored session: resume + submit in the background through
        // the session-tile delegate so the primary view stays where it is.
        const delegate = sessionTileDelegate()

        if (delegate) {
          void delegate
            .resumeTile(target)
            .then(runtimeId => delegate.submitToSession(runtimeId, text))
            // A dead/undeliverable target must not swallow the prompt.
            .catch(() => void submitTextRef.current(text))

          return
        }
      }

      void submitTextRef.current(text)
    })

    const dispose = initQuickEntryBridge()

    return () => {
      setQuickEntrySubmitHandler(null)
      dispose()
    }
  }, [])

  // Push gateway truth into the quick window whenever it changes: connection
  // state gates its input; the recent-session list feeds its target picker.
  useEffect(() => {
    if (isAuxiliaryWindow()) {
      return
    }

    const api = window.fulilianDesktop?.quickEntry

    if (!api?.pushState) {
      return
    }

    const push = () => {
      api.pushState({ connected: $gatewayState.get() === 'open', sessions: sessionOptions() })
    }

    push()

    const offGateway = $gatewayState.listen(push)
    const offSessions = $sessions.listen(push)

    return () => {
      offGateway()
      offSessions()
    }
  }, [])
}
