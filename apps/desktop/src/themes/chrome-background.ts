/**
 * The pre-paint chrome background — the single source of truth shared by:
 *
 *   1. `themes/context.tsx`      → runtime: applyTheme() paints the native
 *                                  titlebar and stores the value in the
 *                                  `fulilian-boot-background` localStorage key.
 *   2. `vite.config.ts`          → build time: transformIndexHtml injects the
 *                                  DEFAULT-skin candidates into index.html's
 *                                  pre-paint script and theme-color meta
 *                                  (the `__FULILIAN_PREPAINT_*__` tokens).
 *
 * Everything derives from `themes/presets.ts` (`DEFAULT_SKIN_NAME`), which is
 * therefore the ONLY place a first-launch color can be hand-edited. The old
 * hand-written hexes in index.html drifted silently from the runtime paint and
 * made the very first launch flash the previous skin — there is no hand hex
 * left to drift. `chrome-background.test.ts` asserts the generated candidates
 * equal what `context.tsx`'s runtime derivation paints, which is the
 * anti-drift mechanism: a presets edit flows into the build automatically, and
 * any divergence between the two paths turns the test red.
 *
 * This module must stay importable from node (vite.config.ts): DOM-free, no
 * React, no stores — only the pure `./color` math and the presets data.
 */

import { mix } from './color'
import { BUILTIN_THEMES, DEFAULT_SKIN_NAME } from './presets'
import type { DesktopTheme } from './types'

// styles.css --theme-neutral-chrome — keep in sync. Retuned to the
// `fulilian-workbench` default skin (step 15 · T1): the light endpoint is now
// pure white so the ZCode canvas lands on #FFFFFF, and the dark endpoint is
// Graphite's panel so the frame stays cool instead of apricot's warm #221D18.
// This value lands on the *native* title bar via setTitleBarTheme(), so any
// drift from styles.css shows up as a differently tinted frame around the
// page. Must match the styles.css --theme-neutral-* family.
export const NEUTRAL_CHROME = { light: '#FFFFFF', dark: '#10151C' } as const

/** Mix the painted surface toward the neutral chrome endpoint (dark pulls
 *  harder so the native frame stays readable on near-black skins). */
export const chromeBackground = (background: string, isDark: boolean) =>
  mix(background, NEUTRAL_CHROME[isDark ? 'dark' : 'light'], isDark ? 0.26 : 0.08)

// Light-mode canvas for a seed without `darkColors` — mirrors synthLightColors()
// in context.tsx, which paints those skins on the fixed white surface. Kept in
// step with it by chrome-background.test.ts rather than by a second import, so
// the runtime path stays the only authority on what "light" means.
const SYNTH_LIGHT_BACKGROUND = '#ffffff'

const defaultSeed: DesktopTheme = BUILTIN_THEMES[DEFAULT_SKIN_NAME]

if (!defaultSeed) {
  throw new Error(
    `DEFAULT_SKIN_NAME "${DEFAULT_SKIN_NAME}" has no entry in BUILTIN_THEMES — the pre-paint background cannot be derived.`
  )
}

/** The painted background the runtime derivation uses for the default skin. */
const defaultBackground = (mode: 'light' | 'dark'): string => {
  if (mode === 'dark') {
    return (defaultSeed.darkColors ?? defaultSeed.colors).background
  }

  return defaultSeed.darkColors ? defaultSeed.colors.background : SYNTH_LIGHT_BACKGROUND
}

/**
 * The two first-launch pre-paint candidates for `DEFAULT_SKIN_NAME` — exactly
 * what `chromeBackground()` yields for the surfaces `context.tsx` paints in
 * each mode. index.html's inline script picks between them at runtime via
 * `prefers-color-scheme` (they are two candidates, not a runtime switch).
 */
export const DEFAULT_PREPAINT_BACKGROUND: Record<'light' | 'dark', string> = {
  light: chromeBackground(defaultBackground('light'), false),
  dark: chromeBackground(defaultBackground('dark'), true)
}
