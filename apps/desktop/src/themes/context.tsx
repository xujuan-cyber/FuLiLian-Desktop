/**
 * Desktop theme context.
 *
 * Applies the active theme as CSS custom properties on :root so every
 * Tailwind utility that references a color or font-family token picks up
 * the change automatically.
 *
 * Mode (light/dark/system) controls brightness; skin controls accent.
 * The two are persisted independently. Shift+X toggles light/dark.
 */

import { useStore } from '@nanostores/react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { $registryVersion } from '@/contrib/registry'
import { matchesQuery, useMediaQuery } from '@/hooks/use-media-query'
import { persistString, persistStringRecord, storedString, storedStringRecord } from '@/lib/storage'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { setAppearance } from '@/store/translucency'

import { $accentOverride } from './accent-override'
import { $backendThemes, $pendingSkinApply } from './backend-sync'
// The chrome-background math (native titlebar / pre-paint color) lives in
// ./chrome-background — the module vite.config.ts also imports to generate
// index.html's pre-paint values, so runtime and build share one implementation.
import { chromeBackground } from './chrome-background'
import { ensureContrast, harmonize, hexToRgb, mix, readableOn } from './color'
import { BUILTIN_THEME_LIST, DEFAULT_SKIN_NAME, DEFAULT_TYPOGRAPHY, nousTheme } from './presets'
import { retintTheme } from './retint'
import type { DesktopTheme, DesktopThemeColors } from './types'
import { $userThemes, listAllThemes, resolveTheme } from './user-themes'

// Legacy global skin (pre per-profile themes). Still the inheritance fallback
// for any profile without its own assignment, so single-profile users and old
// installs are unaffected.
const SKIN_KEY = 'fulilian-desktop-theme-v2'
const MODE_KEY = 'fulilian-desktop-mode-v1'
// Per-profile skin + light/dark mode assignments: { [profileKey]: value }. A
// profile inherits the global default until it's given its own appearance.
const PROFILE_SKINS_KEY = 'fulilian-desktop-profile-themes-v1'
const PROFILE_MODES_KEY = 'fulilian-desktop-profile-modes-v1'
// R10 typography tiers — base text scale and text ink — persisted per profile
// with the same profilePref shape as skin/mode. Deliberately NOT read by any
// skin preset or `applyTheme` seed chain: a skin switch can never clear these
// (A7), and the boot block applies them from storage before first paint.
const TEXT_SCALE_KEY = 'fulilian-desktop-text-scale-v1'
const PROFILE_TEXT_SCALE_KEY = 'fulilian-desktop-profile-text-scale-v1'
const TEXT_INK_KEY = 'fulilian-desktop-text-ink-v1'
const PROFILE_TEXT_INK_KEY = 'fulilian-desktop-profile-text-ink-v1'
// Last active profile, recorded so the boot-time paint can pick that profile's
// theme before the gateway reports which profile actually launched.
const LAST_PROFILE_KEY = 'fulilian-desktop-active-profile-v1'
// Skins that no longer exist. A profile still pointing at one falls back to
// DEFAULT_SKIN_NAME rather than painting a name nothing resolves.
const RETIRED_SKINS = new Set(['nous-light', 'default', 'gold'])

export type ThemeMode = 'light' | 'dark' | 'system'

/** Base text-size tiers (R10): a multiplier over the conversation/UI font-size
 *  tokens via `--ui-text-scale`. Distinct from the OS-level zoom row, which
 *  rescales EVERYTHING including the titlebar; these move type only. */
export type TextScaleTier = 'compact' | 'default' | 'large' | 'xlarge'

/** Text ink presets (R10): preset palettes — never a free color picker — that
 *  override the `--ui-text-*` family while preserving the theme's hierarchy
 *  ratios. `default` = follow the skin. */
export type TextInkTier = 'default' | 'graphite' | 'ink' | 'sepia'

