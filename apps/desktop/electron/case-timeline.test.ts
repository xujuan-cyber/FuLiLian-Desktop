import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  auditAtom,
  formatTimelineStarAuditLine,
  MOCK_TIMELINE_EPOCH,
  MOCK_TIMELINE_REASON,
  mockCtfImportEvents,
  mockTimelineFor,
  TIMELINE_CSV_HEADER,
  TIMELINE_STAR_AUDIT_MARKER,
  timelineToCsv
} from './case-timeline'
import type { TimelineEvent, TimelinePayload } from './case-timeline'

// Harness capturing ipcMain.handle registrations so each channel's handler is
// invoked directly — no electron runtime involved. Hoisted so the vi.mock
// factory below can close over the same vi.fn.
const { ipcHandle, ipcLog } = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  ipcLog: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: ipcHandle } }))

function registeredHandlers(): Map<string, (event: unknown, payload?: unknown) => unknown> {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()

  for (const call of ipcHandle.mock.calls) {
    handlers.set(call[0] as string, call[1] as (event: unknown, payload?: unknown) => unknown)
  }

  return handlers
}

function handle(channel: string, ...args: unknown[]): unknown {
  const handler = registeredHandlers().get(channel)

  if (!handler) {
    throw new Error(`channel not registered: ${channel}`)
  }

  return handler({}, ...args)
}

beforeEach(() => {
  ipcHandle.mockClear()
  ipcLog.mockClear()
})

describe('mockTimelineFor', () => {
  it('is deterministic: same caseId, same rows (time/source/confidence stable)', () => {
    const first = mockTimelineFor({ caseId: 'CASE-2026-014', count: 12, startAt: MOCK_TIMELINE_EPOCH })
    const second = mockTimelineFor({ caseId: 'CASE-2026-014', count: 12, startAt: MOCK_TIMELINE_EPOCH })

    expect(first).toEqual(second)
  })

  it('differing caseIds produce differing datasets', () => {
    const a = mockTimelineFor({ caseId: 'CASE-2026-014', count: 12, startAt: MOCK_TIMELINE_EPOCH })
    const b = mockTimelineFor({ caseId: 'CASE-2026-015', count: 12, startAt: MOCK_TIMELINE_EPOCH })

    expect(a).not.toEqual(b)
  })

  it('every event carries the full { at, source, event, confidence, tags[] } shape', () => {
    const events = mockTimelineFor({ caseId: 'CASE-2026-014', count: 20, startAt: MOCK_TIMELINE_EPOCH })

    expect(events).toHaveLength(20)

    for (const event of events) {
      expect(Number.isFinite(event.at)).toBe(true)
      expect(['registry', 'log', 'pcap', 'file']).toContain(event.source)
      expect(typeof event.event).toBe('string')
      expect(event.event.length).toBeGreaterThan(0)
      expect(event.confidence).toBeGreaterThanOrEqual(1)
      expect(event.confidence).toBeLessThanOrEqual(99)
      expect(Array.isArray(event.tags)).toBe(true)
    }
  })

  it('events are sorted by time ascending', () => {
    const events = mockTimelineFor({ caseId: 'CASE-2026-014', count: 30, startAt: MOCK_TIMELINE_EPOCH })

    for (let index = 1; index < events.length; index++) {
      expect(events[index].at).toBeGreaterThanOrEqual(events[index - 1].at)
    }
  })

  it('sources spread across more than one chip (histogram/filter need distribution)', () => {
    const events = mockTimelineFor({ caseId: 'CASE-2026-014', count: 40, startAt: MOCK_TIMELINE_EPOCH })
    const sources = new Set(events.map(event => event.source))

    expect(sources.size).toBeGreaterThan(1)
  })

  it('timestamps step by roughly the 3h aggregate stride (buckets non-degenerate)', () => {
    const events = mockTimelineFor({ caseId: 'CASE-2026-014', count: 10, startAt: MOCK_TIMELINE_EPOCH })
    const span = events[events.length - 1].at - events[0].at

    // 10 events × ~3h stride ⇒ span must exceed 12h.
    expect(span).toBeGreaterThan(12 * 60 * 60 * 1000)
  })
})

describe('timelineToCsv', () => {
  it('always emits the fixed header row (A5-② pinned column names)', () => {
    expect(timelineToCsv([])).toBe(TIMELINE_CSV_HEADER)
    expect(TIMELINE_CSV_HEADER).toBe('at_iso,source,event,confidence,tags')
  })

  it('serializes rows in column order with ISO timestamps and ;-joined tags', () => {
    const csv = timelineToCsv([{ at: 0, source: 'log', event: 'Host power on', confidence: 98, tags: ['boot'] }])
    const lines = csv.split('\r\n')

    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('1970-01-01T00:00:00.000Z,log,Host power on,98,boot')
  })

  it('quotes cells containing commas, quotes, or newlines (RFC 4180)', () => {
    const csv = timelineToCsv([
      { at: 0, source: 'file', event: 'D:\\log.csv, created', confidence: 50, tags: ['a,b'] }
    ])

    expect(csv).toContain('"D:\\log.csv, created"')
    expect(csv).toContain('"a;b"'.replace('a;b', 'a,b'))
  })
})

