/**
 * Window translucency (see-through window).
 *
 * One lever, 0–100. Two modes decide HOW the desktop shows through — see
 * `@fulilian/shared/translucency`, which owns the mapping both this store and the
 * main process read.
 *
 * Settings are kept per light/dark appearance: a tint that reads as a whisper
 * over a dark palette is a milky sheet over a light one. The book of settings
 * is the persisted unit (`TranslucencyBook`); `$translucency` publishes the
 * RESOLVED state for the appearance currently painted, so every consumer —
 * the CSS field surfaces, the main process, the HUD — keeps reading one flat
 * state and never has to know appearances were split.
 *
 * The renderer owns the value and mirrors the resolved state to the main
 * process over IPC. Glass additionally needs page-level work, which lives
 * here: the field surfaces have to get out of the way for the platform
 * material underneath the web contents to read (see the `[data-fulilian-glass]`
 * block in styles.css).
 */

import {
  type Appearance,
  clampIntensity,
  defaultTranslucencyValues,
  GLASS_MATERIALS,
  GLASS_SCOPES,
  type GlassMaterial,
  glassMaterialForPicker,
  glassMaterialsFor,
  type GlassScope,
  glassSurfaceKeep,
  normalizeBook,
  normalizeMaterial,
  normalizeScope,
  resolveTranslucency,
  setTranslucencyValues,
  TRANSLUCENCY_MAX,
  TRANSLUCENCY_MIN,
  TRANSLUCENCY_STEP,
  type TranslucencyBook,
  type TranslucencyMode,
  type TranslucencyState,
  type TranslucencyValues
} from '@fulilian/shared/translucency'
import { atom, computed } from 'nanostores'

import { isMacPlatform, isWindowsPlatform } from '@/lib/platform'
import { readJson, writeJson } from '@/lib/storage'

export {
  defaultTranslucencyValues,
  GLASS_MATERIALS,
  GLASS_SCOPES,
  glassMaterialForPicker,
  glassMaterialsFor,
  TRANSLUCENCY_MAX,
  TRANSLUCENCY_MIN,
  TRANSLUCENCY_STEP
}

export type { Appearance }

/**
 * Glass needs a native window material. Electron is authoritative (preload
 * sets `fulilianDesktop.glassSupported` from `os.release()` so Win10 cannot
 * sneak through). Tests and non-Electron shells fall back to a UA sniff —
 * Mac or Windows — which is why this file pins `navigator.platform` before
 * import.
 */
export const GLASS_SUPPORTED =
  typeof window !== 'undefined' && typeof window.fulilianDesktop?.glassSupported === 'boolean'
    ? window.fulilianDesktop.glassSupported
    : isMacPlatform() || isWindowsPlatform()

/**
 * Whether the setting is worth showing at all. Linux has neither half —
 * `setOpacity` is a documented no-op and there is no native material — so
 * Settings hides the row rather than offering a lever that does nothing.
 */
export const TRANSLUCENCY_SUPPORTED =
  typeof window !== 'undefined' && typeof window.fulilianDesktop?.translucencySupported === 'boolean'
    ? window.fulilianDesktop.translucencySupported
    : isMacPlatform() || isWindowsPlatform()

/** Windows collapses the frost ladder — see `glassMaterialsFor`. */
export const GLASS_IS_WINDOWS = GLASS_SUPPORTED && !isMacPlatform()

// v1 held a flat state (one setting for both appearances); v2 is the book.
// Reading v1 as the seed is what carries an already-tuned window across the
// upgrade — normalizeBook lands those values in `base`, which both appearances
// inherit until one of them is edited.
const KEY = 'fulilian.desktop.translucency.v2'
const LEGACY_KEY = 'fulilian.desktop.translucency.v1'

const read = (): TranslucencyBook =>
  normalizeBook(readJson<unknown>(KEY) ?? readJson<unknown>(LEGACY_KEY), GLASS_SUPPORTED)

/** The persisted book. Settings edits it; everything else reads `$translucency`. */
export const $translucencyBook = atom<TranslucencyBook>(
  typeof window === 'undefined' ? normalizeBook(null, false) : read()
)

