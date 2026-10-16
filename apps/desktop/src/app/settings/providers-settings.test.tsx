import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmHost } from '@/components/confirm-host'
import { $confirmRequest } from '@/store/confirm'
import type { EnvVarInfo, OAuthProvider } from '@/types/fulilian'

const listOAuthProviders = vi.fn()
const disconnectOAuthProvider = vi.fn()
const getEnvVars = vi.fn()
const startManualProviderOAuth = vi.fn()
const startManualLocalEndpoint = vi.fn()
const onboarding = atom({ manual: false })

vi.mock('@/fulilian', () => ({
  disconnectOAuthProvider: (providerId: string) => disconnectOAuthProvider(providerId),
  getEnvVars: () => getEnvVars(),
  listOAuthProviders: () => listOAuthProviders()
}))

vi.mock('@/store/onboarding', () => ({
  $desktopOnboarding: onboarding,
  startManualProviderOAuth: (providerId: string) => startManualProviderOAuth(providerId),
  startManualLocalEndpoint: (reason: null | string) => startManualLocalEndpoint(reason)
}))

function provider(id: string, loggedIn: boolean, patch: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    cli_command: `fulilian auth add ${id}`,
    disconnectable: true,
    docs_url: '',
    flow: 'device_code',
    id,
    name: id === 'nous' ? 'Nous Portal' : 'MiniMax',
    status: {
      logged_in: loggedIn
    },
    ...patch
  }
}

// One `/api/env` row (an EnvVarInfo) for the API-keys view. Mirrors the
// `provider()` factory above: a valid base + per-test overrides, typed against
// the real response shape so it can't drift from EnvVarInfo.
function keyVar(patch: Partial<EnvVarInfo> = {}): EnvVarInfo {
  return {
    advanced: false,
    category: 'provider',
    description: '',
    is_password: true,
    is_set: false,
    provider: '',
    provider_label: '',
    redacted_value: null,
    tools: [],
    url: '',
    ...patch
  }
}

beforeEach(() => {
  onboarding.set({ manual: false })
  getEnvVars.mockResolvedValue({})
  disconnectOAuthProvider.mockResolvedValue({ ok: true, provider: 'nous' })
  listOAuthProviders.mockResolvedValue({
    providers: [provider('nous', true), provider('minimax-oauth', false)]
  })
})

afterEach(() => {
  cleanup()
  $confirmRequest.set(null)
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// Removal goes through confirm() from @/store/confirm, so the host has to be
// mounted for the prompt to render — same as in the real app shell.
async function renderProvidersSettings() {
  const { ProvidersSettings } = await import('./providers-settings')
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(
      <>
        <ProvidersSettings onClose={vi.fn()} onViewChange={vi.fn()} view="accounts" />
        <ConfirmHost />
      </>
    )
  })

  return result!
}

