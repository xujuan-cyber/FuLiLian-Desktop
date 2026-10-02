/**
 * Built-in desktop themes. Names match the CLI skins / dashboard presets.
 * Add new themes here — no code changes needed elsewhere.
 *
 * The palette-bearing skins (nous, catppuccin, everforest, solarized) are forks
 * of their VS Code originals, converted by `buildThemeFromMarketplace` (see
 * ./install.ts) from the extensions below — the same path a Marketplace import
 * takes, so each is identical to installing the extension by hand and costs the
 * user neither the download nor the install step.
 *
 *   nous       ← github.github-vscode-theme   (Light Default / Dark Default)
 *   catppuccin ← Catppuccin.catppuccin-vsc    (Latte / Mocha)
 *   everforest ← sainnhe.everforest
 *   solarized  ← ryanolsonx.solarized
 *
 * Re-convert marketplace forks from the upstream extension rather than
 * hand-editing hexes; hand edits drift from upstream silently and can't be
 * re-derived. `nous-alt` is first-party — do not re-derive it from GitHub.
 */

import type { DesktopTheme, DesktopThemeTypography } from './types'

// Color-emoji fonts to append to every stack as a last resort. None of the UI
// text/mono fonts carry emoji glyphs, so without this emoji render as tofu
// boxes on platforms whose default text font lacks them (e.g. Linux/#40364).
// Covers macOS, Windows, Linux, plus the `emoji` generic for anything else.
export const EMOJI_FALLBACK = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'

const SYSTEM_SANS =
  '"Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif, ' +
  EMOJI_FALLBACK

const SYSTEM_MONO = 'Menlo, Monaco, "SF Mono", "Courier Prime", monospace, ' + EMOJI_FALLBACK

/**
 * Fulilian UI stacks (step 13 · U4 档 A) — Sarasa Gothic SC / Sarasa Term SC,
 * subset + bundled locally under `src/fonts/` and declared via `@font-face`
 * in `styles.css`. Local rather than a remote `fontUrl` on purpose (pit-N2).
 *
 * Each stack MUST end with EMOJI_FALLBACK — `presets.test.ts` asserts it for
 * every built-in that declares typography.
 *
 * Referenced from exactly two places — `DEFAULT_TYPOGRAPHY` and
 * `nousTheme.typography` — through these constants rather than as repeated
 * literals. `context.tsx` merges `nousTheme.typography` as a *middle* layer,
 * so two hand-maintained copies would drift and silently undo the other.
 */
export const FULILIAN_SANS =
  `"Fulilian Sans", "Sarasa Gothic SC", "HarmonyOS Sans SC", "Microsoft YaHei", ` +
  `"PingFang SC", "Noto Sans SC", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif, ` +
  EMOJI_FALLBACK

export const FULILIAN_MONO =
  `"Fulilian Mono", "Sarasa Term SC", "JetBrains Mono", Menlo, Monaco, "SF Mono", "Courier Prime", monospace, ` +
  EMOJI_FALLBACK

export const DEFAULT_TYPOGRAPHY: DesktopThemeTypography = { fontSans: FULILIAN_SANS, fontMono: FULILIAN_MONO }

/**
 * Nous — the canonical Fulilian desktop identity, forked from the GitHub VS Code
 * theme (github.github-vscode-theme). Light is GitHub Light Default, dark is
 * GitHub Dark Default, both converted through the same path a Marketplace
 * install takes, so the palette here is byte-identical to importing the
 * extension yourself.
 *
 * Typography stays Fulilian's own: a VS Code theme carries no font opinion, and
 * these are the stacks every skin has been rendering with.
 */
/**
 * GitHub — the upstream palette, unmodified.
 *
 * `nous` is a fork of this with its own accent, so shipping both keeps the
 * original available on its own terms instead of only existing as the thing
 * nous diverged from. Everything but the accent family is identical between
 * them; separate presets are what let nous's accent move without silently
 * redefining what "GitHub" means.
 */