/**
 * Which palette is on screen. Published by the theme provider from its
 * RENDERED mode (background luminance), not the light/dark preference — a
 * skin that keeps a bright surface in "dark" wants light's tint.
 */
export const $appearance = atom<Appearance>('dark')

export function setAppearance(appearance: Appearance): void {
  if ($appearance.get() !== appearance) {
    $appearance.set(appearance)
  }
}

/** The resolved state for the painted appearance — the shape every consumer reads. */
export const $translucency = computed([$translucencyBook, $appearance], (book, appearance) =>
  resolveTranslucency(book, appearance, isWindowsPlatform())
)

/** Write an edit against the appearance being painted. */
const edit = (patch: Partial<TranslucencyValues>): void => {
  $translucencyBook.set(setTranslucencyValues($translucencyBook.get(), $appearance.get(), patch))
}

export function setTranslucency(intensity: number): void {
  edit({ intensity: clampIntensity(intensity) })
}

export function setTranslucencyFade(fade: number): void {
  edit({ fade: clampIntensity(fade) })
}

export function setTranslucencyMode(mode: TranslucencyMode): void {
  $translucencyBook.set({
    ...$translucencyBook.get(),
    mode: mode === 'glass' && GLASS_SUPPORTED ? 'glass' : 'clear'
  })
}

export function setTranslucencyMaterial(material: GlassMaterial): void {
  edit({ material: normalizeMaterial(material) })
}

export function setTranslucencyScope(scope: GlassScope): void {
  edit({ scope: normalizeScope(scope) })
}

// Glass thins surfaces only in real chat windows (the primary window and
// secondary session windows). The HUD, pet overlay, quick entry and wake
// indicator are transparent special-purpose windows that manage their own
// backgrounds — a page-surface rewrite there would fight them.
const CHAT_WINDOW_KINDS = new Set([null, 'secondary', 'browser'])

export const isChatWindow = (search = typeof window === 'undefined' ? '' : window.location.search): boolean => {
  try {
    return CHAT_WINDOW_KINDS.has(new URLSearchParams(search).get('win'))
  } catch {
    return false
  }
}

/* Sidebar scope needs the rail's visual edge published on :root so <body>
   can split its paint there (glass left of the seam, opaque chrome right of
   it — the Finder shape). The rail is an in-flow div whose WIDTH animates
   (components/ui/sidebar.tsx, collapsible='none' branch), so a
   ResizeObserver sees every collapse/expand frame; a window resize listener
   and a re-measure on every store sync cover the rest. RTL flips which side
   the seam is measured from; styles.css picks the matching gradient
   direction off html[dir]. */
let railObserver: null | ResizeObserver = null
let railTarget: Element | null = null
let railTrackingOn = false

const measureRailEdge = (): void => {
  const root = document.documentElement
  const rail = document.querySelector('[data-slot="sidebar"]')

  if (rail !== railTarget) {
    if (railObserver && railTarget) {
      railObserver.unobserve(railTarget)
    }

    railTarget = rail

    if (railObserver && rail) {
      railObserver.observe(rail)
    }
  }

  if (!rail) {
    // No rail in this window (e.g. a pane-only layout): the seam sits at the
    // window edge and the whole field stays opaque — glass simply waits for
    // a rail to exist.
    root.style.setProperty('--glass-rail-edge', '0px')

    return
  }

  const rect = rail.getBoundingClientRect()
  const rtl = getComputedStyle(root).direction === 'rtl'
  const edge = rtl ? window.innerWidth - rect.left : rect.right

  root.style.setProperty('--glass-rail-edge', `${Math.max(0, Math.round(edge))}px`)
}

const startRailTracking = (): void => {
  if (railTrackingOn) {
    // Already tracking: the ResizeObserver on the rail and the window resize
    // listener own every geometry change from here. Re-measuring per store
    // sync would force a layout read (getBoundingClientRect) right after the
    // tint's style write, once per slider tick — write/read thrash on the
    // drag's hot path for a seam that isn't moving. Two exceptions re-acquire:
    // a rail we haven't FOUND yet (scope enabled before the sidebar mounted),
    // and a rail that REMOUNTED (layout reset swaps the element) — the
    // observer sits on the detached node and never fires again. isConnected
    // is a flag read, so the settled hot path stays a single boolean check.
    if (!railTarget || !railTarget.isConnected) {
      measureRailEdge()
    }

    return
  }

  railTrackingOn = true

  if (typeof ResizeObserver !== 'undefined' && !railObserver) {
    railObserver = new ResizeObserver(() => measureRailEdge())
  }

  window.addEventListener('resize', measureRailEdge)
  measureRailEdge()
}

