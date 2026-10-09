import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FulilianGateway } from '@/fulilian'
import { $gateway } from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'

import { ChatRoutesSurface } from './surfaces'
import type { WiringActions } from './types'

vi.mock('@/contrib/react/use-contributions', () => ({ useContributions: vi.fn() }))
vi.mock('@/store/connections', () => ({ $activeConnectionId: atom('local') }))
vi.mock('@/store/gateway', () => ({ $gateway: atom<unknown>(null) }))
vi.mock('@/store/profile', () => ({ $activeGatewayProfile: atom('default') }))
vi.mock('@/store/session', () => ({
  $freshDraftReady: atom(false),
  $gatewayState: atom('open')
}))
vi.mock('../chat', () => ({
  ChatView: ({ gateway }: { gateway: { id?: string } | null }) => <div data-testid="gateway">{gateway?.id}</div>
}))
vi.mock('../chat/sidebar', () => ({ ChatSidebar: () => null }))
vi.mock('../right-sidebar/terminal/chrome', () => ({ TerminalPaneChrome: () => null }))
vi.mock('../shell/hooks/use-status-snapshot', () => ({ useStatusSnapshot: () => ({}) }))
vi.mock('../shell/hooks/use-statusbar-items', () => ({
  useStatusbarItems: () => ({ leftStatusbarItems: [], statusbarItems: [] })
}))
vi.mock('../shell/statusbar-controls', () => ({ StatusbarControls: () => null }))
vi.mock('../routes', () => ({
  contributedRoutes: () => [],
  NEW_CHAT_ROUTE: '/new',
  ROUTES_AREA: 'routes',
  sessionRoute: (id: string) => `/${id}`
}))
vi.mock('./latest-actions', () => ({ latestChatActions: () => ({}), latestSidebarActions: () => ({}) }))
vi.mock('./panes', () => ({ setStatusbarItemGroup: vi.fn(), useStatusbarContributions: () => [] }))
vi.mock('../shell/model-menu-panel', () => ({ ModelMenuPanel: () => null }))

afterEach(() => {
  cleanup()
  $gateway.set(null)
  $activeGatewayProfile.set('default')
})

describe('ChatRoutesSurface', () => {
  it('passes the live gateway after an open-to-open profile switch', async () => {
    const gatewayA = { id: 'a' } as unknown as FulilianGateway
    const gatewayB = { id: 'b' } as unknown as FulilianGateway

    $gateway.set(gatewayA)
    const actions = { getGateway: () => $gateway.get() } as unknown as WiringActions

    render(
      <MemoryRouter>
        <ChatRoutesSurface actions={actions} />
      </MemoryRouter>
    )

    // P9b: the chat route is lazy now, so the first paint is the Suspense
    // fallback — the view resolves a tick later (see the source-text test below
    // for the wiring half, which the runtime half cannot see).
    expect((await screen.findByTestId('gateway')).textContent).toBe('a')

    act(() => {
      $gateway.set(gatewayB)
      $activeGatewayProfile.set('other')
    })

    await waitFor(() => {
      expect(screen.getByTestId('gateway').textContent).toBe('b')
    })
  })

  it('defers the chat view through lazy() instead of importing it eagerly', () => {
    // Read the module's text: a `lazy()` boundary does not suspend observably
    // under happy-dom + the synchronous `../chat` mock above, so only the
    // wiring can tell an eager import from a deferred one.
    const src = readFileSync(join(process.cwd(), 'src/app/contrib/surfaces.tsx'), 'utf8')

    expect(src).toContain("lazy(async () => ({ default: (await import('../chat')).ChatView }))")
    // The old eager form must be gone — this is the P9b pin.
    expect(src).not.toMatch(/^import \{ ChatView \} from '\.\.\/chat'$/m)
    // And the deferred element is wrapped so the swap stays in the pane.
    expect(src).toMatch(/<Route element=\{page\(chatView\)\} index \/>/)
  })

  it('keeps BOTH chat pins lazy — either one left eager re-pins the subtree', () => {
    // P9b's decisive finding: `surfaces.tsx` and `chat/session-tile.tsx` are two
    // PARALLEL pins on `chat/index` (the tile is reached eagerly through
    // controller.tsx → watchSessionTiles). Cutting only one is a no-op that
    // measured NET NEGATIVE on the first attempt; only cutting both moved the
    // chat subtree — and katex/vendor-md — out of the entry chunk. This test is
    // the regression anchor for that "AND" relationship: revert either side and
    // it goes red (there is otherwise no coverage — no test renders SessionTile).
    const tile = readFileSync(join(process.cwd(), 'src/app/chat/session-tile.tsx'), 'utf8')

    expect(tile).toContain("lazy(async () => ({ default: (await import('./index')).ChatView }))")
    expect(tile).not.toMatch(/^import \{ ChatView \} from '\.'$/m)
    // The deferred view resolves inside the tile's own boundary.
    expect(tile).toMatch(/<Suspense fallback=\{null\}>[\s\S]*?<ChatView[\s\S]*?<\/Suspense>/)
  })
})