export const githubTheme: DesktopTheme = {
  name: 'github',
  label: 'GitHub',
  description: 'GitHub Light Default and Dark Default',
  colors: {
    background: '#ffffff',
    foreground: '#1f2328',
    card: '#f6f8fa',
    cardForeground: '#1f2328',
    muted: '#f6f6f6',
    mutedForeground: '#656d76',
    popover: '#ffffff',
    popoverForeground: '#1f2328',
    primary: '#196d31',
    primaryForeground: '#ffffff',
    secondary: '#dfebe2',
    secondaryForeground: '#1f2328',
    accent: '#e3ede6',
    accentForeground: '#1f2328',
    border: '#d0d7de',
    input: '#ffffff',
    ring: '#196d31',
    midground: '#196d31',
    midgroundForeground: '#ffffff',
    composerRing: '#196d31',
    destructive: '#cf222e',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#f6f8fa',
    sidebarBorder: '#d0d7de',
    userBubble: '#dbe7e2',
    userBubbleBorder: '#d0d7de'
  },
  darkColors: {
    background: '#0d1117',
    foreground: '#e6edf3',
    card: '#010409',
    cardForeground: '#e6edf3',
    muted: '#1a1e24',
    mutedForeground: '#7d8590',
    popover: '#161b22',
    popoverForeground: '#e6edf3',
    primary: '#4f9e5e',
    primaryForeground: '#ffffff',
    secondary: '#1f382b',
    secondaryForeground: '#e6edf3',
    accent: '#192a24',
    accentForeground: '#e6edf3',
    border: '#30363d',
    input: '#0d1117',
    ring: '#4f9e5e',
    midground: '#4f9e5e',
    midgroundForeground: '#ffffff',
    composerRing: '#4f9e5e',
    destructive: '#f85149',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#010409',
    sidebarBorder: '#30363d',
    userBubble: '#0f2018',
    userBubbleBorder: '#30363d'
  },
  typography: {
    fontSans: FULILIAN_SANS,
    fontMono: FULILIAN_MONO,
    fontUrl: 'https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap'
  },
  terminal: {
    foreground: '#1f2328',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f'
  },
  darkTerminal: {
    foreground: '#e6edf3',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff'
  }
}

/** Catppuccin — Latte in light, Mocha in dark (Catppuccin.catppuccin-vsc). */

/**
 * Nous — the canonical Fulilian desktop identity: GitHub's chrome carrying Nous
 * blue. Forked from github.github-vscode-theme (Light Default / Dark Default),
 * with only the accent family re-seeded; every neutral is upstream's.
 *
 * Two seeds, one blue. `#0053FD` is the brand color and reads at 5.4:1 on the
 * light sidebar, but only 3.6:1 on the near-black dark one — so dark carries
 * `#4a84fe`, the same hue (263°) lifted to clear AA at 5.9:1. The soft
 * surfaces below are mixed from those seeds in OKLab, which is what keeps a
 * saturated blue from drifting violet on its way to white.
 */
export const nousTheme: DesktopTheme = {
  name: 'nous',
  label: 'Nous',
  description: 'GitHub chrome, Nous blue accent',
  colors: {
    background: '#ffffff',
    foreground: '#1f2328',
    card: '#f6f8fa',
    cardForeground: '#1f2328',
    muted: '#f6f6f6',
    mutedForeground: '#656d76',
    popover: '#ffffff',
    popoverForeground: '#1f2328',
    primary: '#0053fd',
    primaryForeground: '#ffffff',
    secondary: '#deeaff',
    secondaryForeground: '#1f2328',
    accent: '#e3edff',
    accentForeground: '#1f2328',
    border: '#d0d7de',
    input: '#ffffff',
    ring: '#0053fd',
    midground: '#0053fd',
    midgroundForeground: '#ffffff',
    composerRing: '#0053fd',
    destructive: '#cf222e',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#f6f8fa',
    sidebarBorder: '#d0d7de',
    userBubble: '#dae7fd',
    userBubbleBorder: '#d0d7de'
  },
  darkColors: {
    background: '#0d1117',
    foreground: '#e6edf3',
    card: '#010409',
    cardForeground: '#e6edf3',
    muted: '#1a1e24',
    mutedForeground: '#7d8590',
    popover: '#161b22',
    popoverForeground: '#e6edf3',
    primary: '#4a84fe',
    primaryForeground: '#161616',
    secondary: '#1d2e4f',
    secondaryForeground: '#e6edf3',
    accent: '#17243a',
    accentForeground: '#e6edf3',
    border: '#30363d',
    input: '#0d1117',
    ring: '#4a84fe',
    midground: '#4a84fe',
    midgroundForeground: '#161616',
    composerRing: '#4a84fe',
    destructive: '#f85149',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#010409',
    sidebarBorder: '#30363d',
    userBubble: '#07162c',
    userBubbleBorder: '#30363d'
  },
  typography: {
    fontSans: FULILIAN_SANS,
    fontMono: FULILIAN_MONO,
    fontUrl: 'https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap'
  },
  terminal: {
    foreground: '#1f2328',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f'
  },
  darkTerminal: {
    foreground: '#e6edf3',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff'
  }
}