const stopRailTracking = (): void => {
  if (!railTrackingOn) {
    return
  }

  railTrackingOn = false

  if (railObserver && railTarget) {
    railObserver.unobserve(railTarget)
  }

  railTarget = null
  window.removeEventListener('resize', measureRailEdge)
  document.documentElement.style.removeProperty('--glass-rail-edge')
}

/* Peek: while the user is actively adjusting translucency from Settings, the
   overlay they stand in covers the very effect they're tuning — the scrim
   plus a deliberately near-opaque card ([data-glass-raised]). A peek ghosts
   the whole overlay layer so the live window IS the preview (see the
   [data-fulilian-translucency-peek] rules in styles.css). A counter rather
   than a boolean: a held slider drag and a timed pulse from a picker click
   can overlap.

   A counter can also be left stranded: a pointer held on the slider when its
   overlay unmounts never delivers the pointerup that releases it, and while
   it sits above zero every LATER settings overlay falls through to the
   desktop at 8% opacity (the [data-fulilian-translucency-peek] rule). Three
   backstops bound that: a watchdog no hold may outlive, a visibility/blur
   drop, and a pairing check on release. Every one of them records. */
const PEEK_ATTR = 'data-fulilian-translucency-peek'

/**
 * Ceiling on how long one peek session — the span from the first hold of a
 * run to the last release — may keep the ghost on. The only BOUNDED legal
 * peek is the 900ms pulse (`PEEK_PULSE_MS`); a held drag is user-paced, so
 * this is not a UX limit but the backstop for a hold whose release never
 * arrives. 60s is ~66x the longest bounded peek and beyond any continuous
 * drag, so no normal interaction meets it, while a stranded counter heals
 * itself instead of ghosting every later overlay for the life of the window.
 * Exported so a test can drive the ceiling with a fake clock.
 */
export const PEEK_MAX_HOLD_MS = 60_000

/** The one-shot pulse length for frost / area / mode clicks and key steps. */
const PEEK_PULSE_MS = 900

export const $translucencyPeek = atom<number>(0)

/** Pulses still in flight; settling them lets a late timer exit quietly. */
const outstandingPulses = new Set<symbol>()

let peekWatchdog: null | number = null

const warnPeek = (reason: string, detail: Record<string, unknown> = {}): void => {
  console.warn(`[translucency] peek ${reason}`, detail)
}

/**
 * Force the counter to the floor and drop the pulses a stranded hold would
 * otherwise release a second time. Records when it actually drops a hold —
 * these backstops exist because the wedge is silent, so they must not be.
 */
const dropPeekHolds = (reason: string, detail: Record<string, unknown> = {}): void => {
  const held = $translucencyPeek.get()

  if (held > 0) {
    warnPeek(reason, { held, ...detail })
  }

  outstandingPulses.clear()
  $translucencyPeek.set(0)
}

const disarmPeekWatchdog = (): void => {
  if (peekWatchdog === null) {
    return
  }

  if (typeof window !== 'undefined') {
    window.clearTimeout(peekWatchdog)
  }

  peekWatchdog = null
}

/**
 * Armed once per session — on the first hold — and NOT extended by later
 * overlapping holds: the failure it guards is a counter that never comes back
 * down, so a stuck session has no later holds to extend it with.
 */
const armPeekWatchdog = (): void => {
  if (peekWatchdog !== null || typeof window === 'undefined') {
    return
  }

  peekWatchdog = window.setTimeout(() => {
    peekWatchdog = null

    if ($translucencyPeek.get() > 0) {
      dropPeekHolds('hold exceeded its ceiling — no release arrived', { ceilingMs: PEEK_MAX_HOLD_MS })
    }
  }, PEEK_MAX_HOLD_MS)
}

const PEEK_GUARD = Symbol.for('fulilian.translucency.peek-guards')

