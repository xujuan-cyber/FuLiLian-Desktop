import { describe, expect, it } from 'vitest'

import { apricotTheme } from './presets'
import type { DesktopTerminalPalette, DesktopThemeColors } from './types'

/**
 * WCAG 2.x contrast gate for the `apricot` skin (step 13 · §3 / §7.4).
 *
 * This is the frozen design-token contract expressed as a test: the same maths
 * as 协同编程/留档/step13-orchA-contrast.py, so a future palette edit fails here
 * instead of shipping an unreadable surface. Body text is held to 4.5:1
 * (this palette was designed at body grade throughout); terminal ANSI slots to
 * 3.0:1, the large-text / non-text bar.
 *
 * The expected values are the contract's, written out rather than read back
 * from the theme — a test that asserts `x === x` would pass on any palette.
 */

// ── WCAG relative luminance / contrast ──────────────────────────────────────
const srgb = (channel: number) => {
  const v = channel / 255

  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string) => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))

  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}

const contrast = (a: string, b: string) => {
  const [la, lb] = [luminance(a), luminance(b)]

  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const BODY_AA = 4.5
const LARGE_AA = 3.0

// ── Contract §3.1 / §3.2 — the frozen surfaces ──────────────────────────────
const LIGHT_BG = '#FAF5EA'
const DARK_BG = '#1C1814'

const light: DesktopThemeColors = apricotTheme.colors
const dark: DesktopThemeColors = apricotTheme.darkColors!

const bodyPairs = (
  c: DesktopThemeColors,
  bg: string
): Array<[string, string, string]> => [
  ['foreground / background', c.foreground, bg],
  ['foreground / card', c.foreground, c.card],
  ['foreground / sidebarBackground', c.foreground, c.sidebarBackground!],
  ['mutedForeground / background', c.mutedForeground, bg],
  ['mutedForeground / card', c.mutedForeground, c.card],
  ['primary / background', c.primary, bg],
  ['primary / card', c.primary, c.card],
  ['midground / background', c.midground!, bg],
  ['primaryForeground / primary (solid button)', c.primaryForeground, c.primary],
  ['destructive / background', c.destructive, bg]
]

const ansiPairs = (
  t: DesktopTerminalPalette,
  bg: string
): Array<[string, string, string]> =>
  (
    [
      ['foreground', t.foreground],
      ['black', t.black],
      ['red', t.red],
      ['green', t.green],
      ['yellow', t.yellow],
      ['blue', t.blue],
      ['magenta', t.magenta],
      ['cyan', t.cyan],
      ['white', t.white],
      ['brightBlack', t.brightBlack],
      ['brightRed', t.brightRed],
      ['brightGreen', t.brightGreen],
      ['brightYellow', t.brightYellow],
      ['brightBlue', t.brightBlue],
      ['brightMagenta', t.brightMagenta],
      ['brightCyan', t.brightCyan],
      ['brightWhite', t.brightWhite]
    ] as Array<[string, string | undefined]>
  ).filter((e): e is [string, string] => typeof e[1] === 'string')
    .map(([k, v]) => [k, v, bg])

describe('apricot · light palette meets AA (§3.1)', () => {
  it.each(bodyPairs(light, LIGHT_BG))('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(BODY_AA)
  })
})

describe('apricot · dark palette meets AA (§3.2)', () => {
  it.each(bodyPairs(dark, DARK_BG))('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(BODY_AA)
  })
})

// §3.3 — a cool ANSI set against a warm page is the loudest possible break, so
// apricot ships its own. Every slot must clear the large-text bar.
describe('apricot · terminal ANSI clears 3.0:1 on the theme background (§3.3)', () => {
  it.each(ansiPairs(apricotTheme.terminal!, LIGHT_BG))('light %s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(LARGE_AA)
  })

  it.each(ansiPairs(apricotTheme.darkTerminal!, DARK_BG))('dark %s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(LARGE_AA)
  })
})

// §3.1 — these two are the contract's deliberate overrules of the source
// proposal, both because the proposed hex failed measurement. Pinned so a
// future "restore the proposal" edit is caught rather than merged.
describe('apricot · the two measured overrules stay overruled (§3.1)', () => {
  it('primary is the deepened #9A6528, not the proposal’s #B07A3C (3.39 — under AA)', () => {
    expect(apricotTheme.colors.primary).toBe('#9A6528')
    expect(contrast('#B07A3C', LIGHT_BG)).toBeLessThan(BODY_AA)
    expect(contrast(apricotTheme.colors.primary, LIGHT_BG)).toBeGreaterThanOrEqual(BODY_AA)
  })

  it('border is the strengthened #D8C7AC, not the proposal’s #E3D6C2 (1.32 — invisible)', () => {
    expect(apricotTheme.colors.border).toBe('#D8C7AC')
    expect(contrast('#E3D6C2', LIGHT_BG)).toBeLessThan(1.5)
    expect(contrast(apricotTheme.colors.border, LIGHT_BG)).toBeGreaterThanOrEqual(1.5)
  })
})
