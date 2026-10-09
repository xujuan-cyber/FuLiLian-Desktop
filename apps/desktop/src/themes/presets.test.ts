import { describe, expect, it } from 'vitest'

import {
  BUILTIN_THEME_LIST,
  BUILTIN_THEMES,
  DEFAULT_SKIN_NAME,
  DEFAULT_TYPOGRAPHY,
  EMOJI_FALLBACK,
  FULILIAN_MONO,
  FULILIAN_SANS,
  githubTheme,
  nousAltTheme,
  nousTheme,
  workbenchTheme
} from './presets'

// #40364: none of the UI text/mono fonts carry emoji glyphs, so every font
// stack must end with a color-emoji fallback or emoji render as tofu on
// platforms whose default font lacks them (e.g. Linux).
describe('theme typography emoji fallback (#40364)', () => {
  const stacks: Array<[string, string]> = [
    ['DEFAULT_TYPOGRAPHY.fontSans', DEFAULT_TYPOGRAPHY.fontSans],
    ['DEFAULT_TYPOGRAPHY.fontMono', DEFAULT_TYPOGRAPHY.fontMono],
    // A theme may override only fontMono (fontSans then falls back to the
    // default, which already carries the emoji stack), so skip undefined.
    ...BUILTIN_THEME_LIST.flatMap(theme =>
      (
        [
          [`${theme.name}.fontSans`, theme.typography?.fontSans],
          [`${theme.name}.fontMono`, theme.typography?.fontMono]
        ] as Array<[string, string | undefined]>
      ).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  ]

  it.each(stacks)('%s includes a color-emoji font', (_label, stack) => {
    expect(stack).toMatch(/Apple Color Emoji|Segoe UI Emoji|Noto Color Emoji|(^|,\s*)emoji\b/)
  })

  it('EMOJI_FALLBACK lists the major platform emoji fonts', () => {
    expect(EMOJI_FALLBACK).toContain('Apple Color Emoji')
    expect(EMOJI_FALLBACK).toContain('Segoe UI Emoji')
    expect(EMOJI_FALLBACK).toContain('Noto Color Emoji')
  })
})

// The pre-GitHub Nous palette stays available as nous-alt, and `nous` itself
// is still a registered skin — since step 13 (U2) it stopped holding the
// default, which moved apricot → github's white → `fulilian-workbench`
// (step 15 · T1).
describe('nous-alt is the retired Nous, and no longer the default skin', () => {
  it('is registered under its own name while another skin holds the default', () => {
    expect(DEFAULT_SKIN_NAME).not.toBe('nous-alt')
    expect(BUILTIN_THEMES['nous-alt']).toBe(nousAltTheme)
    expect(BUILTIN_THEMES.nous).not.toBe(nousAltTheme)
    expect(nousAltTheme.darkColors?.background).toBe('#0D2F86')
    expect(BUILTIN_THEMES.nous.darkColors?.background).not.toBe(nousAltTheme.darkColors?.background)
  })
})

// DEFAULT_SKIN_NAME has to name a registered theme: it is the fallback for
// retired persisted skins, and user-themes.test.ts asserts
// resolveTheme(DEFAULT_SKIN_NAME) === BUILTIN_THEMES[DEFAULT_SKIN_NAME].
//
// step 15 · T1 flipped the default off `github` onto the first-party
// `fulilian-workbench`. The palette assertions below are the frozen contract
// for that skin (DESIGN_PROPOSAL §3.1 / §3.2), written out rather than read
// back so a silent palette edit fails here instead of shipping.
describe('fulilian-workbench is the shipped default skin', () => {
  it('is registered under DEFAULT_SKIN_NAME and leads the gallery order', () => {
    expect(DEFAULT_SKIN_NAME).toBe('fulilian-workbench')
    expect(BUILTIN_THEMES[DEFAULT_SKIN_NAME]).toBe(workbenchTheme)
    expect(BUILTIN_THEMES['fulilian-workbench']?.label).toBe('Fulilian Workbench')
    expect(BUILTIN_THEME_LIST[0]).toBe(workbenchTheme)
  })

  it('paints the Workbench Light surfaces', () => {
    expect(workbenchTheme.colors.background).toBe('#FFFFFF')
    expect(workbenchTheme.colors.sidebarBackground).toBe('#F7F7F8')
    expect(workbenchTheme.colors.foreground).toBe('#1F2328')
  })

  it('ships the Graphite dark plus its own terminal palettes', () => {
    expect(workbenchTheme.darkColors?.background).toBe('#0D1117')
    expect(workbenchTheme.terminal?.foreground).toBe('#1F2328')
    expect(workbenchTheme.darkTerminal?.foreground).toBe('#E6EAEE')
  })

  // The four optional slots added in step 15 · T1. Asserting them here is what
  // gives the "legacy skins fall back to the stylesheet constant" contract
  // teeth — the default skin has to actually declare them.
  it('declares the four optional semantic slots in both appearances', () => {
    const light = workbenchTheme.colors
    const dark = workbenchTheme.darkColors

    expect(light.accentBright).toBe('#EA620E')
    expect(light.info).toBe('#0969DA')
    expect(light.success).toBe('#1A7F37')
    expect(light.warning).toBe('#9A6700')
    expect(dark?.accentBright).toBe('#F2760F')
    expect(dark?.info).toBe('#4493F8')
    expect(dark?.success).toBe('#3FB950')
    expect(dark?.warning).toBe('#D29922')
  })

  // Flipping the default must not retire github — it stays selectable on its
  // own terms.
  it('leaves github registered as a selectable skin', () => {
    expect(BUILTIN_THEMES.github).toBe(githubTheme)
    expect(BUILTIN_THEMES.github?.label).toBe('GitHub')
  })

  // §5.3: apricot deliberately declares no typography. context.tsx merges
  // nousTheme.typography as a middle layer, so a third copy of the chain here
  // would be a drift risk with no upside. Workbench follows the same rule.
  it('declares no typography override, inheriting the merged chain', () => {
    expect(BUILTIN_THEMES.apricot.typography).toBeUndefined()
    expect(BUILTIN_THEMES['fulilian-workbench'].typography).toBeUndefined()
  })

  it('carries the Fulilian chain in both required places, from one constant', () => {
    expect(DEFAULT_TYPOGRAPHY.fontSans).toContain('"Fulilian Sans"')
    expect(DEFAULT_TYPOGRAPHY.fontMono).toContain('"Fulilian Mono"')
    expect(nousTheme.typography?.fontSans).toBe(FULILIAN_SANS)
    expect(nousTheme.typography?.fontMono).toBe(FULILIAN_MONO)
    // The drift guard: nousTheme must reference the same constant the default
    // uses, not a re-typed literal that could silently diverge.
    expect(nousTheme.typography?.fontSans).toBe(DEFAULT_TYPOGRAPHY.fontSans)
    expect(nousTheme.typography?.fontMono).toBe(DEFAULT_TYPOGRAPHY.fontMono)
  })
})

// step 13 v1.1 (裁决 §5.3 T1). `context.tsx:204` spreads `theme.typography`
// LAST, so any skin shipping its own `fontSans` silently outranks the shared
// chain — which is exactly how githubTheme and nousAltTheme were reverting
// their UI to the system face. Every skin that declares typography at all must
// therefore point at the same two constants.
//
// Skins deliberately out of scope (own mono, intentional — backlog, do not
// "fix" without a ruling): midnightTheme, emberTheme, monoTheme, slateTheme.
describe('skins declaring typography use the shared Fulilian chain (step 13 v1.1)', () => {
  it.each([
    ['github', githubTheme],
    ['nous-alt', nousAltTheme]
  ])('%s: fontSans / fontMono come from the shared constants', (_name, theme) => {
    expect(theme.typography?.fontSans).toBe(FULILIAN_SANS)
    expect(theme.typography?.fontMono).toBe(FULILIAN_MONO)
    // Also read back through the registry, so this catches a preset/registry
    // mismatch and not just the preset object itself.
    expect(BUILTIN_THEMES[theme.name]?.typography?.fontSans).toBe(FULILIAN_SANS)
    expect(BUILTIN_THEMES[theme.name]?.typography?.fontMono).toBe(FULILIAN_MONO)
  })

  // The v1.1 patch touches two font lines per theme and nothing else, so pin
  // the untouched half too: these skins still load Courier Prime over the
  // network by design (pit-N2 applies to the *new* chain, not to this legacy
  // one). A future font cleanup must not silently drop it.
  const COURIER_PRIME_URL =
    'https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap'

  it.each([
    ['github', githubTheme],
    ['nous-alt', nousAltTheme],
    ['nous', nousTheme]
  ])('%s: keeps its existing Google Fonts fontUrl', (_name, theme) => {
    expect(theme.typography?.fontUrl).toBe(COURIER_PRIME_URL)
  })
})