describe('ProvidersSettings', () => {
  it('disconnects a connected provider account and refreshes the accounts list', async () => {
    await renderProvidersSettings()

    const remove = await screen.findByRole('button', { name: 'Remove Nous Portal' })
    await act(async () => {
      fireEvent.click(remove)
    })

    // Removal is confirmed first — nothing has been disconnected yet.
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(disconnectOAuthProvider).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    })

    await waitFor(() => expect(disconnectOAuthProvider).toHaveBeenCalledWith('nous'))
    expect(listOAuthProviders).toHaveBeenCalledTimes(2)
  })

  it('leaves the account connected when the removal prompt is dismissed', async () => {
    await renderProvidersSettings()

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Remove Nous Portal' }))
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    })

    expect(disconnectOAuthProvider).not.toHaveBeenCalled()
  })

  it('keeps provider selection separate from account removal', async () => {
    await renderProvidersSettings()

    await act(async () => {
      fireEvent.click(await screen.findByText('Nous Portal'))
    })

    expect(startManualProviderOAuth).toHaveBeenCalledWith('nous')
    expect(disconnectOAuthProvider).not.toHaveBeenCalled()
  })

  it('does not offer removal for externally managed providers', async () => {
    listOAuthProviders.mockResolvedValue({
      providers: [
        provider('qwen-oauth', true, {
          cli_command: 'fulilian auth add qwen-oauth',
          disconnect_hint: "Use `fulilian auth add qwen-oauth` or that provider's CLI to remove it.",
          disconnectable: false,
          flow: 'external',
          name: 'Qwen (via Qwen CLI)'
        })
      ]
    })

    await renderProvidersSettings()

    expect(await screen.findByText('Qwen Code')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove Qwen Code' })).toBeNull()
    expect(screen.getByText(/managed by its own CLI/)).toBeTruthy()
  })

  it('renders a Keys card for a backend-tagged provider with no PROVIDER_GROUPS prefix', async () => {
    // A provider the backend catalog tags (provider/provider_label) but that has
    // no desktop PROVIDER_GROUPS prefix row must still render its own card —
    // this is the GUI/CLI drift fix: membership comes from the backend, not
    // from the hand-maintained prefix list.
    getEnvVars.mockResolvedValue({
      WIDGETAI_API_KEY: keyVar({
        provider: 'widgetai',
        provider_label: 'WidgetAI',
        url: 'https://widgetai.example/keys'
      })
    })
    listOAuthProviders.mockResolvedValue({ providers: [] })

    const { ProvidersSettings } = await import('./providers-settings')
    await act(async () => {
      render(<ProvidersSettings onClose={vi.fn()} onViewChange={vi.fn()} view="keys" />)
    })

    expect(await screen.findByText('WidgetAI')).toBeTruthy()
  })

  it('orders API-key providers by priority then name, and filters them via search', async () => {
    // These three providers have no curated PROVIDER_GROUPS priority, so they
    // share the default priority and fall back to alphabetical among themselves
    // (Acme, Middle, Zebra) — exercising the name tiebreak of the priority sort.
    getEnvVars.mockResolvedValue({
      ZEBRA_API_KEY: keyVar({ provider: 'zebra', provider_label: 'Zebra' }),
      ACME_API_KEY: keyVar({ provider: 'acme', provider_label: 'Acme' }),
      MIDDLE_API_KEY: keyVar({ provider: 'middle', provider_label: 'Middle' })
    })
    listOAuthProviders.mockResolvedValue({ providers: [] })

    const { ProvidersSettings } = await import('./providers-settings')
    render(<ProvidersSettings onClose={vi.fn()} onViewChange={vi.fn()} view="keys" />)

    // Equal priority → alphabetical tiebreak: Acme, Middle, Zebra.
    await screen.findByText('Acme')
    const labels = screen.getAllByText(/Acme|Middle|Zebra/).map(el => el.textContent)
    expect(labels).toEqual(['Acme', 'Middle', 'Zebra'])

    // Typing narrows the list to matching providers only.
    const search = screen.getByPlaceholderText('Search providers…')
    await act(async () => {
      fireEvent.change(search, { target: { value: 'mid' } })
    })

    await waitFor(() => expect(screen.queryByText('Acme')).toBeNull())
    expect(screen.getByText('Middle')).toBeTruthy()
    expect(screen.queryByText('Zebra')).toBeNull()

    // A non-matching query shows the empty-state copy.
    await act(async () => {
      fireEvent.change(search, { target: { value: 'nonesuch-xyz' } })
    })
    expect(await screen.findByText('No providers match your search.')).toBeTruthy()
  })

  it('offers a Local / custom endpoint entry in the API-keys tab that opens the custom-endpoint flow', async () => {
    // Regression: the composer pill and the providers "have an API key"
    // affordance both dead-end on the env-var-driven key catalog, which never
    // lists a custom endpoint — so without this row there is no reachable
    // Desktop GUI path to add one. See issue #62817.
    getEnvVars.mockResolvedValue({})
    listOAuthProviders.mockResolvedValue({ providers: [] })

    const { ProvidersSettings } = await import('./providers-settings')
    render(<ProvidersSettings onClose={vi.fn()} onViewChange={vi.fn()} view="keys" />)

    const row = await screen.findByText('Local / custom endpoint')
    expect(screen.getByText(/OpenAI-compatible endpoint/)).toBeTruthy()

    fireEvent.click(row)

    await waitFor(() => expect(startManualLocalEndpoint).toHaveBeenCalledWith(null))
  })
})

