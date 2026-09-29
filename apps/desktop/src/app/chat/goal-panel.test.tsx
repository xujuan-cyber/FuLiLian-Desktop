import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $goalsBySession, type SessionGoal } from '@/store/goals'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'

import { GoalPanel } from './goal-panel'

// Behavioral assertions migrated from composer/status-stack/goal-indicator.test
// (step14 U5: the status stack's goal group converged into this panel) plus
// the R3 honesty contract: `calls` is labeled "Calls" (never "rounds"),
// elapsed is annotated "this launch", and a missing usage field renders "—".

const SID = 'sess-goal-1'

// Radix Popover positions itself with a ResizeObserver — jsdom has none.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const goal = (status: SessionGoal['status'], title = 'ship the feature', detail?: string): SessionGoal => ({
  detail,
  status,
  title,
  updatedAt: Date.now()
})

function renderPanel(sessionId: null | string = SID) {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <GoalPanel sessionId={sessionId} />
    </I18nProvider>
  )
}

const openDetails = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Session goal' }))
}

describe('GoalPanel', () => {
  beforeEach(() => {
    $goalsBySession.set({})
  })

  afterEach(() => {
    cleanup()
    clearAllSessionStates()
    $goalsBySession.set({})
  })

  it('renders nothing when the session has no goal', () => {
    const { container } = renderPanel()

    expect(container.firstChild).toBeNull()
  })

  it('scopes the panel to the goal-owning session', () => {
    $goalsBySession.set({ 'other-session': goal('active') })

    const { container } = renderPanel()

    expect(container.firstChild).toBeNull()
  })

  it('shows an active goal with its title', () => {
    $goalsBySession.set({ [SID]: goal('active') })

    renderPanel()

    expect(screen.getByText('Goal active')).toBeTruthy()
    expect(screen.getByText('ship the feature')).toBeTruthy()
  })

  it('labels a paused goal as paused', () => {
    $goalsBySession.set({ [SID]: goal('paused') })

    renderPanel()

    expect(screen.getByText('Goal paused')).toBeTruthy()
    expect(screen.getByText('ship the feature')).toBeTruthy()
  })

  it('shows the continuation detail line in the details popover', () => {
    $goalsBySession.set({ [SID]: goal('active', 'ship it', 'Continuing toward goal (3/20)') })

    renderPanel()
    openDetails()

    expect(screen.getByText('Continuing toward goal (3/20)')).toBeTruthy()
  })

  describe('honesty contract (R3 / A7)', () => {
    it('labels the call count "Calls" — never a round/iteration', () => {
      $goalsBySession.set({ [SID]: goal('active') })
      publishSessionState(SID, {
        ...createClientSessionState(SID),
        usage: { calls: 12, input: 1, output: 2, total: 3 }
      })

      renderPanel()
      openDetails()

      expect(screen.getByText('Calls')).toBeTruthy()
      expect(screen.getByText('12')).toBeTruthy()
      expect(screen.queryByText(/round|iteration|轮/i)).toBeNull()
    })

    it('annotates elapsed time as measured within this launch', () => {
      $goalsBySession.set({ [SID]: goal('active') })

      renderPanel()
      openDetails()

      expect(screen.getByText('Elapsed')).toBeTruthy()
      expect(screen.getByText('this launch')).toBeTruthy()
    })

    it('renders "—" for usage fields the backend has not reported', () => {
      $goalsBySession.set({ [SID]: goal('active') })

      // No session state published → no usage snapshot at all.
      renderPanel()
      openDetails()

      const dashes = screen.getAllByText('—')

      expect(dashes.length).toBeGreaterThanOrEqual(4)
    })

    it('renders the reported context percent', () => {
      $goalsBySession.set({ [SID]: goal('active') })
      publishSessionState(SID, {
        ...createClientSessionState(SID),
        usage: { calls: 1, input: 1, output: 1, total: 2, context_percent: 42.4 }
      })

      renderPanel()
      openDetails()

      expect(screen.getByText('42%')).toBeTruthy()
    })
  })

  it('drops the panel when the goal clears', () => {
    $goalsBySession.set({ [SID]: goal('active') })

    const view = renderPanel()

    expect(screen.getByText('ship the feature')).toBeTruthy()

    act(() => {
      $goalsBySession.set({})
    })

    expect(view.container.querySelector('[aria-label="Session goal"]')).toBeNull()
  })
})
