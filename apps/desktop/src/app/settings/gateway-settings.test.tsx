import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getConnectionConfig = vi.fn()
const saveConnectionConfig = vi.fn()

// This test owns the machine-level GatewaySettings contract. The managed SSH
// update section mounted below the registry has its own focused coverage
// (store/managed-updates.test.ts); keep its store subscriptions out of this
// single-purpose test.
vi.mock('./managed-updates-section', () => ({ ManagedUpdatesSection: () => null }))

const localConnection = {
  cloudOrg: '',
  envOverride: false,
  mode: 'local',
  remoteAuthMode: 'token',
  remoteOauthConnected: false,
  remoteTokenPreview: null,
  remoteTokenSet: false,
  remoteUrl: ''
}

beforeEach(() => {
  getConnectionConfig.mockResolvedValue(localConnection)
  saveConnectionConfig.mockResolvedValue(localConnection)
  Object.defineProperty(window, 'fulilianDesktop', {
    configurable: true,
    value: { getConnectionConfig, saveConnectionConfig }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GatewaySettings', () => {
  it('loads the machine-level connection config (no profile scoping)', async () => {
    const { GatewaySettings } = await import('./gateway-settings')

    render(<GatewaySettings />)
    expect(await screen.findByText('Local gateway')).toBeTruthy()
    expect(
      screen.getByText('Start a private Fulilian backend on localhost. This is the default and works offline.')
    ).toBeTruthy()

    // The page manages the machine's gateway connections; it must load the
    // global config, never a per-profile override.
    await waitFor(() => expect(getConnectionConfig).toHaveBeenCalledWith(null))
    expect(getConnectionConfig).not.toHaveBeenCalledWith(expect.any(String))

    // The legacy per-profile scope switcher must not render.
    expect(screen.queryByText('Applies to')).toBeNull()
    expect(screen.queryByText('All profiles')).toBeNull()
    expect(screen.queryByText('Use default gateway')).toBeNull()
  })

  it('loading skeleton mirrors the local-mode page shape (step 17 P18)', async () => {
    // Hang the config fetch so the skeleton stays mounted.
    getConnectionConfig.mockReturnValue(new Promise(() => {}))

    const { GatewaySettings } = await import('./gateway-settings')
    const { container } = render(<GatewaySettings />)

    const skeleton = await screen.findByTestId('gateway-skeleton')
    // The mode section: same section container as the real render, caption
    // heading over the responsive 4-card grid (grid-cols-1 / sm:2 / min:4).
    expect(skeleton.className).toContain('mb-5 grid gap-2')
    const cardsGrid = skeleton.querySelector('.grid')
    expect(cardsGrid?.className).toContain('grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2 min-[72rem]:grid-cols-4')
    expect(cardsGrid?.children).toHaveLength(4)

    // The real page always leads with the title block (non-embedded), so the
    // skeleton's first child inside the scroll container must be that block,
    // with the mode section right after it — not a heading+rows run.
    const scrollBody = container.querySelector('section > div')
    expect(scrollBody?.firstElementChild?.className).toContain('mb-5')
    expect(scrollBody?.firstElementChild?.nextElementSibling).toBe(skeleton)

    // Same page gutters as the real (non-embedded) SettingsContent.
    expect(scrollBody?.className).toContain('pb-20')
    expect(scrollBody?.className).toContain('px-[clamp(1.25rem,4vw,4rem)]')

    // And the real content has not landed yet.
    expect(screen.queryByText('Local gateway')).toBeNull()
  })

  it('embedded loading skeleton drops the title block and renders bare (step 17 P18)', async () => {
    getConnectionConfig.mockReturnValue(new Promise(() => {}))

    const { GatewaySettings } = await import('./gateway-settings')
    const { container } = render(<GatewaySettings embedded />)

    await screen.findByTestId('gateway-skeleton')

    // Embedded trims the page chrome: no title block, so the mode section is
    // the first element inside the scroll container.
    const scrollBody = container.querySelector('section > div')
    expect(scrollBody?.firstElementChild?.getAttribute('data-testid')).toBe('gateway-skeleton')

    // And the bare SettingsContent gutters (px-5 pb-6), not the page ones.
    expect(scrollBody?.className).toContain('px-5 pb-6')
    expect(scrollBody?.className).not.toContain('pb-20')
  })
})