/** Catppuccin — Latte in light, Mocha in dark (Catppuccin.catppuccin-vsc). */
export const catppuccinTheme: DesktopTheme = {
  name: 'catppuccin',
  label: 'Catppuccin',
  description: 'Soothing pastels — Latte and Mocha',
  colors: {
    background: '#eff1f5',
    foreground: '#4c4f69',
    card: '#e6e9ef',
    cardForeground: '#4c4f69',
    muted: '#e8ebef',
    mutedForeground: '#4c4f69',
    popover: '#e6e9ef',
    popoverForeground: '#4c4f69',
    primary: '#6d2ebf',
    primaryForeground: '#ffffff',
    secondary: '#ddd6ed',
    secondaryForeground: '#4c4f69',
    accent: '#dfdaef',
    accentForeground: '#4c4f69',
    border: '#acb0be',
    input: '#ccd0da',
    ring: '#6d2ebf',
    midground: '#6d2ebf',
    midgroundForeground: '#ffffff',
    composerRing: '#6d2ebf',
    destructive: '#d20f39',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#e6e9ef',
    sidebarBorder: '#acb0be',
    userBubble: '#d7d3e9',
    userBubbleBorder: '#acb0be'
  },
  darkColors: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    card: '#181825',
    cardForeground: '#cdd6f4',
    muted: '#29293a',
    mutedForeground: '#cdd6f4',
    popover: '#181825',
    popoverForeground: '#cdd6f4',
    primary: '#cba6f7',
    primaryForeground: '#ffffff',
    secondary: '#4e4466',
    secondaryForeground: '#cdd6f4',
    accent: '#3d3652',
    accentForeground: '#cdd6f4',
    border: '#585b70',
    input: '#313244',
    ring: '#cba6f7',
    midground: '#cba6f7',
    midgroundForeground: '#ffffff',
    composerRing: '#cba6f7',
    destructive: '#f38ba8',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#181825',
    sidebarBorder: '#585b70',
    userBubble: '#38324b',
    userBubbleBorder: '#585b70'
  },
  terminal: {
    foreground: '#4c4f69',
    cursor: '#dc8a78',
    selectionBackground: '#acb0be',
    black: '#5c5f77',
    red: '#d20f39',
    green: '#40a02b',
    yellow: '#df8e1d',
    blue: '#1e66f5',
    magenta: '#ea76cb',
    cyan: '#179299',
    white: '#acb0be',
    brightBlack: '#6c6f85',
    brightRed: '#de293e',
    brightGreen: '#49af3d',
    brightYellow: '#eea02d',
    brightBlue: '#456eff',
    brightMagenta: '#fe85d8',
    brightCyan: '#2d9fa8',
    brightWhite: '#bcc0cc'
  },
  darkTerminal: {
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#585b70',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#a6adc8',
    brightBlack: '#585b70',
    brightRed: '#f37799',
    brightGreen: '#89d88b',
    brightYellow: '#ebd391',
    brightBlue: '#74a8fc',
    brightMagenta: '#f2aede',
    brightCyan: '#6bd7ca',
    brightWhite: '#bac2de'
  }
}

/** Everforest — warm, low-contrast forest greens (sainnhe.everforest). */
export const everforestTheme: DesktopTheme = {
  name: 'everforest',
  label: 'Everforest',
  description: 'Warm, low-contrast forest greens',
  colors: {
    background: '#fdf6e3',
    foreground: '#5c6a72',
    card: '#fdf6e3',
    cardForeground: '#5c6a72',
    muted: '#f7f0de',
    mutedForeground: '#939f91',
    popover: '#fdf6e3',
    popoverForeground: '#5c6a72',
    primary: '#586b35',
    primaryForeground: '#ffffff',
    secondary: '#e6e3cb',
    secondaryForeground: '#5c6a72',
    accent: '#e9e5ce',
    accentForeground: '#5c6a72',
    border: '#fdf6e3',
    input: '#fdf6e3',
    ring: '#586b35',
    midground: '#586b35',
    midgroundForeground: '#ffffff',
    composerRing: '#586b35',
    destructive: '#f1706f',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#fdf6e3',
    sidebarBorder: '#fdf6e3',
    userBubble: '#e9e5ce',
    userBubbleBorder: '#fdf6e3'
  },
  darkColors: {
    background: '#2d353b',
    foreground: '#d3c6aa',
    card: '#2d353b',
    cardForeground: '#d3c6aa',
    muted: '#373e42',
    mutedForeground: '#859289',
    popover: '#2d353b',
    popoverForeground: '#d3c6aa',
    primary: '#a7c080',
    primaryForeground: '#ffffff',
    secondary: '#4f5c4e',
    secondaryForeground: '#d3c6aa',
    accent: '#434e47',
    accentForeground: '#d3c6aa',
    border: '#2d353b',
    input: '#2d353b',
    ring: '#a7c080',
    midground: '#a7c080',
    midgroundForeground: '#ffffff',
    composerRing: '#a7c080',
    destructive: '#da6362',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#2d353b',
    sidebarBorder: '#2d353b',
    userBubble: '#434e47',
    userBubbleBorder: '#2d353b'
  },
  terminal: {
    foreground: '#5c6a72',
    cursor: '#5c6a72',
    black: '#5c6a72',
    red: '#f85552',
    green: '#8da101',
    yellow: '#dfa000',
    blue: '#3a94c5',
    magenta: '#df69ba',
    cyan: '#35a77c',
    white: '#939f91',
    brightBlack: '#5c6a72',
    brightRed: '#f85552',
    brightGreen: '#8da101',
    brightYellow: '#dfa000',
    brightBlue: '#3a94c5',
    brightMagenta: '#df69ba',
    brightCyan: '#35a77c',
    brightWhite: '#f4f0d9'
  },
  darkTerminal: {
    foreground: '#d3c6aa',
    cursor: '#d3c6aa',
    black: '#343f44',
    red: '#e67e80',
    green: '#a7c080',
    yellow: '#dbbc7f',
    blue: '#7fbbb3',
    magenta: '#d699b6',
    cyan: '#83c092',
    white: '#d3c6aa',
    brightBlack: '#859289',
    brightRed: '#e67e80',
    brightGreen: '#a7c080',
    brightYellow: '#dbbc7f',
    brightBlue: '#7fbbb3',
    brightMagenta: '#d699b6',
    brightCyan: '#83c092',
    brightWhite: '#d3c6aa'
  }
}