// Step 17 P18: the `!vars` loading state must mirror the shape the real render
// is about to show (the real render branches on hasOauth — accounts picker vs
// keys catalog), so the skeleton→real swap fills the pane in rather than
// replacing it wholesale.
describe('ProvidersSettings loading skeletons (step 17 P18)', () => {
  function hangEnvVars() {
    getEnvVars.mockReturnValue(new Promise(() => {}))
  }

  it('accounts view with OAuth providers shows the picker shape — no search field', async () => {
    hangEnvVars()
    // beforeEach seeds one connected + one unconnected provider, so the real
    // render would show the accounts picker.
    const { ProvidersSettings } = await import('./providers-settings')
    const { container } = render(<ProvidersSettings onClose={vi.fn()} onViewChange={vi.fn()} view="accounts" />)

    // oauthProviders starts empty and resolves async, so the first paint is
    // the keys-shaped skeleton; it flips to the picker shape once the list
    // lands (while vars is still hanging). Wait out the flip.
    await waitFor(() => {
      expect(screen.getByTestId('providers-skeleton').className).toContain('grid gap-2')
    })
    const skeleton = screen.getByTestId('providers-skeleton')
    // Same section container as OAuthPicker: section.mb-5.grid.gap-2.
    expect(skeleton.className).toContain('mb-5')

    // Picker rows are rounded row cards; no search input anywhere.
    expect(skeleton.querySelectorAll('.rounded-\\[6px\\], .rounded-\\[8px\\]').length).toBeGreaterThanOrEqual(5)
    expect(container.querySelector('input')).toBeNull()

    // Same page gutters as the real SettingsContent.
    const scrollBody = container.querySelector('section > div')
    expect(scrollBody?.className).toContain('pb-20')
  })

  it('accounts view without OAuth providers falls to the keys shape, like the real render', async () => {
    hangEnvVars()
    listOAuthProviders.mockResolvedValue({ providers: [] })

    const { ProvidersSettings } = await import('./providers-settings')
    const { container } = render(<ProvidersSettings onClose={vi.fn()} onViewChange={vi.fn()} view="accounts" />)

    // The real render shows the keys catalog when there is nothing to pick —
    // the loading shape must branch the same way (LocalEndpointRow over the
    // key-card stack, search field present).
    await screen.findByTestId('providers-skeleton')
    expect(container.querySelectorAll('[data-testid="providers-skeleton"] .rounded-\\[6px\\]').length).toBeGreaterThanOrEqual(5)
  })

  it('keys view shows the keys shape: endpoint row, search field, key cards', async () => {
    hangEnvVars()
    listOAuthProviders.mockResolvedValue({ providers: [] })

    const { ProvidersSettings } = await import('./providers-settings')
    const { container } = render(<ProvidersSettings onClose={vi.fn()} onViewChange={vi.fn()} view="keys" />)

    await screen.findByTestId('providers-skeleton')

    // The key cards reuse ProviderKeyRows' @2xl label/control column split —
    // read via the cards' own grid container (grid gap-2, 4 cards).
    const cards = container.querySelector('[data-testid="providers-skeleton"] .grid.gap-2')
    expect(cards?.children.length).toBe(4)
    expect(cards?.firstElementChild?.className).toContain('@2xl:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)]')

    // LocalEndpointRow leads the real keys render; the skeleton mirrors it.
    const skeleton = screen.getByTestId('providers-skeleton')
    expect(skeleton.firstElementChild?.className).toContain('grid-cols-[minmax(0,1fr)_auto]')
  })

  it('custom-endpoints view delegates to its own loading state instead of the generic skeleton', async () => {
    hangEnvVars()

    const { ProvidersSettings } = await import('./providers-settings')
    const { container } = render(<ProvidersSettings onClose={vi.fn()} onViewChange={vi.fn()} view="custom-endpoints" />)

    // CustomEndpointsSettings owns its env-vars fetch and loading skeleton;
    // the outer `!vars` gate must not swallow it (its skeleton has no
    // providers-skeleton marker).
    await waitFor(() => {
      expect(container.querySelector('[data-testid="providers-skeleton"]')).toBeNull()
    })
  })
})