const TEXT_SCALE_VALUE: Record<TextScaleTier, string> = {
  compact: '0.9',
  default: '1',
  large: '1.1',
  xlarge: '1.25'
}

// Per-mode ink hexes. Light inks for dark surfaces, dark inks for light ones;
// at the family alphas (94/74/54/36%) the primary tier clears AA on every
// built-in skin's surface (measured table in the step14 DEV-B receipt).
const TEXT_INK_COLORS: Record<Exclude<TextInkTier, 'default'>, { dark: string; light: string }> = {
  graphite: { dark: '#c9cfd8', light: '#333a45' },
  ink: { dark: '#e6e8ec', light: '#14161a' },
  sepia: { dark: '#d8cec2', light: '#41392e' }
}

// The hierarchy ratios styles.css bakes into the --ui-text-* family; an ink
// tier reproduces the SAME ratios with a different base color, so secondary
// and tertiary text keep their relative weight.
const TEXT_INK_ALPHAS = [0.94, 0.74, 0.54, 0.36]
const TEXT_INK_VAR_NAMES = ['--ui-text-primary', '--ui-text-secondary', '--ui-text-tertiary', '--ui-text-quaternary']

const INJECTED_FONT_URLS = new Set<string>()

const resolveMode = (mode: ThemeMode, systemDark = matchesQuery('(prefers-color-scheme: dark)')): 'light' | 'dark' =>
  mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

const normalizeSkin = (name: string | null): string =>
  name && resolveTheme(name) && !RETIRED_SKINS.has(name) ? name : DEFAULT_SKIN_NAME

/**
 * A stored mode, or `light` when there isn't one.
 *
 * The default skin is a white one (github), so a fresh install reads as a white
 * app — that IS the product's default look now. Previously this fell back to
 * `system`, which meant a dark-OS user got the dark palette on first launch and
 * never saw the white default at all. Anyone who has actually picked an
 * appearance keeps it; only the "never touched appearance" state changed.
 */
const normalizeMode = (value: string | null): ThemeMode =>
  value === 'light' || value === 'dark' || value === 'system' ? value : 'light'

// ─── Per-profile appearance persistence ─────────────────────────────────────
// Skin and mode are each stored per profile. "default" isn't a real profile —
// it *is* the legacy global slot, so it reads/writes the global directly. Named
// profiles get their own entry and fall back to that global until assigned, so
// unassigned profiles and pre-per-profile installs stay on the global value.
const profilePref = <T extends string>(record: string, legacy: string, normalize: (v: string | null) => T) => ({
  resolve: (profile: string): T => normalize(storedStringRecord(record)[profile] ?? storedString(legacy)),
  assign: (profile: string, value: T): void => {
    if (profile === 'default') {
      persistString(legacy, value)
    } else {
      persistStringRecord(record, { ...storedStringRecord(record), [profile]: value })
    }
  }
})

export const skinPref = profilePref(PROFILE_SKINS_KEY, SKIN_KEY, normalizeSkin)
export const modePref = profilePref(PROFILE_MODES_KEY, MODE_KEY, normalizeMode)

const normalizeTextScale = (value: string | null): TextScaleTier =>
  value === 'compact' || value === 'large' || value === 'xlarge' ? value : 'default'

const normalizeTextInk = (value: string | null): TextInkTier =>
  value === 'graphite' || value === 'ink' || value === 'sepia' ? value : 'default'

export const textScalePref = profilePref(PROFILE_TEXT_SCALE_KEY, TEXT_SCALE_KEY, normalizeTextScale)
export const textInkPref = profilePref(PROFILE_TEXT_INK_KEY, TEXT_INK_KEY, normalizeTextInk)

/** Everything a peer window could change that this one has to repaint for. */
const APPEARANCE_KEYS = new Set([
  SKIN_KEY,
  PROFILE_SKINS_KEY,
  MODE_KEY,
  PROFILE_MODES_KEY,
  TEXT_SCALE_KEY,
  PROFILE_TEXT_SCALE_KEY,
  TEXT_INK_KEY,
  PROFILE_TEXT_INK_KEY
])