/** Solarized — Ethan Schoonover's fixed-contrast pair (ryanolsonx.solarized). */
export const solarizedTheme: DesktopTheme = {
  name: 'solarized',
  label: 'Solarized',
  description: 'Fixed-contrast light and dark',
  colors: {
    background: '#fdf6e3',
    foreground: '#1f1f1f',
    card: '#d3cbb7',
    cardForeground: '#1f1f1f',
    muted: '#f4eddb',
    mutedForeground: '#9ca8a6',
    popover: '#eee8d5',
    popoverForeground: '#1f1f1f',
    primary: '#675e34',
    primaryForeground: '#ffffff',
    secondary: '#e8e1cb',
    secondaryForeground: '#1f1f1f',
    accent: '#ebe4ce',
    accentForeground: '#1f1f1f',
    border: '#ddd6c1',
    input: '#ddd6c1',
    ring: '#675e34',
    midground: '#675e34',
    midgroundForeground: '#ffffff',
    composerRing: '#675e34',
    destructive: '#e25563',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#eee8d5',
    sidebarBorder: '#ddd6c1',
    userBubble: '#c6bea7',
    userBubbleBorder: '#ddd6c1'
  },
  darkColors: {
    background: '#002b36',
    foreground: '#839496',
    card: '#002b36',
    cardForeground: '#839496',
    muted: '#08313c',
    mutedForeground: '#586e75',
    popover: '#001f26',
    popoverForeground: '#839496',
    primary: '#6ea1c4',
    primaryForeground: '#ffffff',
    secondary: '#1f4c5e',
    secondaryForeground: '#839496',
    accent: '#144050',
    accentForeground: '#839496',
    border: '#234751',
    input: '#073642',
    ring: '#6ea1c4',
    midground: '#6ea1c4',
    midgroundForeground: '#ffffff',
    composerRing: '#6ea1c4',
    destructive: '#e35957',
    destructiveForeground: '#ffffff',
    sidebarBackground: '#001f26',
    sidebarBorder: '#234751',
    userBubble: '#144050',
    userBubbleBorder: '#234751'
  },
  terminal: {
    foreground: '#657b83',
    black: '#657b83',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#657b83',
    brightRed: '#cb4b16',
    brightGreen: '#859900',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#eee8d5'
  },
  darkTerminal: {
    foreground: '#839496',
    cursor: '#ffffff',
    selectionBackground: '#ffffff40',
    black: '#14181d',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#e5e5e5',
    brightBlack: '#676767',
    brightRed: '#dc322f',
    brightGreen: '#859900',
    brightYellow: '#b58900',
    brightBlue: '#268bd2',
    brightMagenta: '#d33682',
    brightCyan: '#2aa198',
    brightWhite: '#e5e5e5'
  }
}

const NOUS_ALT_BLUE = '#0053FD'
const NOUS_ALT_NAVY = '#1540B1'
const NOUS_ALT_CREAM = '#FFE6CB'

const nousAltTint = (pct: number) => `color-mix(in srgb, ${NOUS_ALT_BLUE} ${pct}%, #FFFFFF)`
const nousAltTintTransparent = (pct: number) => `color-mix(in srgb, ${NOUS_ALT_BLUE} ${pct}%, transparent)`

/**
 * Nous Alt — the hand-authored Nous from before the GitHub fork. Light is
 * glass neutrals with brand blue; dark is cream on mission-blue.
 */
