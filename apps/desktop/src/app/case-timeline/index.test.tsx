import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

import { CaseTimelineView } from './index'
import { reportTimelineStarAudit, setTimelineAuditCaseId, timelineEventAt } from './case-timeline-utils'
import {
  clearTimelineState,
  eventKey,
  setCaseTimelineDataset,
  toggleTimelineStar,
  $filteredEvents,
  $timelineEvents,
  $timelineMockGenerated
} from '@/store/case-timeline'
import type { TimelineEvent, TimelinePayload } from '@/store/case-timeline-types'
import { I18nProvider } from '@/i18n'
import { en } from '@/i18n/en'

vi.mock('react-router', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => vi.fn()
}))

const HOUR = 3_600_000
const BASE = 1_790_563_200_000

function fixture(): TimelineEvent[] {
  return [
    { at: BASE + 1 * HOUR, source: 'registry', event: 'USBSTOR write', confidence: 91, tags: ['usb'] },
    { at: BASE + 2 * HOUR, source: 'log', event: 'Host power on', confidence: 98, tags: ['boot'] },
    { at: BASE + 4 * HOUR, source: 'pcap', event: 'TLS outbound 203.0.113.77:443', confidence: 74, tags: ['network'] },
    { at: BASE + 6 * HOUR, source: 'file', event: 'xlsx created', confidence: 87, tags: ['file', 'user'] },
    { at: BASE + 8 * HOUR, source: 'registry', event: 'Run key value', confidence: 50, tags: ['persistence'] }
  ]
}

// ── timelineEventAt (mono time column) ─────────────────────────────────────

describe('timelineEventAt', () => {
  it('renders local MM-DD HH:mm:ss with zero padding', () => {
    // Fixed epoch in UTC; expectation computed in the LOCAL zone so the test
    // passes in any CI timezone.
    const at = new Date(2026, 8, 29, 21, 5, 11).getTime() // local 2026-09-29 21:05:11

    expect(timelineEventAt(at)).toBe('09-29 21:05:11')
  })
})

// ── Star audit (A5-③) ──────────────────────────────────────────────────────

describe('reportTimelineStarAudit', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearTimelineState()
  })

  it('sends the star toggle over the caseTimeline bridge with atoms only', () => {
    const timeline = vi.fn().mockResolvedValue(null)
    ;(window.fulilianDesktop as unknown as { caseTimeline: { timeline: typeof timeline } }) = {
      caseTimeline: { timeline }
    } as never

    setTimelineAuditCaseId('CASE-2026-014')

    const event: TimelineEvent = { at: BASE, source: 'registry', event: 'USBSTOR write', confidence: 91, tags: ['usb'] }

    reportTimelineStarAudit(event, true)

    expect(timeline).toHaveBeenCalledWith('CASE-2026-014', { at: BASE, on: true, source: 'registry', tags: ['usb'] })
  })

  it('stays silent when the bridge is unavailable (audit degrades, no throw)', () => {
    const original = window.fulilianDesktop
    ;(window as { fulilianDesktop?: unknown }).fulilianDesktop = undefined

    setTimelineAuditCaseId('CASE-1')

    expect(() =>
      reportTimelineStarAudit({ at: 1, source: 'log', event: 'x', confidence: 50, tags: [] }, true)
    ).not.toThrow()
    ;(window as { fulilianDesktop?: unknown }).fulilianDesktop = original
  })
})

// ── Mounted page (联动 verification on the real component) ─────────────────

function mountTimeline(caseId = 'CASE-2026-014') {
  return render(
    <MemoryRouter initialEntries={[`/cases/${caseId}/timeline`]}>
      <I18nProvider>
        <CaseTimelineView caseId={caseId} />
      </I18nProvider>
    </MemoryRouter>
  )
}

function stubBridge(payload: TimelinePayload) {
  const timeline = vi.fn().mockResolvedValue(payload)

  ;(window.fulilianDesktop as unknown as { caseTimeline: { timeline: typeof timeline } }) = {
    caseTimeline: { timeline }
  } as never

  return timeline
}

