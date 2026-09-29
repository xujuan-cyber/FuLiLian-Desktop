import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $goalsBySession, type SessionGoal } from '@/store/goals'

import { ComposerStatusStack } from './index'

// Step14 U5: the standing goal CONVERGED out of the composer status stack —
// the resident GoalPanel (app/chat/goal-panel.tsx) owns goal display now.
// This file is the regression guard for that convergence: a session with a
// goal must NOT paint a goal group here anymore. The goal indicator's
// behavioral assertions (title, status labels, session scoping) migrated to
// app/chat/goal-panel.test.tsx.

// The stack measures itself into a surface var — jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const SID = 'sess-goal-1'

const goal = (status: SessionGoal['status'], title = 'ship the feature', detail?: string): SessionGoal => ({
  detail,
  status,
  title,
  updatedAt: Date.now()
})

function renderStack(sessionId: null | string = SID) {
  return render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <ComposerStatusStack queue={null} sessionId={sessionId} />
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('ComposerStatusStack goal convergence (U5)', () => {
  beforeEach(() => {
    $goalsBySession.set({})
  })

  afterEach(() => {
    cleanup()
    $goalsBySession.set({})
  })

  it('renders nothing when the session has no goal', () => {
    const view = renderStack()

    expect(view.container.firstChild).toBeNull()
  })

  it('does NOT render a goal group for a session with an active goal', () => {
    $goalsBySession.set({ [SID]: goal('active') })

    const view = renderStack()

    expect(view.container.firstChild).toBeNull()
    expect(screen.queryByText('Goal active')).toBeNull()
  })

  it('does NOT render a goal group for a paused goal either', () => {
    $goalsBySession.set({ [SID]: goal('paused') })

    const view = renderStack()

    expect(screen.queryByText('Goal paused')).toBeNull()
  })

  it('still renders other status groups beside a goal', () => {
    $goalsBySession.set({ [SID]: goal('active') })

    const view = renderStack()

    // No goal label anywhere in the stack.
    expect(screen.queryByText(/Goal (active|paused|done|waiting)/)).toBeNull()

    return view.unmount()
  })
})
