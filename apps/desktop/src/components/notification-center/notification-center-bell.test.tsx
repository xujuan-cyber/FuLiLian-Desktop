import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { clearNotificationCenter, ingestNotificationEntry, markNotificationRead } from '@/store/notification-center'
import { $quickCaptureNotes } from '@/store/quick-capture-inbox'
import { $cronSessions, $unreadFinishedSessionIds } from '@/store/session'

import { NotificationCenterBell } from './notification-center-bell'

// Radix Popover positions itself with a ResizeObserver — jsdom has none.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// jsdom lacks Element.prototype.scrollIntoView in some Radix paths.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})

function renderBell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <I18nProvider configClient={null} initialLocale="en">
        <NotificationCenterBell />
      </I18nProvider>
    </MemoryRouter>
  )
}

const entry = (id: string, group: 'approval' | 'automation' | 'system') => ({
  at: 1_000,
  body: `body ${id}`,
  group,
  id,
  title: `Title ${id}`
})

beforeEach(() => {
  clearNotificationCenter()
  $quickCaptureNotes.set([])
  $unreadFinishedSessionIds.set([])
  $cronSessions.set([])
})

afterEach(() => {
  cleanup()
  clearNotificationCenter()
  $quickCaptureNotes.set([])
  $unreadFinishedSessionIds.set([])
  $cronSessions.set([])
  window.localStorage.removeItem('fulilian:notification-center:read-ids:v1')
})

describe('NotificationCenterBell', () => {
  it('renders a titlebar bell with the localized label', () => {
    renderBell()

    const bell = screen.getByRole('button', { name: 'Notifications' })

    expect(bell).toBeTruthy()
    expect(bell.getAttribute('data-unread')).toBe('false')
  })

  it('shows the empty state when nothing is present', () => {
    renderBell()

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(screen.getByText('Nothing new — you are all caught up.')).toBeTruthy()
  })

  it('paints the unread dot and all three plan groups', () => {
    act(() => {
      // Derived 需审批 row — through the SAME tray snapshot chain.
      $quickCaptureNotes.set([])
      // Derived 自动化 row — unreadFinished ∩ cron.
      $cronSessions.set([{ id: 'c1', title: 'Nightly', ended_at: null, input_tokens: 0, is_active: false, last_active: 0, message_count: 1, model: null, output_tokens: 0 } as never])
      $unreadFinishedSessionIds.set(['c1'])
      // Pushed feed rows.
      ingestNotificationEntry(entry('e1', 'approval'))
      ingestNotificationEntry(entry('e2', 'system'))
    })

    renderBell()

    const bell = screen.getByRole('button', { name: 'Notifications' })

    expect(bell.getAttribute('data-unread')).toBe('true')

    fireEvent.click(bell)

    expect(screen.getByText('Needs approval')).toBeTruthy()
    expect(screen.getByText('Automation results')).toBeTruthy()
    expect(screen.getByText('System')).toBeTruthy()
    expect(screen.getByText('Title e1')).toBeTruthy()
    expect(screen.getByText('Title e2')).toBeTruthy()
    expect(screen.getByText('Nightly')).toBeTruthy()
  })

  it('marks a row read on click and persists the marker (已读持久化)', () => {
    act(() => {
      ingestNotificationEntry(entry('e1', 'automation'))
    })

    renderBell()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

    const row = screen.getByText('Title e1').closest('button')!

    expect(row.getAttribute('data-read')).toBe('false')

    fireEvent.click(row)

    expect(row.getAttribute('data-read')).toBe('true')
    expect(JSON.parse(window.localStorage.getItem('fulilian:notification-center:read-ids:v1') ?? '[]')).toContain('e1')
  })

  it('honours a pre-existing read marker on mount', () => {
    act(() => {
      ingestNotificationEntry(entry('e1', 'automation'))
      markNotificationRead('e1')
    })

    renderBell()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

    const row = screen.getByText('Title e1').closest('button')!

    expect(row.getAttribute('data-read')).toBe('true')
  })

  it('surfaces quick-capture notes in the 系统 group (T7 seam)', () => {
    act(() => {
      $quickCaptureNotes.set([{ at: '2026-01-01T00:00:00.000Z', id: 'n1', text: 'Check the OneDrive key' }])
    })

    renderBell()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(screen.getByText('Check the OneDrive key')).toBeTruthy()
    expect(screen.getByText('System')).toBeTruthy()
  })
})
