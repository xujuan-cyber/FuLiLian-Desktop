import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $activeSessionId } from '@/store/session'
import { $subagentsBySession, type SubagentProgress } from '@/store/subagents'

import { DelegateTool } from './delegate'

// No session-view mock: without a SessionViewProvider the card reads the
// PRIMARY view, whose $runtimeId is $activeSessionId. The slice store stays
// real too, so the join under test is the production one.
vi.mock('@/store/windows', async importActual => ({
  ...(await importActual<Record<string, unknown>>()),
  openSessionInNewWindow: vi.fn()
}))

afterEach(() => {
  cleanup()
  $subagentsBySession.set({})
  $activeSessionId.set('sess-1')
})

const subagent = (overrides: Partial<SubagentProgress>): SubagentProgress => ({
  filesRead: [],
  filesWritten: [],
  goal: '审查代码变更',
  id: 'sub-1',
  parentId: null,
  startedAt: 0,
  status: 'running',
  stream: [],
  taskCount: 1,
  taskIndex: 0,
  updatedAt: 0,
  ...overrides
})

function tree(ui: ReactNode, locale: 'en' | 'zh' = 'en') {
  return (
    <I18nProvider configClient={null} initialLocale={locale}>
      {ui}
    </I18nProvider>
  )
}

function renderDelegate(args: unknown, result?: unknown, locale: 'en' | 'zh' = 'en') {
  $activeSessionId.set('sess-1')

  return render(tree(<DelegateTool args={args} result={result} toolCallId="call-1" />, locale))
}

const REASON = '改动面横跨多模块，交给专职审查子模型'
const DEGRADED_EN = 'This subtask failed — the main agent takes it over from here.'

describe('DelegateTool — step 21 dispatch transparency', () => {
  it('shows a collapsible dispatch-reason line when the call carries one', () => {
    renderDelegate({ reason: REASON, tasks: [{ goal: 'Review the patch' }] })

    expect(screen.getByText('Dispatch reason')).toBeTruthy()
    // Collapsed by default: the reason appears once (the truncated header).
    expect(screen.getAllByText(REASON)).toHaveLength(1)

    const toggle = screen.getByRole('button', { name: /dispatch reason/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // Expanded: the full text renders again in the body.
    expect(screen.getAllByText(REASON)).toHaveLength(2)
  })

  it('renders zh copy for the reason line under the zh locale', async () => {
    renderDelegate({ reason: REASON, tasks: [{ goal: 'Review the patch' }] }, undefined, 'zh')

    // The zh catalog chunk lands asynchronously; the provider re-renders once
    // it is resident, so assert on the post-load frame.
    expect(await screen.findByText('派发理由')).toBeTruthy()
  })

  it('falls back to a live subagent-reported reason when the call args lack one', () => {
    $subagentsBySession.set({
      'sess-1': [subagent({ goal: 'Review the patch', reason: REASON, submodelId: 'code-reviewer' })]
    })

    renderDelegate({ tasks: [{ goal: 'Review the patch' }] })

    expect(screen.getByText('Dispatch reason')).toBeTruthy()
  })

  it('renders no reason line at all when no source carries one (legacy baseline)', () => {
    const { container } = renderDelegate({ tasks: [{ goal: 'Solo' }] }, { results: [{ status: 'ok', summary: 'done' }] })

    expect(screen.queryByText('Dispatch reason')).not.toBeTruthy()
    expect(screen.queryByText('派发理由')).not.toBeTruthy()
    expect(screen.queryByText(DEGRADED_EN)).not.toBeTruthy()
    // The card is rows only — no extra header row mounted.
    const card = container.querySelector('[data-delegate-card]')
    expect(card?.childElementCount).toBe(1)
  })

  it('shows the submodel profile badge on children dispatched via a profile', () => {
    $subagentsBySession.set({
      'sess-1': [subagent({ goal: 'Review the patch', submodelId: 'code-reviewer' })]
    })

    renderDelegate({ tasks: [{ goal: 'Review the patch' }] })

    const badge = screen.getByText('code-reviewer')
    expect(badge.getAttribute('title')).toBe('Dispatched to custom submodel')
  })

  it('shows no badge on plain delegations', () => {
    renderDelegate({ tasks: [{ goal: 'Solo' }] })

    expect(screen.queryByTitle('Dispatched to custom submodel')).not.toBeTruthy()
  })

  it('adds the failure/degrade note under a failed child', () => {
    renderDelegate(
      { tasks: [{ goal: 'Solo' }, { goal: 'Other' }] },
      { results: [{ status: 'failed', summary: 'nope' }, { status: 'ok', summary: 'fine' }] }
    )

    expect(screen.getByText(DEGRADED_EN)).toBeTruthy()
    expect(screen.getByText('nope')).toBeTruthy()
  })

  it('omits the degrade note on completed children', () => {
    renderDelegate({ tasks: [{ goal: 'Solo' }] }, { results: [{ status: 'ok', summary: 'fine' }] })

    expect(screen.queryByText(DEGRADED_EN)).not.toBeTruthy()
  })
})
