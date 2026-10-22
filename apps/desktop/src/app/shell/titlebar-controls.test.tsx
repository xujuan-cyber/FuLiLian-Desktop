import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { TitlebarControls } from './titlebar-controls'

// P1-4: the titlebar used to render a <button> inside a <button>
// ("In HTML, <button> cannot be a descendant of <button>"), which React refuses
// to hydrate sanely and which breaks keyboard / screen-reader semantics. Every
// titlebar cluster must be button-flat: no button descendant of another button.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

afterEach(cleanup)

function renderTitlebar(children: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <I18nProvider configClient={null} initialLocale="en">
        {children}
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('TitlebarControls', () => {
  it('renders no button nested inside a button', () => {
    const { container } = renderTitlebar(<TitlebarControls onOpenSettings={() => {}} />)

    expect(container.querySelectorAll('button').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('button button').length).toBe(0)
  })

  it('keeps an onSelect tool button-flat', () => {
    const { container } = renderTitlebar(
      <TitlebarControls
        onOpenSettings={() => {}}
        tools={[
          { icon: <span data-testid="pane-tool" />, id: 'pane-tool', label: 'Pane tool', onSelect: () => {} }
        ]}
      />
    )

    expect(container.querySelector('[data-testid="pane-tool"]')).toBeTruthy()
    expect(container.querySelectorAll('button button').length).toBe(0)
  })

  it('renders an href tool as a single anchor, not a button wrapping an anchor', () => {
    const { container } = renderTitlebar(
      <TitlebarControls
        leftTools={[
          { href: 'https://example.com/x', icon: <span data-testid="link-tool" />, id: 'link-tool', label: 'Link tool' }
        ]}
        onOpenSettings={() => {}}
      />
    )

    expect(container.querySelectorAll('button button').length).toBe(0)
    expect(container.querySelectorAll('button a').length).toBe(0)

    const link = container.querySelector('a[href="https://example.com/x"]')

    expect(link).toBeTruthy()
    expect(link?.querySelector('[data-testid="link-tool"]')).toBeTruthy()
  })
})
