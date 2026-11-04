import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { formatCombo } from '@/lib/keybinds/combo'
import { $bindings } from '@/store/keybinds'

import { ChatSidebar } from './index'

// The sidebar pulls its contributed rows (none in tests) and its boot gate;
// both are stubbed so the render only exercises the built-in nav.
vi.mock('@/contrib/react/use-contributions', () => ({ useContributions: vi.fn(() => []) }))
vi.mock('@/store/boot', () => ({ $desktopBoot: atom({ running: false }) }))

const noop = () => {}

const asyncNoop = async () => {}

function renderSidebar() {
  const onNavigate = vi.fn()

  // defaultOpen={false} collapses the provider state, which is what un-hides
  // the SidebarMenuButton tooltip content (hidden={state !== 'collapsed'}).
  render(
    <MemoryRouter>
      <SidebarProvider defaultOpen={false}>
        <ChatSidebar
          currentView="chat"
          onArchiveSession={noop}
          onBranchSession={noop}
          onDeleteSession={noop}
          onLoadMoreSessions={noop}
          onManageCronJob={asyncNoop}
          onNavigate={onNavigate}
          onNewSessionInWorkspace={noop}
          onNewSessionSplit={noop}
          onResumeSession={noop}
          onTriggerCronJob={asyncNoop}
        />
      </SidebarProvider>
    </MemoryRouter>
  )

  return onNavigate
}

beforeEach(() => {
  // Deterministic combo for the keybind-hint tooltip (same seed as rail.test.tsx).
  $bindings.set({ ...$bindings.get(), 'view.showTerminal': ['ctrl+`'] })
})

afterEach(() => {
  cleanup()
})

describe('ChatSidebar terminal nav row', () => {
  it('renders the Terminal row immediately after Connectors in the nav menu', () => {
    renderSidebar()

    const navMenu = screen.getByText('Connectors').closest('ul')

    expect(navMenu).not.toBeNull()

    const rows = within(navMenu!).getAllByRole('button').map(row => row.textContent)
    const connectorsIndex = rows.findIndex(row => row?.includes('Connectors'))

    expect(connectorsIndex).toBeGreaterThanOrEqual(0)
    expect(rows[connectorsIndex + 1]).toContain('Terminal')
  })

  it('keeps the Terminal row in the primary area while the More overflow is closed', () => {
    renderSidebar()

    // The More row is collapsed by default ($sidebarNavMoreOpen); a row folded
    // into the overflow would not be in the DOM at all until it is expanded.
    expect(screen.getByRole('button', { name: 'Terminal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^More/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('dispatches the reveal-terminal action payload on click', () => {
    const onNavigate = renderSidebar()

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal', action: 'reveal-terminal' }))
  })

  it('mounts the keybind-hint tooltip for view.showTerminal on hover', async () => {
    renderSidebar()

    // Radix opens the tooltip on pointer entry; the hint then renders the
    // label plus the formatted combo from $bindings.
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Terminal' }), { pointerType: 'mouse' })
    const content = await screen.findByRole('tooltip')

    expect(content.getAttribute('data-slot')).toBe('tooltip-content')
    expect(content.textContent).toContain('Terminal')
    expect(content.textContent).toContain(formatCombo('ctrl+`'))
  })
})