export const nousAltTheme: DesktopTheme = {
  name: 'nous-alt',
  label: 'Nous Alt',
  description: 'Glass neutrals, cream on mission-blue',
  colors: {
    background: '#F8FAFF',
    foreground: '#17171A',
    card: '#FFFFFF',
    cardForeground: '#17171A',
    muted: nousAltTint(5),
    mutedForeground: '#666678',
    popover: '#FFFFFF',
    popoverForeground: '#17171A',
    primary: NOUS_ALT_BLUE,
    primaryForeground: '#FCFCFC',
    secondary: nousAltTint(7),
    secondaryForeground: '#242432',
    accent: nousAltTint(10),
    accentForeground: '#202030',
    border: nousAltTintTransparent(22),
    input: nousAltTintTransparent(30),
    ring: NOUS_ALT_BLUE,
    midground: NOUS_ALT_BLUE,
    composerRing: NOUS_ALT_BLUE,
    destructive: '#C72E4D',
    destructiveForeground: '#FFFFFF',
    sidebarBackground: '#F3F7FF',
    sidebarBorder: nousAltTintTransparent(18),
    userBubble: nousAltTint(6),
    userBubbleBorder: nousAltTintTransparent(24)
  },
  darkColors: {
    background: '#0D2F86',
    foreground: NOUS_ALT_CREAM,
    card: '#12378F',
    cardForeground: NOUS_ALT_CREAM,
    muted: '#183F9A',
    mutedForeground: '#B5C7F3',
    popover: '#123A96',
    popoverForeground: NOUS_ALT_CREAM,
    primary: NOUS_ALT_CREAM,
    primaryForeground: '#0D2F86',
    secondary: '#1B45A4',
    secondaryForeground: '#E0E8FF',
    accent: NOUS_ALT_NAVY,
    accentForeground: '#F0F4FF',
    border: '#3158AD',
    input: '#0B2566',
    ring: NOUS_ALT_CREAM,
    midground: NOUS_ALT_BLUE,
    composerRing: NOUS_ALT_CREAM,
    destructive: '#C0473A',
    destructiveForeground: '#FEF2F2',
    sidebarBackground: '#09286F',
    sidebarBorder: '#234A9C',
    userBubble: '#143B91',
    userBubbleBorder: '#3A63BD'
  },
  typography: {
    fontSans: FULILIAN_SANS,
    fontMono: FULILIAN_MONO,
    fontUrl: 'https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap'
  }
}

/**
 * Midnight — deep blue-violet, near-monotone. Dark only: it has no light
 * palette because the whole idea is the dark end of the spectrum.
 */