describe('star audit line (T7 desktop.log precedent)', () => {
  it('formats a structured line without event content', () => {
    const line = formatTimelineStarAuditLine({ caseId: 'CASE-2026-014', on: true, source: 'registry', tags: ['usb'] })

    expect(line).toBe(`${TIMELINE_STAR_AUDIT_MARKER} case=CASE-2026-014 action=star source=registry tags=usb`)
  })

  it('unstar and missing tags render with stable atoms', () => {
    const line = formatTimelineStarAuditLine({ caseId: 'CASE-1', on: false })

    expect(line).toBe(`${TIMELINE_STAR_AUDIT_MARKER} case=CASE-1 action=unstar source=unknown tags=-`)
  })

  it('log-sanitizes hostile input (no injection through caseId/tags)', () => {
    const line = formatTimelineStarAuditLine({ caseId: 'X\n[boom] action=fake', on: true })

    expect(line).not.toContain('\n')
    expect(line).toBe(`${TIMELINE_STAR_AUDIT_MARKER} case=X_boom_action_fake action=star source=unknown tags=-`)
  })

  it('returns null without a case id (audit-mandatory discipline like T7)', () => {
    expect(formatTimelineStarAuditLine({ caseId: '', on: true })).toBeNull()
    expect(
      formatTimelineStarAuditLine({ caseId: undefined as unknown as string, on: true })
    ).toBeNull()
  })

  it('auditAtom caps length and folds non-word chars', () => {
    expect(auditAtom('a b:c/d', 'x')).toBe('a_b:c_d')
    expect(auditAtom('', 'fallback')).toBe('fallback')
    expect(auditAtom('y'.repeat(100), 'x')).toHaveLength(64)
  })
})

describe('mockCtfImportEvents', () => {
  it('seeds 3–6 deterministic events tagged for the challenge', () => {
    const first = mockCtfImportEvents({ caseId: 'CASE-1', challenge: 'ROP Gadget' })
    const second = mockCtfImportEvents({ caseId: 'CASE-1', challenge: 'ROP Gadget' })

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThanOrEqual(3)
    expect(first.length).toBeLessThanOrEqual(6)

    for (const event of first) {
      expect(event.event).toContain('ROP Gadget')
    }
  })
})

describe('registerCaseTimelineIpc', () => {
  it('registers exactly the two channels', async () => {
    const { registerCaseTimelineIpc } = await import('./case-timeline')

    registerCaseTimelineIpc({ log: () => {} })

    expect([...registeredHandlers().keys()].sort()).toEqual(['ctf:importEvent', 'forensics:timeline'])
  })

  it('forensics:timeline returns an honestly-marked mock payload by default', async () => {
    const { registerCaseTimelineIpc } = await import('./case-timeline')

    registerCaseTimelineIpc({ log: ipcLog })

    const payload = handle('forensics:timeline', 'CASE-2026-014') as TimelinePayload

    expect(payload.caseId).toBe('CASE-2026-014')
    expect(payload.mockGenerated).toBe(true)
    expect(payload.mockReason).toBe(MOCK_TIMELINE_REASON)
    expect(payload.events.length).toBeGreaterThan(0)
    expect(ipcLog).toHaveBeenCalledWith(expect.stringContaining('[case-timeline] mock dataset served'))
  })

  it('forensics:timeline rejects an empty case id', async () => {
    const { registerCaseTimelineIpc } = await import('./case-timeline')

    registerCaseTimelineIpc({ log: () => {} })

    expect(() => handle('forensics:timeline', '   ')).toThrow('requires a case id')
  })

  it('forensics:timeline with a star-audit payload logs the structured line and returns null', async () => {
    const { registerCaseTimelineIpc } = await import('./case-timeline')

    registerCaseTimelineIpc({ log: ipcLog })

    const result = handle('forensics:timeline', 'CASE-2026-014', {
      at: 123,
      on: true,
      source: 'registry',
      tags: ['usb']
    })

    expect(result).toBeNull()
    expect(ipcLog).toHaveBeenCalledWith(
      `${TIMELINE_STAR_AUDIT_MARKER} case=CASE-2026-014 action=star source=registry tags=usb`
    )
  })

  it('forensics:timeline star-audit never carries event text (atoms only)', async () => {
    const { registerCaseTimelineIpc } = await import('./case-timeline')

    registerCaseTimelineIpc({ log: ipcLog })

    handle('forensics:timeline', 'CASE-1', {
      at: 1,
      on: false,
      source: 'pcap',
      tags: ['network']
    })

    const line = ipcLog.mock.calls[0][0] as string

    expect(line).toContain('action=unstar')
    expect(line).not.toContain('event=')
  })

  it('forensics:timeline prefers an injected producer (real-pipeline seam)', async () => {
    const { registerCaseTimelineIpc } = await import('./case-timeline')

    registerCaseTimelineIpc({
      log: () => {},
      produceTimeline: caseId => ({
        caseId,
        events: [{ at: 1, source: 'pcap', event: 'real row', confidence: 80, tags: ['network'] }],
        mockGenerated: false
      })
    })

    const payload = handle('forensics:timeline', 'CASE-9') as TimelinePayload

    expect(payload.mockGenerated).toBe(false)
    expect(payload.mockReason).toBeUndefined()
    expect(payload.events[0].event).toBe('real row')
  })

  it('ctf:importEvent seeds deterministic import events; malformed payload rejects', async () => {
    const { registerCaseTimelineIpc } = await import('./case-timeline')

    registerCaseTimelineIpc({ log: () => {} })

    const events = handle('ctf:importEvent', { caseId: 'CASE-1', challenge: 'Web Basics' }) as TimelineEvent[]

    expect(events.length).toBeGreaterThan(0)
    expect(events).toEqual(mockCtfImportEvents({ caseId: 'CASE-1', challenge: 'Web Basics' }))

    expect(() => handle('ctf:importEvent', { caseId: '', challenge: 'x' })).toThrow('requires')
    expect(() => handle('ctf:importEvent', { caseId: 'c', challenge: '' })).toThrow('requires')
  })
})
