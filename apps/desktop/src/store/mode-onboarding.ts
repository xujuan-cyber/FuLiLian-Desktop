import { atom } from 'nanostores'

import type { ContainerKind } from '@/app/chat/sidebar/container-kind'

/**
 * Three-mode first-use guide store (step 16 · T18-1, 方案 §5-T18 / 清单 B4 /
 * DESIGN_PROPOSAL §4.4 安全护栏矩阵).
 *
 * Each guided mode shows its guardrail briefing exactly once per install,
 * gated by a per-mode localStorage marker — same convention as
 * store/onboarding.ts's `CONFIGURED_CACHE_KEY` (one key per mode so adding a
 * mode later never invalidates the others; localStorage failure degrades
 * silently). `project` never guides (方案 §5-T18 明文「编程：不引导」), so only
 * `forensics` / `ctf` are guided.
 *
 * The trigger is RECORDED INTENT, never a fabricated container: `ContainerKind`
 * is still stubbed to `'project'` (container-kind.ts has no kind data layer),
 * so the briefing is requested off the existing `fulilian:new-session-shortcut`
 * event's `detail.kind` — the same payload T6/T7/T8 ride. When the kind column
 * lands the chat surface can call `requestModeOnboarding` directly.
 *
 * 护栏语义只强不弱: this store only gates a copy-only acknowledgement overlay
 * (声明 + 说明 + 确认). It adds NO capability and touches no approval / read-only
 * behaviour owned elsewhere.
 */

/** Modes that carry a first-use briefing. `project` is deliberately excluded. */
export type GuidedMode = 'ctf' | 'forensics'

const MODE_ONBOARDING_CACHE_PREFIX = 'fulilian-desktop-mode-onboarding-v1-'

const cacheKey = (mode: GuidedMode) => `${MODE_ONBOARDING_CACHE_PREFIX}${mode}`

export function isGuidedMode(kind: ContainerKind): kind is GuidedMode {
  return kind === 'forensics' || kind === 'ctf'
}

/** Has the briefing for `mode` already been shown+confirmed on this install?
 *  A read failure (localStorage unavailable / private mode) returns false so
 *  the briefing still shows — never silently skip the guardrail copy. */
export function modeOnboardingSeen(mode: GuidedMode): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(cacheKey(mode)) === '1'
  } catch {
    return false
  }
}

function markModeOnboardingSeen(mode: GuidedMode): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(cacheKey(mode), '1')
  } catch {
    // localStorage unavailable — degrade silently. The in-memory atom still
    // closes the overlay for this session.
  }
}

export type ModeOnboardingState =
  | { status: 'closed' }
  | {
      /** Forensics requires an explicit authorization-scope confirmation before
       *  the briefing can be closed (方案 §5-T18「用户显式确认才可继续/关闭」).
       *  CTF ignores it. */
      acknowledged: boolean
      mode: GuidedMode
      status: 'open'
    }

export const $modeOnboarding = atom<ModeOnboardingState>({ status: 'closed' })

/** Whether the open briefing's confirm affordance is enabled. Forensics must be
 *  explicitly authorized first; CTF's plain acknowledgement always passes. */
export function canConfirmModeOnboarding(state: ModeOnboardingState): boolean {
  if (state.status !== 'open') {
    return false
  }

  return state.mode === 'ctf' || state.acknowledged
}

/** Open the briefing for `kind` when it is a guided mode the user has not seen.
 *  Project kinds and already-seen modes are no-ops. Re-requesting the already
 *  open mode keeps the checkbox state instead of resetting it. */
export function requestModeOnboarding(kind: ContainerKind): void {
  if (!isGuidedMode(kind) || modeOnboardingSeen(kind)) {
    return
  }

  const current = $modeOnboarding.get()

  if (current.status === 'open' && current.mode === kind) {
    return
  }

  $modeOnboarding.set({ acknowledged: false, mode: kind, status: 'open' })
}

/** Toggle the forensics authorization-scope checkbox. */
export function setModeOnboardingAcknowledged(acknowledged: boolean): void {
  const current = $modeOnboarding.get()

  if (current.status === 'open') {
    $modeOnboarding.set({ ...current, acknowledged })
  }
}

/** Confirm/acknowledge the briefing: writes the per-mode marker and closes.
 *  Forensics is blocked until the authorization scope is explicitly confirmed —
 *  there is no silent dismiss path (护栏只强不弱). */
export function confirmModeOnboarding(): void {
  const current = $modeOnboarding.get()

  if (!canConfirmModeOnboarding(current) || current.status !== 'open') {
    return
  }

  markModeOnboardingSeen(current.mode)
  $modeOnboarding.set({ status: 'closed' })
}