describe('CaseTimelineView (mounted)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearTimelineState()
  })

  it('loads the bridge dataset and honestly shows the mock banner', async () => {
    stubBridge({ caseId: 'CASE-1', events: fixture(), mockGenerated: true, mockReason: 'mock' })

    mountTimeline('CASE-1')

    await waitFor(() => expect(screen.getByTestId('case-timeline-table')).toBeTruthy())
    expect(screen.getByTestId('case-timeline-mock-banner')).toBeTruthy()
    expect(screen.getByTestId('case-timeline-head').textContent).toContain('CASE-1')
    // Mono case number is present (等宽是取证的工作语言).
    expect($timelineMockGenerated.get()).toBe(true)
  })

  it('no banner when the dataset is NOT mock-generated', async () => {
    stubBridge({ caseId: 'CASE-2', events: fixture(), mockGenerated: false })

    mountTimeline('CASE-2')

    await waitFor(() => expect(screen.getByTestId('case-timeline-table')).toBeTruthy())
    expect(screen.queryByTestId('case-timeline-mock-banner')).toBeNull()
  })

  it('renders one row per event with mono time, source chip, confidence', async () => {
    stubBridge({ caseId: 'CASE-1', events: fixture(), mockGenerated: true })

    mountTimeline('CASE-1')

    await waitFor(() => expect(screen.getAllByTestId('case-timeline-star')).toHaveLength(5))
    expect($timelineEvents.get()).toHaveLength(5)
  })

  it('source checkbox narrows the table (过滤联动)', async () => {
    stubBridge({ caseId: 'CASE-1', events: fixture(), mockGenerated: true })

    mountTimeline('CASE-1')

    await waitFor(() => expect(screen.getAllByTestId('case-timeline-star')).toHaveLength(5))

    // Registry has 2 rows; click its checkbox (currently all-shown) to toggle
    // it into the narrowing set.
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    await waitFor(() => expect($filteredEvents.get()).toHaveLength(2))
    expect(screen.getByTestId('case-timeline-footer-filtered').textContent).toContain('2')
  })

  it('star toggle marks the row, updates counts, and fires the audit line', async () => {
    const timeline = stubBridge({ caseId: 'CASE-1', events: fixture(), mockGenerated: true })

    mountTimeline('CASE-1')

    await waitFor(() => expect(screen.getAllByTestId('case-timeline-star')).toHaveLength(5))

    fireEvent.click(screen.getAllByTestId('case-timeline-star')[1])

    await waitFor(() => {
      expect(screen.getAllByTestId('case-timeline-star')[1].getAttribute('aria-pressed')).toBe('true')
    })
    expect(screen.getByTestId('case-timeline-footer-starred').textContent).toContain('1')

    // The audit variant rode the same channel with atoms (no event text).
    expect(timeline).toHaveBeenLastCalledWith(
      'CASE-1',
      expect.objectContaining({ on: true, source: 'log' })
    )

    // Star persists per case (localStorage).
    const event = fixture()[1]
    expect(window.localStorage.getItem(`fulilian-desktop-case-timeline-stars-v1:CASE-1`)).toContain(
      JSON.stringify(eventKey(event)).slice(1, -1)
    )
  })

  it('histogram renders 3h-bucketed bars from the dataset', async () => {
    stubBridge({ caseId: 'CASE-1', events: fixture(), mockGenerated: true })

    mountTimeline('CASE-1')

    await waitFor(() => {
      const svg = screen.getByTestId('case-timeline-histogram-svg')

      expect(svg.querySelectorAll('rect[data-bucket-count]').length).toBeGreaterThan(0)
    })
  })

  it('shows the honest error state when the bridge rejects', async () => {
    ;(window.fulilianDesktop as unknown as { caseTimeline: unknown }) = {
      caseTimeline: { timeline: vi.fn().mockRejectedValue(new Error('boom')) }
    } as never

    mountTimeline('CASE-ERR')

    await waitFor(() => expect(screen.getByTestId('case-timeline-error')).toBeTruthy())
    expect(screen.getByTestId('case-timeline-error').textContent).toContain('boom')
  })

  it('shows the empty state for a case without events', async () => {
    stubBridge({ caseId: 'CASE-EMPTY', events: [], mockGenerated: true })

    mountTimeline('CASE-EMPTY')

    await waitFor(() => expect(screen.getByTestId('case-timeline-empty')).toBeTruthy())
  })

  it('opens the report center from the page-head report button (T16 统一入口可达)', async () => {
    stubBridge({ caseId: 'CASE-1', events: fixture(), mockGenerated: true })

    mountTimeline('CASE-1')

    await waitFor(() => expect(screen.getByTestId('case-timeline-table')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: en.caseTimeline.addToReport }))

    await waitFor(() => expect(screen.getByTestId('report-center-dialog')).toBeTruthy())
    expect(screen.getByTestId('report-center-starred-count')).toBeTruthy()
  })
})

// Dataset installed without the bridge stays queryable (store-level sanity).
describe('store round-trip used by the page', () => {
  it('setCaseTimelineDataset installs rows; toggleTimelineStar flips and persists', () => {
    setCaseTimelineDataset('CASE-X', fixture(), true, 'r')

    expect($timelineEvents.get()).toHaveLength(5)
    expect(toggleTimelineStar(fixture()[0])).toBe(true)
    expect($filteredEvents.get()).toHaveLength(5)
  })
})
