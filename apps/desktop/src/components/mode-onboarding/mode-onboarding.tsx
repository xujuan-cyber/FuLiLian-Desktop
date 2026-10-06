import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import type { ContainerKind } from '@/app/chat/sidebar/container-kind'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import { Fingerprint, Flag, type IconComponent, Lock } from '@/lib/icons'
import {
  $modeOnboarding,
  canConfirmModeOnboarding,
  confirmModeOnboarding,
  requestModeOnboarding,
  setModeOnboardingAcknowledged
} from '@/store/mode-onboarding'

// Step 16 · T18-1 (方案 §5-T18 / DESIGN_PROPOSAL §4.4): the three-mode first-use
// guardrail briefing. Forensics shows an authorization-scope confirmation plus
// the read-only guardrails; CTF shows the flag-vault safety notice; `project`
// never guides. The store owns the per-mode "seen once" marker — this component
// is a pure read of `$modeOnboarding` and adds NO capability (声明 + 说明 + 确认).

/** The renderer event T6/T7/T8 ride to name a new session's work mode (see
 *  store/command-palette-kind.ts). Its `detail.kind` is RECORDED INTENT — the
 *  only live "the user is entering mode X" signal until the kind column lands. */
export const NEW_SESSION_SHORTCUT_EVENT = 'fulilian:new-session-shortcut'

function kindFromShortcutEvent(event: Event): ContainerKind | null {
  const detail = (event as CustomEvent<{ kind?: unknown }>).detail
  const kind = detail?.kind

  return kind === 'forensics' || kind === 'ctf' || kind === 'project' ? kind : null
}

const MODE_ICON: Record<'ctf' | 'forensics', IconComponent> = {
  ctf: Flag,
  forensics: Fingerprint
}

export function ModeOnboardingOverlay() {
  const { t } = useI18n()
  const state = useStore($modeOnboarding)
  const dialogRef = useRef<HTMLDivElement>(null)
  const m = t.modeOnboarding

  // Live trigger: a new-session shortcut carrying a work-mode kind opens that
  // mode's first-use briefing. The listener owns no key handling — it only feeds
  // the store, so the overlay stays a pure function of `$modeOnboarding`.
  useEffect(() => {
    const onShortcut = (event: Event) => {
      const kind = kindFromShortcutEvent(event)

      if (kind) {
        requestModeOnboarding(kind)
      }
    }

    window.addEventListener(NEW_SESSION_SHORTCUT_EVENT, onShortcut)

    return () => window.removeEventListener(NEW_SESSION_SHORTCUT_EVENT, onShortcut)
  }, [])

  // Focus the card when it opens so the confirm button has an anchor; restore
  // focus to the previous holder on close. No Esc/backdrop dismissal — the
  // briefing is closed only through its explicit confirm (forensics: 显式确认).
  useEffect(() => {
    if (state.status !== 'open') {
      return
    }

    const previous = document.activeElement as HTMLElement | null

    dialogRef.current?.focus()

    return () => previous?.focus?.()
  }, [state.status])

  if (state.status !== 'open') {
    return null
  }

  const isForensics = state.mode === 'forensics'
  const Icon = MODE_ICON[state.mode]
  const guardrails = isForensics ? [m.guardReadonly, m.guardWrite, m.guardHash] : [m.vaultMask, m.vaultAudit]

  return createPortal(
    <div className="contents" data-mode={state.mode} data-slot="mode-onboarding">
      {/* Opaque backdrop: click-away deliberately does nothing — the briefing
          closes only via its confirm (see the store's dismissal contract). */}
      <div
        aria-hidden
        className="fixed inset-0 z-(--z-switcher-backdrop) bg-black/28 backdrop-blur-[0.125rem]"
        data-slot="mode-onboarding-backdrop"
      />
      <div
        aria-label={isForensics ? m.forensicsTitle : m.ctfTitle}
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-(--z-switcher) max-h-[min(40rem,88vh)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-(--ui-chat-bubble-background) text-foreground shadow-nous outline-none"
        data-slot="mode-onboarding-card"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex items-start gap-3 border-b border-(--ui-stroke-tertiary) px-5 py-4">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--chrome-action-hover) text-foreground/80">
            <Icon className="size-4" />
          </span>
          <div className="grid min-w-0 gap-1">
            <h2 className="text-sm font-semibold">{isForensics ? m.forensicsTitle : m.ctfTitle}</h2>
            <p className="text-[0.78rem] text-muted-foreground">{isForensics ? m.forensicsIntro : m.ctfIntro}</p>
          </div>
        </header>

        <div className="grid gap-4 px-5 py-4">
          {isForensics && (
            <section className="grid gap-2" data-slot="mode-onboarding-scope">
              <h3 className="text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                {m.scopeHeading}
              </h3>
              {/* The authorization scope is a real gate: the confirm button stays
                  disabled until this checkbox is ticked. */}
              <label
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-(--ui-stroke-tertiary) p-3 text-[0.8rem] leading-relaxed text-foreground/90"
                htmlFor="mode-onboarding-scope-ack"
              >
                <Checkbox
                  checked={state.acknowledged}
                  className="mt-0.5"
                  id="mode-onboarding-scope-ack"
                  onCheckedChange={next => setModeOnboardingAcknowledged(next === true)}
                />
                <span className="min-w-0">{m.scopeStatement}</span>
              </label>
            </section>
          )}

          <section className="grid gap-2" data-slot="mode-onboarding-guardrails">
            <h3 className="flex items-center gap-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              <Lock className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{isForensics ? m.guardHeading : m.vaultHeading}</span>
            </h3>
            <ul className="grid gap-1.5">
              {guardrails.map(item => (
                <li className="flex items-start gap-2 text-[0.8rem] text-foreground/85" key={item}>
                  <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-(--ui-stroke-tertiary) px-5 py-3">
          <p className="min-w-0 truncate text-[0.72rem] text-muted-foreground">
            {isForensics && !state.acknowledged ? m.confirmHint : ''}
          </p>
          <Button
            className="shrink-0"
            disabled={!canConfirmModeOnboarding(state)}
            onClick={() => confirmModeOnboarding()}
            size="sm"
            type="button"
          >
            {m.confirm}
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