interface PeekGuards {
  onBlur: () => void
  onVisibility: () => void
}

const peekGuardHost = globalThis as unknown as { [PEEK_GUARD]?: PeekGuards }

/**
 * Drop the ghost when the page is hidden or the window loses focus: a hold
 * whose release can't reach an off-screen element must not survive. Installed
 * EXACTLY once — a repeat install (HMR, a second import) swaps the handlers
 * rather than stacking a second pair, and the registry lives on globalThis so
 * it spans module re-evaluations. Exported so a test can prove that.
 */
export function installTranslucencyPeekGuards(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const previous = peekGuardHost[PEEK_GUARD]

  if (previous) {
    document.removeEventListener('visibilitychange', previous.onVisibility)
    window.removeEventListener('blur', previous.onBlur)
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      dropPeekHolds('page became hidden')
    }
  }

  const onBlur = (): void => dropPeekHolds('window lost focus')

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('blur', onBlur)
  peekGuardHost[PEEK_GUARD] = { onBlur, onVisibility }
}

/**
 * Rate-limits the imbalance record to one line per episode. The slider fires
 * three release paths for a single hold — pointerup, then lostpointercapture
 * and blur — so warning on every redundant release would cry wolf on the
 * happy path. The latch is cleared by the next acquire (and by a reset), so a
 * genuinely repeated imbalance still surfaces.
 */
let peekImbalanceRecorded = false

export function beginTranslucencyPeek(): void {
  peekImbalanceRecorded = false
  $translucencyPeek.set($translucencyPeek.get() + 1)
}

/**
 * Acquire/release must pair. A release that finds no hold to take has nothing
 * to decrement, so the bookkeeping has drifted — never silent, because the
 * wedge this file guards against is silent.
 */
export function endTranslucencyPeek(): void {
  const current = $translucencyPeek.get()

  if (Number.isInteger(current) && current > 0) {
    $translucencyPeek.set(current - 1)

    return
  }

  if (current !== 0) {
    // Corrupt: negative, fractional or NaN. No legitimate release can leave
    // the counter there, so it is always recorded and forced back to the
    // floor — a value like that would otherwise strand the ghost on.
    warnPeek('counter left the floor — normalising', { count: current })
    $translucencyPeek.set(0)

    return
  }

  // A release with no hold at all. The zero floor is the app's own designed
  // no-op, but the imbalance is still real and is recorded once per episode.
  if (peekImbalanceRecorded) {
    return
  }

  peekImbalanceRecorded = true
  warnPeek('release without a matching hold', { count: current })
}

/**
 * Drop every outstanding hold at once. The settings surface calls this on
 * unmount: a pointer held on the slider when the overlay closes (Escape
 * mid-drag) never delivers its pointerup to the unmounted element, and a
 * counter stuck above zero would leave the peek attribute on <html> —
 * rendering the NEXT settings overlay ghosted at 8% opacity. Settling the
 * pulse tokens makes an outstanding pulse timer exit without releasing a hold
 * that is already gone.
 */
export function resetTranslucencyPeek(): void {
  outstandingPulses.clear()
  peekImbalanceRecorded = false
  $translucencyPeek.set(0)
}

/**
 * Timed peek for one-shot changes (frost / area / mode clicks, keyboard
 * slider steps): long enough to read the effect, short enough to hand the
 * settings back without feeling stuck. Each pulse carries a token, so a reset
 * or watchdog that already dropped its hold turns the pulse's later timer
 * into a no-op — a stale timer can neither resurrect the attribute nor trip
 * the pairing check.
 */
export function pulseTranslucencyPeek(ms = PEEK_PULSE_MS): void {
  beginTranslucencyPeek()

  if (typeof window === 'undefined') {
    endTranslucencyPeek()

    return
  }

  const token = Symbol('translucency-peek-pulse')
  outstandingPulses.add(token)

  window.setTimeout(() => {
    if (!outstandingPulses.delete(token)) {
      return
    }

    endTranslucencyPeek()
  }, ms)
}