// Last active profile — lets the boot paint pick its appearance before the
// gateway reports which profile actually launched.
const readBootProfileKey = () => normalizeProfileKey(storedString(LAST_PROFILE_KEY))
const rememberActiveProfileKey = (profile: string) => persistString(LAST_PROFILE_KEY, profile)

// ─── Color math (for synthesised light variants of dark-only skins) ────────
// hexToRgb / mix / readableOn live in ./color so the VS Code converter shares
// the exact same math.

function synthLightColors(seed: DesktopTheme): DesktopThemeColors {
  const accent = seed.colors.ring || seed.colors.primary
  const soft = mix('#ffffff', accent, 0.1)
  const softer = mix('#ffffff', accent, 0.06)
  const border = mix('#ececef', accent, 0.14)
  const midground = seed.colors.midground ?? accent

  return {
    background: '#ffffff',
    foreground: '#161616',
    card: '#ffffff',
    cardForeground: '#161616',
    muted: softer,
    mutedForeground: mix('#6b6b70', accent, 0.16),
    popover: '#ffffff',
    popoverForeground: '#161616',
    primary: accent,
    primaryForeground: readableOn(accent),
    secondary: soft,
    secondaryForeground: mix('#2a2a2a', accent, 0.34),
    accent: soft,
    accentForeground: mix('#2a2a2a', accent, 0.34),
    border,
    input: mix('#e2e2e6', accent, 0.18),
    ring: accent,
    midground,
    midgroundForeground: readableOn(midground),
    destructive: '#b94a3a',
    destructiveForeground: '#ffffff',
    sidebarBackground: mix('#fafafa', accent, 0.05),
    sidebarBorder: border,
    userBubble: soft,
    userBubbleBorder: border
  }
}

/** Returns the seed palette for a given skin + mode (no overrides applied). */
export function getBaseColors(skinName: string, mode: 'light' | 'dark'): DesktopThemeColors {
  const seed = resolveTheme(skinName) ?? nousTheme

  if (mode === 'dark') {
    return seed.darkColors ?? seed.colors
  }

  return seed.darkColors ? seed.colors : synthLightColors(seed)
}

function deriveTheme(skinName: string, mode: 'light' | 'dark'): DesktopTheme {
  const seed = resolveTheme(skinName) ?? nousTheme

  return {
    ...seed,
    name: `${skinName}-${mode}`,
    label: `${seed.label} ${mode === 'light' ? 'Light' : 'Dark'}`,
    description: `${seed.label} ${mode} palette`,
    colors: getBaseColors(skinName, mode)
  }
}

/**
 * Some palettes intentionally keep a bright background even when
 * `mode === 'dark'`, so we shouldn't apply the `.dark` class. Decide from
 * the actual background luminance.
 */
function renderedModeFor(colors: DesktopThemeColors, mode: 'light' | 'dark'): 'light' | 'dark' {
  const rgb = hexToRgb(colors.background)

  if (!rgb) {
    return mode
  }

  const [r, g, b] = rgb.map(v => v / 255)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 'light' : 'dark'
}

// ─── CSS application ────────────────────────────────────────────────────────

// Per-mode mix knobs. Light/dark fallbacks live in styles.css `:root` /
// `:root.dark`; setting them inline keeps active-skin overrides surviving
// the boot-time paint.
// The one foreground --dt-primary-solid is built to carry. Fixed rather than
// measured: the surface is derived to suit IT, not the other way round.
// styles.css --dt-primary-solid-foreground fallback — keep in sync.
const PRIMARY_SOLID_FOREGROUND = '#fcfcfc'

const mixesFor = (isDark: boolean): Record<string, string> => ({
  '--theme-mix-chrome': isDark ? '74%' : '92%',
  '--theme-mix-sidebar': '100%',
  '--theme-mix-card': isDark ? '38%' : '22%',
  '--theme-mix-elevated': isDark ? '46%' : '28%',
  '--theme-mix-bubble': isDark ? '46%' : '0%'
})