export const midnightTheme: DesktopTheme = {
  name: 'midnight',
  label: 'Midnight',
  description: 'Deep blue-violet with cool accents',
  colors: {
    background: '#08081c',
    foreground: '#ddd6ff',
    card: '#0d0d28',
    cardForeground: '#ddd6ff',
    muted: '#13133a',
    mutedForeground: '#7c7ab0',
    popover: '#0f0f2e',
    popoverForeground: '#ddd6ff',
    primary: '#ddd6ff',
    primaryForeground: '#08081c',
    secondary: '#1a1a4a',
    secondaryForeground: '#c4bff0',
    accent: '#1a1a44',
    accentForeground: '#d0c8ff',
    border: '#1e1e52',
    input: '#1e1e52',
    ring: '#8b80e8',
    midground: '#8b80e8',
    destructive: '#b03060',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#06061a',
    sidebarBorder: '#12123a',
    userBubble: '#14143a',
    userBubbleBorder: '#242466'
  },
  typography: {
    fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`,
    fontUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap'
  }
}

export const emberTheme: DesktopTheme = {
  name: 'ember',
  label: 'Ember',
  description: 'Warm crimson and bronze — forge vibes',
  colors: {
    background: '#160800',
    foreground: '#ffd8b0',
    card: '#1e0e04',
    cardForeground: '#ffd8b0',
    muted: '#2a1408',
    mutedForeground: '#aa7a56',
    popover: '#221008',
    popoverForeground: '#ffd8b0',
    primary: '#ffd8b0',
    primaryForeground: '#160800',
    secondary: '#341800',
    secondaryForeground: '#f0c090',
    accent: '#301600',
    accentForeground: '#e8c080',
    border: '#3a1c08',
    input: '#3a1c08',
    ring: '#d97316',
    midground: '#d97316',
    destructive: '#c43010',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#100600',
    sidebarBorder: '#2a1004',
    userBubble: '#2a1000',
    userBubbleBorder: '#4a2010'
  },
  typography: {
    fontMono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    fontUrl: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap'
  }
}

/** Clean grayscale. Matches the CLI mono skin and dashboard mono theme. */
export const monoTheme: DesktopTheme = {
  name: 'mono',
  label: 'Mono',
  description: 'Clean grayscale — minimal and focused',
  colors: {
    background: '#0e0e0e',
    foreground: '#eaeaea',
    card: '#141414',
    cardForeground: '#eaeaea',
    muted: '#1e1e1e',
    mutedForeground: '#808080',
    popover: '#181818',
    popoverForeground: '#eaeaea',
    primary: '#eaeaea',
    primaryForeground: '#0e0e0e',
    secondary: '#262626',
    secondaryForeground: '#c8c8c8',
    accent: '#222222',
    accentForeground: '#d8d8d8',
    border: '#2a2a2a',
    input: '#2a2a2a',
    ring: '#9a9a9a',
    midground: '#9a9a9a',
    destructive: '#a84040',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#0a0a0a',
    sidebarBorder: '#202020',
    userBubble: '#1a1a1a',
    userBubbleBorder: '#363636'
  }
}

/** Neon green on black. Matches the CLI cyberpunk skin and dashboard theme. */
export const cyberpunkTheme: DesktopTheme = {
  name: 'cyberpunk',
  label: 'Cyberpunk',
  description: 'Neon green on black — matrix terminal',
  colors: {
    background: '#000a00',
    foreground: '#00ff41',
    card: '#001200',
    cardForeground: '#00ff41',
    muted: '#001a00',
    mutedForeground: '#1a8a30',
    popover: '#001000',
    popoverForeground: '#00ff41',
    primary: '#00ff41',
    primaryForeground: '#000a00',
    secondary: '#002800',
    secondaryForeground: '#00cc34',
    accent: '#002000',
    accentForeground: '#00e038',
    border: '#003000',
    input: '#003000',
    ring: '#00ff41',
    midground: '#00ff41',
    destructive: '#ff003c',
    destructiveForeground: '#000a00',
    sidebarBackground: '#000600',
    sidebarBorder: '#001800',
    userBubble: '#001400',
    userBubbleBorder: '#004800'
  },
  typography: {
    fontMono: `"Courier New", Courier, monospace, ${EMOJI_FALLBACK}`,
    fontSans: `"Courier New", Courier, monospace, ${EMOJI_FALLBACK}`
  }
}

/** Cool slate blue for developers. Matches the CLI slate skin. */
export const slateTheme: DesktopTheme = {
  name: 'slate',
  label: 'Slate',
  description: 'Cool slate blue — focused developer theme',
  colors: {
    background: '#0d1117',
    foreground: '#c9d1d9',
    card: '#161b22',
    cardForeground: '#c9d1d9',
    muted: '#21262d',
    mutedForeground: '#8b949e',
    popover: '#1c2128',
    popoverForeground: '#c9d1d9',
    primary: '#c9d1d9',
    primaryForeground: '#0d1117',
    secondary: '#2a3038',
    secondaryForeground: '#adb5bf',
    accent: '#1e2530',
    accentForeground: '#c0c8d0',
    border: '#30363d',
    input: '#30363d',
    ring: '#58a6ff',
    midground: '#58a6ff',
    destructive: '#cf4848',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#090d13',
    sidebarBorder: '#1c2228',
    userBubble: '#1e2a38',
    userBubbleBorder: '#2e4060'
  },
  typography: {
    fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`
  }
}

/**
 * Apricot — Fulilian's default skin (step 13 · U2). A warm rice-apricot light
 * and a warm brown-black dark; the name is the colour, not a pun.
 *
 * Reference points, not copies: light sits between Rosé Pine Dawn's `base`
 * (#faf4ed) and Everforest Light's `bg` (#fdf6e3), and every neutral keeps a
 * warm cast so chrome never reads as "premium warm surface, cheap cool-grey
 * edge". Dark is the same family at night.
 *
 * Two values here deliberately overrule the original proposal, because the
 * proposed hexes measured below AA against these surfaces — do not revert:
 *   · primary #9A6528  (proposal #B07A3C measured 3.39 — under body AA)
 *   · border  #D8C7AC  (proposal #E3D6C2 measured 1.32 — invisible hairline)
 *
 * No `typography` on purpose. `context.tsx` merges `nousTheme.typography` as a
 * *middle* layer, so a third copy of the font chain here would be a drift risk
 * with no upside: the chain lives in DEFAULT_TYPOGRAPHY + nousTheme.typography
 * only, and apricot inherits that merged result.
 *
 * The ANSI palettes are the theme's own, not `nous`'s cool set — a cool
 * terminal against a warm page is the loudest way to break the illusion. Every
 * slot clears 3.0:1 against the theme background (terminal text is large-scale).
 */
