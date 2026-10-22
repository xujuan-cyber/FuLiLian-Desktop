// Report-center store tests (step 16 · T16). Pins the section-template
// schema (writeup.py 对齐), the honest-empty rules, and the real-data-source
// contract of the draft assembly.

import { beforeEach, describe, expect, it } from 'vitest'

import { clearTimelineState, setCaseTimelineDataset, toggleTimelineStar } from './case-timeline'
import type { TimelineEvent } from './case-timeline-types'
import {
  $reportCaseId,
  $reportExport,
  buildAuditJsonl,
  buildReportMarkdown,
  clearReportExportState,
  currentReportMarkdown,
  findingsLines,
  openReportCenter,
  sectionsWithData,
  setReportExportBusy,
  setReportExportError
} from './report-center'

const HOUR = 3_600_000
/** Fixed anchor so expectations never drift with the wall clock (the electron
 *  bridge's own BASE shape — a stable Monday 09:00 UTC). */
const BASE = 1_790_563_200_000

function fixture(): TimelineEvent[] {
  return [
    { at: BASE + 1 * HOUR, source: 'registry', event: 'USBSTOR write', confidence: 91, tags: ['usb'] },
    { at: BASE + 2 * HOUR, source: 'log', event: 'Host power on', confidence: 98, tags: ['boot'] },
    { at: BASE + 4 * HOUR, source: 'pcap', event: 'TLS outbound', confidence: 74, tags: ['network'] }
  ]
}

beforeEach(() => {
  window.localStorage.clear()
  clearTimelineState()
  clearReportExportState()
})

// ── Section template (T16-2, writeup.py schema 对齐) ───────────────────────

describe('sectionsWithData', () => {
  it('exposes the writeup.py-aligned section order (summary/timeline/findings/artifacts/flags)', () => {
    expect(sectionsWithData({ hasTimeline: true }).map(section => section.id)).toEqual([
      'summary',
      'timeline',
      'findings',
      'artifacts',
      'flags'
    ])
  })

  it('only the timeline section carries data this round; the rest are honest empties', () => {
    const sections = sectionsWithData({ hasTimeline: true })

    expect(sections.find(section => section.id === 'timeline')?.hasData).toBe(true)

    for (const id of ['summary', 'findings', 'artifacts', 'flags']) {
      expect(sections.find(section => section.id === id)?.hasData).toBe(false)
    }
  })

  it('an empty dataset marks the timeline section empty too (不伪造章节内容)', () => {
    expect(sectionsWithData({ hasTimeline: false }).every(section => !section.hasData)).toBe(true)
  })
})

// ── Draft assembly (T16-5: real data only) ─────────────────────────────────

describe('buildReportMarkdown', () => {
  it('renders the meta header block with the case id (mono 案号)', () => {
    const md = buildReportMarkdown({ caseId: 'CASE-2026-014', starred: [] })

    expect(md.startsWith('# 取证报告 CASE-2026-014')).toBe(true)
    expect(md).toContain('- **案件**: `CASE-2026-014`')
  })

  it('sections without data render the honest empty mark — never fabricated content', () => {
    const md = buildReportMarkdown({ caseId: 'CASE-1', starred: [] })

    expect(md).toContain('## Summary')
    expect(md).toContain('## Timeline')
    expect(md).toContain('## Findings')
    expect(md).toContain('## Artifacts')
    expect(md).toContain('## Flags')
    // 空态标记 + 无伪造：no invented hash/evidence text.
    expect((md.match(/（本节暂无内容）/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(md).not.toMatch(/sha256[:=][0-9a-f]{8}/i)
  })

  it('lists starred events in the Timeline section with time/source/confidence/tags atoms', () => {
    const md = buildReportMarkdown({ caseId: 'CASE-1', starred: fixture() })
    const timeline = md.split('## Timeline')[1]?.split('## Findings')[0] ?? ''

    expect(timeline).toContain('registry')
    expect(timeline).toContain('confidence 91%')
    expect(timeline).toContain('[usb]')
    // Findings section stays an honest empty (no data layer this round).
    expect(md.split('## Findings')[1]).toContain('（本节暂无内容）')
  })

  it('findingsLines renders one bullet per event with sorted-atom content', () => {
    // Expectation computed in the LOCAL zone so the test passes in any CI
    // timezone (case-timeline's timelineEventAt convention).
    const at = new Date(2026, 8, 29, 21, 5, 11).getTime()

    const lines = findingsLines([{ at, source: 'log', event: 'x', confidence: 98, tags: ['boot', 'usb'] }])

    expect(lines).toEqual(['- 2026-09-29 21:05:11 · log · confidence 98% [boot, usb]'])
  })
})

// ── Export action state ─────────────────────────────────────────────────────

describe('export action state', () => {
  it('busy tracks the in-flight kind and clears', () => {
    setReportExportBusy('pdf')

    expect($reportExport.get().busy).toBe('pdf')

    setReportExportBusy(null)

    expect($reportExport.get().busy).toBeNull()
  })

  it('error records the last failure message and clears independently of busy', () => {
    setReportExportBusy('csv')
    setReportExportError('dialog canceled')

    expect($reportExport.get()).toEqual({ busy: 'csv', lastError: 'dialog canceled' })

    clearReportExportState()

    expect($reportExport.get()).toEqual({ busy: null, lastError: null })
  })
})

// ── The T13 seam end-to-end (starredEvents → draft) ─────────────────────────

describe('currentReportMarkdown (T13 starredEvents() seam)', () => {
  it('reflects the live starred set of the loaded case', () => {
    setCaseTimelineDataset('CASE-SEAM', fixture(), true, 'mock')
    openReportCenter('CASE-SEAM')

    expect($reportCaseId.get()).toBe('CASE-SEAM')

    const before = currentReportMarkdown()

    expect(before).toContain('（本节暂无内容）')

    toggleTimelineStar(fixture()[0])
    toggleTimelineStar(fixture()[2])

    const after = currentReportMarkdown()

    expect(after).toContain('registry')
    expect(after).toContain('pcap')
    expect(after).not.toContain('Host power on') // unstarred rows stay out
  })
})

// ── Audit JSONL export (A5-①③ 逐行合法 JSON) ───────────────────────────────

describe('buildAuditJsonl', () => {
  it('emits one VALID JSON object per line — raw log markers ride an envelope', () => {
    const jsonl = buildAuditJsonl(
      ['[2026-10-06T01:03:00Z] [fulilian] [report-export:audit] case=C1 action=pdf outcome=written chars=900'],
      [{ action: 'starred-findings', at: 1_790_563_200_000, count: 2, source: 'report-star' }]
    )

    const lines = jsonl.trimEnd().split('\n')

    expect(lines).toHaveLength(2)

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }

    const [marker, record] = lines.map(line => JSON.parse(line) as Record<string, unknown>)

    expect(marker.source).toBe('desktop-log')
    expect(String(marker.raw)).toContain('[report-export:audit]')
    expect(record.source).toBe('report-star')
    expect(record.count).toBe(2)
  })

  it('emits just a trailing newline for an empty audit set (no blank/bare lines)', () => {
    expect(buildAuditJsonl([], [])).toBe('\n')
  })
})