/** R10 typography tiers, applied on top of the palette seeds. A `default` tier
 *  REMOVES its inline overrides so the stylesheet's theme-derived values win
 *  again — switching tiers back must restore the skin exactly. */
function applyTypographyTiers(
  root: HTMLElement,
  appearance: { textInk: TextInkTier; textScale: TextScaleTier },
  isDark: boolean
) {
  root.style.setProperty('--ui-text-scale', TEXT_SCALE_VALUE[appearance.textScale])

  if (appearance.textInk === 'default') {
    for (const name of TEXT_INK_VAR_NAMES) {
      root.style.removeProperty(name)
    }

    return
  }

  const rgb = hexToRgb(TEXT_INK_COLORS[appearance.textInk][isDark ? 'dark' : 'light'])

  if (!rgb) {
    return
  }

  for (const [index, name] of TEXT_INK_VAR_NAMES.entries()) {
    root.style.setProperty(name, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${TEXT_INK_ALPHAS[index]})`)
  }
}

function applyTheme(
  theme: DesktopTheme,
  mode: 'light' | 'dark',
  appearance: { textInk: TextInkTier; textScale: TextScaleTier } = { textInk: 'default', textScale: 'default' }
) {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  const c = theme.colors
  const typo = { ...DEFAULT_TYPOGRAPHY, ...nousTheme.typography, ...theme.typography }
  const rendered = renderedModeFor(c, mode)
  const isDark = rendered === 'dark'
  const midground = c.midground ?? c.ring
  const skinName = theme.name.endsWith(`-${mode}`) ? theme.name.slice(0, -mode.length - 1) : theme.name

  root.style.setProperty('color-scheme', rendered)
  root.dataset.fulilianTheme = skinName
  root.dataset.fulilianMode = rendered
  root.classList.toggle('dark', isDark)

  // Translucency is tuned per appearance, and "appearance" means the palette
  // actually painted — a skin that keeps a bright surface in "dark" wants
  // light's tint. Publishing from here covers the boot paint too, so the very
  // first resolved state main is told about is already the right one.
  setAppearance(rendered)

  // Brand seeds feed every glass + shadcn token via `color-mix()` in styles.css.
  const seeds: Record<string, string> = {
    '--theme-foreground': c.foreground,
    '--theme-primary': c.primary,
    '--theme-secondary': c.secondary,
    '--theme-accent-soft': c.accent,
    '--theme-midground': midground,
    '--theme-warm': c.primary,
    '--theme-background-seed': c.background,
    '--theme-sidebar-seed': c.sidebarBackground ?? c.background,
    '--theme-card-seed': c.card,
    '--theme-elevated-seed': c.popover,
    '--theme-bubble-seed': c.userBubble ?? c.popover
  }

  // shadcn/Tailwind tokens that aren't derived from the seed chain.
  const palette: Record<string, string> = {
    '--dt-primary-foreground': c.primaryForeground,
    '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent-foreground': c.accentForeground,
    '--dt-border': c.border,
    '--dt-input': c.input,
    '--dt-ring': c.ring,
    '--dt-muted': c.muted,
    '--dt-midground-foreground': c.midgroundForeground ?? readableOn(midground),
    // A LOUD fill of the brand colour, for the rare surface that has to read as
    // the app speaking rather than as chrome. `primary` alone can't do that job:
    // a pale accent (imported VS Code themes love a pastel pink) is a perfectly
    // valid primary, and the honest `primaryForeground` for it is near-black —
    // so the "loud" surface comes out a pastel card with dark text on it,
    // whispering. Deepening the hue until the LIGHT foreground clears AA keeps
    // one look across every theme: no-ops on an accent that is already deep,
    // and only ever darkens, so the hue survives.
    '--dt-primary-solid': ensureContrast(c.primary, PRIMARY_SOLID_FOREGROUND, 4.5),
    '--dt-primary-solid-foreground': PRIMARY_SOLID_FOREGROUND,
    '--dt-composer-ring': c.composerRing ?? midground,
    '--dt-destructive': c.destructive,
    '--dt-destructive-foreground': c.destructiveForeground,
    '--dt-sidebar-border': c.sidebarBorder ?? c.border,
    '--dt-user-bubble-border': c.userBubbleBorder ?? c.border,
    // Semantic success, bent toward the accent so it settles into the palette
    // instead of clashing with it. A green accent barely moves it (see
    // `harmonize`); a blue one turns the sidebar's finished dots teal rather
    // than leaving eight emerald spots fighting the theme.
    '--ui-success': harmonize('#10b981', midground, 0.25),
    '--dt-font-sans': typo.fontSans,
    '--dt-font-mono': typo.fontMono,
    '--noise-opacity-mul': isDark ? 'calc(0.04 / 0.21)' : 'calc(0.34 / 0.21)'
  }

  for (const [k, v] of Object.entries({ ...seeds, ...mixesFor(isDark), ...palette })) {
    root.style.setProperty(k, v)
  }

  applyTypographyTiers(root, appearance, isDark)

  const chromeBg = chromeBackground(c.background, isDark)

  window.fulilianDesktop?.setTitleBarTheme?.({
    background: chromeBg,
    foreground: c.foreground
  })

  // Raw (non-JSON) keys read by the inline pre-paint script in index.html —
  // they let a brand-new window paint the themed background on its very first
  // frame, before this module has even loaded.
  try {
    window.localStorage.setItem('fulilian-boot-background', chromeBg)
    window.localStorage.setItem('fulilian-boot-color-scheme', rendered)
  } catch {
    // Storage may be unavailable (private mode / quota); the inline script
    // falls back to prefers-color-scheme.
  }

  if (typo.fontUrl && !INJECTED_FONT_URLS.has(typo.fontUrl)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = typo.fontUrl
    link.dataset.fulilianThemeFont = 'true'
    document.head.appendChild(link)
    INJECTED_FONT_URLS.add(typo.fontUrl)
  }
}

// Pin Electron's nativeTheme to the app's mode so the NATIVE window chrome
// (macOS vibrancy material, titlebar, pre-paint background) matches the app
// theme instead of the OS appearance. An explicit light/dark pick is forced;
// 'system' stays 'system' so prefers-color-scheme keeps tracking the OS.
const syncNativeTheme = (pref: ThemeMode, rendered: 'light' | 'dark') =>
  window.fulilianDesktop?.setNativeTheme?.(pref === 'system' ? 'system' : rendered)

// Boot-time paint to avoid a flash before <ThemeProvider> mounts. Use the last
// active profile's appearance so a non-default profile relaunch paints its own
// skin + light/dark mode.
if (typeof window !== 'undefined') {
  const profile = readBootProfileKey()
  const pref = modePref.resolve(profile)
  const resolved = resolveMode(pref)
  const theme = deriveTheme(skinPref.resolve(profile), resolved)

  applyTheme(theme, resolved, {
    textInk: textInkPref.resolve(profile),
    textScale: textScalePref.resolve(profile)
  })

  syncNativeTheme(pref, renderedModeFor(theme.colors, resolved))
}

// ─── Context ────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: DesktopTheme
  themeName: string
  mode: ThemeMode
  /** The light/dark switch the user picked. */
  resolvedMode: 'light' | 'dark'
  /**
   * The mode actually painted, derived from the active background's luminance.
   * Differs from `resolvedMode` for skins that keep a bright surface in "dark"
   * (or vice-versa). Surface-bound UI (e.g. the terminal palette) should key off
   * this so it matches what's on screen instead of inverting.
   */
  renderedMode: 'light' | 'dark'
  availableThemes: Array<{ name: string; label: string; description: string }>
  setTheme: (name: string) => void
  setMode: (mode: ThemeMode) => void
  /** R10 base text-size tier for the active profile. */
  textInk: TextInkTier
  textScale: TextScaleTier
  setTextInk: (tier: TextInkTier) => void
  setTextScale: (tier: TextScaleTier) => void
  /**
   * Paint a theme with an explicit light/dark, without persistence. This is
   * the highlight preview for the palette. A commit (`setTheme`) or
   * `clearThemePreview` repaints the committed appearance.
   */
  previewTheme: (name: string, mode: 'light' | 'dark') => void
  clearThemePreview: () => void
}

const SKIN_LIST = BUILTIN_THEME_LIST.map(({ name, label, description }) => ({ name, label, description }))

const ThemeContext = createContext<ThemeContextValue>({
  theme: nousTheme,
  themeName: DEFAULT_SKIN_NAME,
  mode: 'light',
  resolvedMode: 'light',
  renderedMode: 'light',
  availableThemes: SKIN_LIST,
  setTheme: () => {},
  setMode: () => {},
  textInk: 'default',
  textScale: 'default',
  setTextInk: () => {},
  setTextScale: () => {},
  previewTheme: () => {},
  clearThemePreview: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Skin + mode are assigned per profile; the active profile drives which
  // appearance shows. Single-profile users only ever see "default", so their
  // behavior is unchanged.
  const profileKey = normalizeProfileKey(useStore($activeGatewayProfile))

  // Built-ins + user-installed + registry-contributed themes. Reactive so an
  // import or a plugin registration shows up live in the palette, settings
  // grid, and `/skin` without a reload.
  const userThemes = useStore($userThemes)
  const backendThemes = useStore($backendThemes)
  const registryVersion = useStore($registryVersion)

  const availableThemes = useMemo(
    () =>
      listAllThemes().map(({ name, label, description }) => ({
        name,
        label,
        description
      })),
    // userThemes + backendThemes + registryVersion ARE listAllThemes' reactivity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userThemes, backendThemes, registryVersion]
  )

  const [themeName, setThemeNameState] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_SKIN_NAME : skinPref.resolve(readBootProfileKey())
  )

  const [mode, setModeState] = useState<ThemeMode>(() =>
    typeof window === 'undefined' ? 'light' : modePref.resolve(readBootProfileKey())
  )

  // R10 typography tiers — same per-profile lifecycle as skin + mode.
  const [textScale, setTextScaleState] = useState<TextScaleTier>(() =>
    typeof window === 'undefined' ? 'default' : textScalePref.resolve(readBootProfileKey())
  )

  const [textInk, setTextInkState] = useState<TextInkTier>(() =>
    typeof window === 'undefined' ? 'default' : textInkPref.resolve(readBootProfileKey())
  )

  // Follow profile switches: paint the profile's assigned skin + mode and
  // remember it for the next boot's first paint.
  useEffect(() => {
    rememberActiveProfileKey(profileKey)
    setThemeNameState(skinPref.resolve(profileKey))
    setModeState(modePref.resolve(profileKey))
    setTextScaleState(textScalePref.resolve(profileKey))
    setTextInkState(textInkPref.resolve(profileKey))
  }, [profileKey])

  // Appearance is per-profile localStorage, and every desktop window is another
  // renderer on the same origin — so a switch made in the HUD (or any peer
  // window) only ever repainted the window it was made in. `storage` fires in
  // the OTHER windows, which is exactly the set that needs to catch up.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && !APPEARANCE_KEYS.has(event.key)) {
        return
      }

      const live = normalizeProfileKey($activeGatewayProfile.get())

      setThemeNameState(skinPref.resolve(live))
      setModeState(modePref.resolve(live))
      setTextScaleState(textScalePref.resolve(live))
      setTextInkState(textInkPref.resolve(live))
    }

    window.addEventListener('storage', onStorage)

    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolvedMode = resolveMode(mode, systemDark)

  // Transient highlight preview (palette theme picker). It is never
  // persisted. A commit or an explicit clear returns the paint to the
  // committed appearance.
  const [preview, setPreview] = useState<{ name: string; mode: 'light' | 'dark' } | null>(null)

  const paintedName = preview ? preview.name : themeName
  const paintedMode = preview ? preview.mode : resolvedMode

  const activeTheme = useMemo(
    () => deriveTheme(paintedName, paintedMode),
    // deriveTheme resolves its seed through the merged registry, so the theme
    // stores are its reactivity too — an in-place palette edit of the ACTIVE
    // skin (live theme authoring) must repaint, not just a name switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paintedName, paintedMode, userThemes, backendThemes, registryVersion]
  )

  // Dev-only accent retint. `null` (always, in production) returns the theme
  // untouched, and retintTheme is an identity when the seed already matches —
  // so the picker costs nothing until it's actually moved off the default.
  const accentOverride = useStore($accentOverride)

  const paintedTheme = useMemo(
    () => (accentOverride === null ? activeTheme : retintTheme(activeTheme, accentOverride)),
    [activeTheme, accentOverride]
  )

  // What actually gets painted (matches the `.dark` class applyTheme toggles).
  const renderedMode = useMemo(() => renderedModeFor(paintedTheme.colors, paintedMode), [paintedTheme, paintedMode])

  useEffect(() => applyTheme(paintedTheme, paintedMode, { textInk, textScale }), [paintedTheme, paintedMode, textInk, textScale])

  // Keep the native window appearance pinned to the app theme (vibrancy
  // material, titlebar, new-window pre-paint background).
  useEffect(() => syncNativeTheme(mode, renderedMode), [mode, renderedMode])

  // Assign to whichever profile is live right now (read fresh so the callbacks
  // stay stable across profile switches).
  const liveProfile = () => normalizeProfileKey($activeGatewayProfile.get())

  const setTheme = useCallback((name: string) => {
    const next = normalizeSkin(name)
    setPreview(null)
    setThemeNameState(next)
    skinPref.assign(liveProfile(), next)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setPreview(null)
    setModeState(next)
    modePref.assign(liveProfile(), next)
  }, [])

  const setTextScale = useCallback((tier: TextScaleTier) => {
    setTextScaleState(tier)
    textScalePref.assign(liveProfile(), tier)
  }, [])

  const setTextInk = useCallback((tier: TextInkTier) => {
    setTextInkState(tier)
    textInkPref.assign(liveProfile(), tier)
  }, [])

  const previewTheme = useCallback((name: string, previewMode: 'light' | 'dark') => {
    setPreview(resolveTheme(name) ? { name, mode: previewMode } : null)
  }, [])

  const clearThemePreview = useCallback(() => setPreview(null), [])

  // Drain a backend-driven skin switch (Fulilian authoring/activating a skin from a
  // prompt, or `/skin` on another surface). setTheme persists it per profile, so
  // the choice sticks like any manual pick.
  const pendingSkin = useStore($pendingSkinApply)

  useEffect(() => {
    if (pendingSkin) {
      setTheme(pendingSkin)
      $pendingSkinApply.set(null)
    }
  }, [pendingSkin, setTheme])

  // The light/dark toggle (Shift+X by default) is owned by the keybind runtime
  // (`appearance.toggleMode`) so it shows up in the hotkey map and is rebindable.

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: paintedTheme,
      themeName,
      mode,
      resolvedMode,
      renderedMode,
      availableThemes,
      setTheme,
      setMode,
      textInk,
      textScale,
      setTextInk,
      setTextScale,
      previewTheme,
      clearThemePreview
    }),
    [
      paintedTheme,
      themeName,
      mode,
      resolvedMode,
      renderedMode,
      availableThemes,
      setTheme,
      setMode,
      textInk,
      textScale,
      setTextInk,
      setTextScale,
      previewTheme,
      clearThemePreview
    ]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeContextValue => useContext(ThemeContext)