export const apricotTheme: DesktopTheme = {
  name: 'apricot',
  label: 'Apricot',
  description: 'Warm rice-apricot light and warm brown-black dark',
  colors: {
    background: '#FAF5EA',
    foreground: '#2A241C',
    card: '#FFFCF5',
    cardForeground: '#2A241C',
    muted: '#EFE6D6',
    mutedForeground: '#6B5B49',
    popover: '#FFFEFA',
    popoverForeground: '#2A241C',
    primary: '#9A6528',
    primaryForeground: '#FFFCF5',
    secondary: '#F0E5D3',
    secondaryForeground: '#2A241C',
    accent: '#F1E7D6',
    accentForeground: '#2A241C',
    border: '#D8C7AC',
    input: '#F5EEE0',
    ring: '#9A6528',
    midground: '#9A6528',
    midgroundForeground: '#FFFCF5',
    composerRing: '#9A6528',
    destructive: '#B3324B',
    destructiveForeground: '#FFFCF5',
    sidebarBackground: '#F3EADC',
    sidebarBorder: '#D8C7AC',
    userBubble: '#F1E7D6',
    userBubbleBorder: '#D8C7AC'
  },
  darkColors: {
    background: '#1C1814',
    foreground: '#EDE4D6',
    card: '#241F1A',
    cardForeground: '#EDE4D6',
    muted: '#2A2420',
    mutedForeground: '#A79A88',
    popover: '#241F1A',
    popoverForeground: '#EDE4D6',
    primary: '#D9A56A',
    primaryForeground: '#241F1A',
    secondary: '#2E2823',
    secondaryForeground: '#EDE4D6',
    accent: '#312A24',
    accentForeground: '#EDE4D6',
    border: '#3F372E',
    input: '#3F372E',
    ring: '#D9A56A',
    midground: '#D9A56A',
    midgroundForeground: '#241F1A',
    composerRing: '#D9A56A',
    destructive: '#E4677F',
    destructiveForeground: '#241F1A',
    sidebarBackground: '#17130F',
    sidebarBorder: '#3F372E',
    userBubble: '#312A24',
    userBubbleBorder: '#3F372E'
  },
  terminal: {
    foreground: '#4A4034',
    black: '#3F372C',
    red: '#B3324B',
    green: '#4F7A3A',
    yellow: '#8A5D14',
    blue: '#39628A',
    magenta: '#8E4A66',
    cyan: '#37706E',
    white: '#8A7A63',
    brightBlack: '#6B5B49',
    brightRed: '#A8435A',
    brightGreen: '#4A7434',
    brightYellow: '#96661A',
    brightBlue: '#456F9C',
    brightMagenta: '#8A5480',
    brightCyan: '#3E7A78',
    brightWhite: '#9A8B75'
  },
  darkTerminal: {
    foreground: '#EDE4D6',
    black: '#7A6D5A',
    red: '#E4677F',
    green: '#8FBF74',
    yellow: '#D9B153',
    blue: '#7FA8D4',
    magenta: '#C98BB6',
    cyan: '#7FBDB8',
    white: '#A79A88',
    brightBlack: '#8A7C6A',
    brightRed: '#F07E93',
    brightGreen: '#A5D18A',
    brightYellow: '#E6C46B',
    brightBlue: '#93B8DF',
    brightMagenta: '#D8A0C6',
    brightCyan: '#93CBC6',
    brightWhite: '#F5EEE2'
  }
}

/**
 * Fulilian Workbench — the first-party default skin (step 15 · T1).
 *
 * ZCode-aligned: a neutral grey-white light ("Workbench Light") and a cool
 * graphite dark ("石墨 Graphite"), flat and restrained, with a deep-ink
 * primary/send key and a small-area signal orange (`accentBright`).
 *
 * Hand-authored rather than converted from a Marketplace extension — like
 * `nous-alt` and `apricot` this is a first-party palette, so it is allowed to
 * write its hexes directly (DESIGN_PROPOSAL §3). Do not re-derive it from a VS
 * Code theme.
 *
 * No `typography` on purpose. `context.tsx` merges `nousTheme.typography` as a
 * *middle* layer, so a third copy of the font chain here would be a drift risk
 * with no upside — Workbench inherits the merged Fulilian chain unchanged.
 *
 * The four optional slots (`accentBright` / `info` / `success` / `warning`) are
 * new in step 15 · T1 and are deliberately optional: the twelve legacy skins do
 * not declare them, so consumers must still fall back to the stylesheet
 * constants in `styles.css`.
 *
 * The ANSI palettes are Workbench's own — a cool terminal against a cool page.
 * Every slot clears 3.0:1 against the theme background (terminal text is
 * large-scale).
 */