const applyGlassSurfaces = ({ intensity, mode, scope }: TranslucencyState): void => {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  // Is the user's Glass setting live at all — the same answer in every window.
  const glassLive = mode === 'glass' && intensity > 0 && GLASS_SUPPORTED
  // ...and may THIS window's field surfaces be rewritten for it. Only real
  // chat windows: the HUD, pet overlay, quick entry and wake indicator are
  // transparent windows that own their backgrounds, and the surface rewrite
  // would fight them. The HUD still wants the first answer, because its band
  // paints the app's field mix from `--translucency-glass-keep` and its native
  // frost is gated on the setting being on (see the `[data-hud-glass]` rules
  // and hudFrostFor) — which is why these are two flags and not one.
  const glassOn = glassLive && isChatWindow()
  // Clear mode fades the whole window uniformly, so overlay text and the
  // covered transcript blend; styles.css strengthens the overlay scrim while
  // this attribute is present. Native opacity applies in every window kind, so
  // no chat-window gate.
  const clearOn = mode === 'clear' && intensity > 0

  root.toggleAttribute('data-fulilian-glass-on', glassLive)
  root.toggleAttribute('data-fulilian-glass', glassOn)
  root.toggleAttribute('data-fulilian-clear', clearOn)

  if (glassLive) {
    root.style.setProperty('--translucency-glass-keep', `${glassSurfaceKeep(intensity)}%`)
  } else {
    root.style.removeProperty('--translucency-glass-keep')
  }

  if (glassOn) {
    root.setAttribute('data-fulilian-glass-scope', scope)
  } else {
    root.removeAttribute('data-fulilian-glass-scope')
  }

  if (glassOn && scope === 'sidebar') {
    startRailTracking()
  } else {
    stopRailTracking()
  }
}

if (typeof window !== 'undefined') {
  // The intensity slider fires ~100 updates per drag. The expensive per-tick
  // work is the synchronous localStorage.setItem — so THAT is debounced.
  // Everything the user can see must track the hand: the page paint (glass is
  // rendered here) AND the IPC send, because in clear mode the effect is the
  // native window opacity and main can only move it when told. Main diffs the
  // state and debounces its own disk write, so per-tick sends cost one
  // setOpacity in clear mode and nothing at all under glass.
  let storageTimer: null | number = null

  const persist = () => {
    storageTimer = null
    writeJson(KEY, $translucencyBook.get())
  }

  // The RESOLVED state drives paint and IPC — main only ever cares about the
  // appearance on screen. Switching light/dark therefore re-sends, which is
  // exactly right: the window's tint and native opacity change with it.
  $translucency.subscribe(state => {
    applyGlassSurfaces(state)
    window.fulilianDesktop?.setTranslucency?.(state)
  })

  // Persistence follows the BOOK, so an appearance switch (which changes the
  // resolved state but not the settings) never schedules a pointless write.
  $translucencyBook.subscribe(() => {
    if (storageTimer !== null) {
      window.clearTimeout(storageTimer)
    }

    storageTimer = window.setTimeout(persist, 120)
  })

  // A window closing mid-drag must not lose the setting.
  window.addEventListener('pagehide', () => {
    if (storageTimer !== null) {
      window.clearTimeout(storageTimer)
      persist()
    }
  })

  // Cross-window sync (same pattern as themes/context and store/session):
  // under glass an intensity change is painted entirely by each renderer —
  // main deliberately touches nothing native — so a second chat window only
  // learns about it through the storage event its sibling's debounced write
  // fires. Without this, window B's tint freezes until reload.
  window.addEventListener('storage', event => {
    if (event.key !== KEY) {
      return
    }

    const next = read()

    if (JSON.stringify(next) !== JSON.stringify($translucencyBook.get())) {
      $translucencyBook.set(next)
    }
  })

  $translucencyPeek.subscribe(count => {
    if (typeof document === 'undefined') {
      return
    }

    document.documentElement.toggleAttribute(PEEK_ATTR, count > 0)

    // Bound the session: arm the ceiling on the first hold, drop it the moment
    // the counter returns to the floor.
    if (count > 0) {
      armPeekWatchdog()
    } else {
      disarmPeekWatchdog()
    }
  })

  // Hidden page / blurred window: a hold whose release can no longer arrive
  // must not survive off-screen. Idempotent — see installTranslucencyPeekGuards.
  installTranslucencyPeekGuards()
}
