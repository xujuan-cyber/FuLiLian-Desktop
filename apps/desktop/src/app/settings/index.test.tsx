// Step 17 · P3b: the Settings shell lazy-loads its child views per tab. Two
// separate properties make the split worth having, and a refactor can silently
// undo either one, so both are pinned here:
//
//   1. Runtime shape — every tab route resolves *its own* chunk into the main
//      pane (the observable half; a broken route would render nothing).
//   2. Source wiring — the shell really uses `lazy()` for the 21 child views and
//      keeps the eager ones eager. This half has to be read off the module's
//      text: a `lazy()` boundary is *unobservable* under happy-dom, because the
//      mocked module promises settle on the same microtask queue as the render,
//      so React never actually suspends — a mutation that deletes the inner
//      `<Suspense>` still renders the child in time (measured on the step-17
//      A4 mutant: `config-resolved=true`, no boundary hit, no skeleton). Only
//      the wiring text can tell the two apart.
//
// The third half — that the shell chunk pulls in *no* child view module — is
// asserted against the build artifacts in the step-17 P3b receipt (per-view
// `settings-*.js` chunks), not in a unit test.
//
// `mountShell()` is awaited *plainly*, not inside `act()`: a lazily-started
// import can suspend during render, and wrapping the render in an `async act`
// wedges the pending module promise.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { stubResizeObserver } from '@/test/jsdom'

// One trivial marker per child view: enough to prove the tab route resolved its
// lazy chunk, cheap enough that the split's real payload never enters the test.
// `./keys-settings` and `./providers-settings` also export the nav enums that
// must stay eager, so those two pass the real module through and only swap the
// component.
vi.mock('./about-settings', () => ({ AboutSettings: () => <div data-view="about" /> }))
vi.mock('./approvals-permissions-settings', () => ({
  ApprovalsPermissionsSettings: () => <div data-view="approvals" />
}))
vi.mock('./appearance-settings', () => ({ AppearanceSettings: () => <div data-view="appearance" /> }))
vi.mock('./audit-settings', () => ({ AuditSettings: () => <div data-view="audit" /> }))
vi.mock('./billing', () => ({ BillingSettings: () => <div data-view="billing" /> }))
vi.mock('./config-settings', () => ({ ConfigSettings: () => <div data-view="config" /> }))
vi.mock('./ctf-settings', () => ({ CtfSettings: () => <div data-view="ctf" /> }))
vi.mock('./evidence-protection-settings', () => ({
  EvidenceProtectionSettings: () => <div data-view="evidence" />
}))
vi.mock('./forensics-settings', () => ({ ForensicsSettings: () => <div data-view="forensics" /> }))
vi.mock('./gateway-settings', () => ({ GatewaySettings: () => <div data-view="gateway" /> }))
vi.mock('./keybind-settings', () => ({ KeybindSettings: () => <div data-view="keybind" /> }))
vi.mock('./keys-settings', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  KeysSettings: () => <div data-view="keys" />
}))
vi.mock('./notifications-settings', () => ({
  NotificationsSettings: () => <div data-view="notifications" />
}))
vi.mock('./pet-settings', () => ({ PetSettings: () => <div data-view="pet" /> }))
vi.mock('./plugins-settings', () => ({ PluginsSettings: () => <div data-view="plugins" /> }))
vi.mock('./presets-settings', () => ({ PresetsSettings: () => <div data-view="presets" /> }))
vi.mock('./providers-settings', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  ProvidersSettings: () => <div data-view="providers" />
}))
vi.mock('./quick-entry-settings', () => ({ QuickEntrySettings: () => <div data-view="quick-entry" /> }))
vi.mock('./sensitive-info-settings', () => ({
  SensitiveInfoSettings: () => <div data-view="sensitive-info" />
}))
vi.mock('./sessions-settings', () => ({ SessionsSettings: () => <div data-view="sessions" /> }))
vi.mock('./tray-settings', () => ({ TraySettings: () => <div data-view="tray" /> }))

// Awaited plainly (see the file header): the suspension must stay observable
// to `findBy*` rather than being trapped inside an `async act`.
async function mountShell(tab?: string) {
  const { SettingsView } = await import('./index')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <MemoryRouter initialEntries={[tab ? `/settings?tab=${tab}` : '/settings']}>
      <QueryClientProvider client={client}>
        <I18nProvider configClient={null} initialLocale="en">
          {/* data-view rides a shell-owned wrapper rather than the view modules
              themselves: it survives the view's own root markup and lets the
              assertion read which chunk resolved. */}
          <div data-testid="settings-view" data-view={tab ?? 'config:model'}>
            <SettingsView onClose={() => undefined} />
          </div>
        </I18nProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  stubResizeObserver()
})

afterEach(() => {
  cleanup()
})

describe('SettingsView tab shell (step 17 · P3b)', () => {
  it('resolves every tab route into its own chunk in the main pane', async () => {
    // [route tab, marker the lazy chunk must resolve to]
    const tabs: [string, string][] = [
      ['config:model', 'config'],
      ['about', 'about'],
      ['config:appearance', 'appearance'],
      ['presets', 'presets'],
      ['gateway', 'gateway'],
      ['keys', 'keys'],
      ['providers', 'providers'],
      ['sessions', 'sessions']
    ]

    for (const [tab, marker] of tabs) {
      cleanup()
      await mountShell(tab)

      // The shell's own wrapper is mounted...
      const shell = await screen.findByTestId('settings-view').catch(() => null)
      expect(shell?.getAttribute('data-view')).toBe(tab)

      // ...the tab's own lazy chunk resolves into it (async — the chunk lands
      // a few ticks after the synchronous render flushes).
      await waitFor(() => {
        expect(shell?.querySelector('[data-view]')?.getAttribute('data-view')).toBe(marker)
      })
    }
  })

  it('wires every child view through lazy() and keeps the nav enums eager', () => {
    // Read the shell's own text: this is the assertion the runtime half cannot
    // make (see the file header — a lazy boundary does not suspend under
    // happy-dom, so deleting it would leave property 1 green).
    const src = readFileSync(join(process.cwd(), 'src/app/settings/index.tsx'), 'utf8')

    // Only the 21 view modules are split; no stray `lazy(` elsewhere.
    expect(src.match(/\blazy\(/g)).toHaveLength(21)

    // Each split view keeps its original specifier — a rename or a re-static
    // import would drop the count above, but pin a few of the shapes that
    // matter (a plain view, a config section, and the two enum-bearing pages).
    expect(src).toContain("import('./about-settings')")
    expect(src).toContain("import('./config-settings')")
    expect(src).toContain("import('./keys-settings')")
    expect(src).toContain("import('./providers-settings')")

    // The enum-bearing modules must stay *statically* imported too: their
    // exports are used synchronously for nav, so a lazy-only import would
    // break the enum surface (and P3b's A5④ pin). Both forms coexist.
    expect(src).toMatch(/^import \{[^}]*KEYS_VIEWS[^}]*\} from '\.\/keys-settings'$/m)
    expect(src).toMatch(/^import \{[^}]*PROVIDER_VIEWS[^}]*\} from '\.\/providers-settings'$/m)

    // The split is pointless without a boundary holding the swap inside the
    // pane: the shell's own <Suspense> around `activeSettingsContent`.
    expect(src).toMatch(/<Suspense[\s\S]*?\{activeSettingsContent\}\s*<\/Suspense>/)
  })
})