export const workbenchTheme: DesktopTheme = {
  name: 'fulilian-workbench',
  label: 'Fulilian Workbench',
  description: 'Neutral workbench light and graphite dark',
  colors: {
    background: '#FFFFFF',
    foreground: '#1F2328',
    card: '#FFFFFF',
    cardForeground: '#1F2328',
    muted: '#F2F3F5',
    mutedForeground: '#59636E',
    popover: '#FFFFFF',
    popoverForeground: '#1F2328',
    primary: '#1F2328',
    primaryForeground: '#FFFFFF',
    secondary: '#F2F3F5',
    secondaryForeground: '#1F2328',
    accent: '#FDF0E5',
    accentForeground: '#1F2328',
    border: '#E7E9EC',
    input: '#F2F3F5',
    ring: '#1F2328',
    midground: '#1F2328',
    midgroundForeground: '#FFFFFF',
    composerRing: '#D8DCE1',
    destructive: '#D1242F',
    destructiveForeground: '#FFFFFF',
    sidebarBackground: '#F7F7F8',
    sidebarBorder: '#E7E9EC',
    userBubble: '#FDF0E5',
    userBubbleBorder: '#E7E9EC',
    accentBright: '#EA620E',
    info: '#0969DA',
    success: '#1A7F37',
    warning: '#9A6700'
  },
  darkColors: {
    background: '#0D1117',
    foreground: '#E6EAEE',
    card: '#161C24',
    cardForeground: '#E6EAEE',
    muted: '#0F141A',
    mutedForeground: '#99A3AD',
    popover: '#161C24',
    popoverForeground: '#E6EAEE',
    primary: '#E6EAEE',
    primaryForeground: '#0D1117',
    secondary: '#1A222C',
    secondaryForeground: '#E6EAEE',
    accent: 'rgba(242, 118, 15, 0.14)',
    accentForeground: '#E6EAEE',
    border: '#222B34',
    input: '#0F141A',
    ring: '#E6EAEE',
    midground: '#E6EAEE',
    midgroundForeground: '#0D1117',
    composerRing: '#2E3843',
    destructive: '#F85149',
    destructiveForeground: '#FFFFFF',
    sidebarBackground: '#10151C',
    sidebarBorder: '#222B34',
    userBubble: 'rgba(242, 118, 15, 0.14)',
    userBubbleBorder: '#222B34',
    accentBright: '#F2760F',
    info: '#4493F8',
    success: '#3FB950',
    warning: '#D29922'
  },
  terminal: {
    foreground: '#1F2328',
    cursor: '#1F2328',
    selectionBackground: '#D8DCE1',
    black: '#24292F',
    red: '#CF222E',
    green: '#1A7F37',
    yellow: '#9A6700',
    blue: '#0969DA',
    magenta: '#8250DF',
    cyan: '#1B7C83',
    white: '#6E7781',
    brightBlack: '#57606A',
    brightRed: '#A40E26',
    brightGreen: '#116329',
    brightYellow: '#7A5200',
    brightBlue: '#218BFF',
    brightMagenta: '#A475F9',
    brightCyan: '#3192AA',
    brightWhite: '#8C959F'
  },
  darkTerminal: {
    foreground: '#E6EAEE',
    cursor: '#E6EAEE',
    selectionBackground: '#2E3843',
    black: '#484F58',
    red: '#F85149',
    green: '#3FB950',
    yellow: '#D29922',
    blue: '#4493F8',
    magenta: '#BC8CFF',
    cyan: '#39C5CF',
    white: '#B1BAC4',
    brightBlack: '#6E7681',
    brightRed: '#FFA198',
    brightGreen: '#56D364',
    brightYellow: '#E3B341',
    brightBlue: '#79C0FF',
    brightMagenta: '#D2A8FF',
    brightCyan: '#56D4DD',
    brightWhite: '#FFFFFF'
  }
}

export const BUILTIN_THEMES: Record<string, DesktopTheme> = {
  // The shipped default leads the list: `BUILTIN_THEME_LIST` is the order the
  // settings gallery and `/skin` cycling read, and the skin the app ships with
  // belongs at the top of it (step 15 · T1).
  'fulilian-workbench': workbenchTheme,
  apricot: apricotTheme,
  nous: nousTheme,
  github: githubTheme,
  catppuccin: catppuccinTheme,
  everforest: everforestTheme,
  solarized: solarizedTheme,
  'nous-alt': nousAltTheme,
  midnight: midnightTheme,
  ember: emberTheme,
  mono: monoTheme,
  slate: slateTheme,
  cyberpunk: cyberpunkTheme
}

export const BUILTIN_THEME_LIST = Object.values(BUILTIN_THEMES)

/** Skin used when nothing is persisted or the persisted name is retired. */
export const DEFAULT_SKIN_NAME = 'fulilian-workbench'
