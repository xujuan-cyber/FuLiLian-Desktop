// Sidebar subnav enums for the settings pages that mix a static enum with the
// component (keys / providers). This module exists so `settings/index.tsx` can
// keep the enums eager — the rail's subnav items need them on the first frame —
// WITHOUT statically importing the component modules themselves. A static
// `import('./keys-settings')` for `KEYS_VIEWS` pulls the whole component
// closure (and for providers, `@/components/onboarding` too) into the settings
// entry chunk, silently defeating the lazy() boundaries below it (N-5: the
// first-open byte weight measured ~35 KB of non-active-tab code per open).
//
// The component modules re-export these for backwards compatibility, so
// `import('./keys-settings')` keeps working for the lazy pair and tests.

// Sub-views surfaced as sidebar subnav under Tools & Keys (see settings/index.tsx).
export const KEYS_VIEWS = ['tools', 'settings'] as const

export type KeysView = (typeof KEYS_VIEWS)[number]

// Sub-views surfaced as a sidebar subnav: account sign-in vs raw API keys.
export const PROVIDER_VIEWS = ['accounts', 'keys', 'custom-endpoints'] as const

export type ProviderView = (typeof PROVIDER_VIEWS)[number]
