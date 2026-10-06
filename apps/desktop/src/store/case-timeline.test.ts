import { beforeEach, describe, expect, it } from 'vitest'

import {
  $confidenceFilter,
  $dragSelection,
  $filteredEvents,
  $histogramBuckets,
  $sourceFilter,
  $starredKeys,
  $starredOnly,
  $tagFilter,
  $timelineEvents,
  $timelineMockGenerated,
  $timelineSummary,
  clearTimelineState,
  eventKey,
  filterTimelineEvents,
  type TimelineFilterState,
  HISTOGRAM_BUCKET_MS,
  histogramBuckets,
  normalizeDragSpan,
  resetTimelineFilters,
  setCaseTimelineDataset,
  setConfidenceFilter,
  setDragSelection,
  setRangeFilter,
  setSourceFilter,
  setStarredOnly,
  setTimelineCase,
  starredEvents,
  toggleSource,
  toggleTag,
  toggleTimelineStar
} from './case-timeline'
import type { TimelineEvent } from './case-timeline-types'

const HOUR = 60 * 60 * 1000

// Deterministic fixture: three 3h clusters, four sources, tags spread so
// every filter axis has something to bite on.
function fixture(): TimelineEvent[] {
  const base = 1_790_563_200_000 // 2026-09-28T00:00:00Z

  return [
    { at: base + 1 * HOUR, source: 'registry', event: 'USBSTOR write', confidence: 91, tags: ['usb'] },
    { at: base + 2 * HOUR, source: 'log', event: 'Host power on', confidence: 98, tags: ['boot'] },
    { at: base + 4 * HOUR, source: 'pcap', event: 'TLS outbound', confidence: 74, tags: ['network'] },
    { at: base + 6 * HOUR, source: 'file', event: 'xlsx created', confidence: 87, tags: ['file', 'user'] },
    { at: base + 8 * HOUR, source: 'registry', event: 'Run key value', confidence: 50, tags: ['persistence'] }
  ]
}

beforeEach(() => {
  window.localStorage.clear()
  clearTimelineState()
})

describe('filterTimelineEvents (pure)', () => {
  it('empty filter axes return every event', () => {
    expect(filterTimelineEvents(fixture(), {})).toHaveLength(5)
  })

  it('source narrowing: selected set keeps only those sources', () => {
    const rows = filterTimelineEvents(fixture(), { sources: new Set(['registry']) })

    expect(rows.map(row => row.source)).toEqual(['registry', 'registry'])
  })

  it('empty source set does not narrow (all sources shown)', () => {
    expect(filterTimelineEvents(fixture(), { sources: new Set() })).toHaveLength(5)
  })

  it('time range is inclusive on both ends', () => {
    const base = 1_790_563_200_000

    expect(
      filterTimelineEvents(fixture(), { range: { from: base + 2 * HOUR, to: base + 4 * HOUR } })
    ).toHaveLength(2)
  })

  it('drag span narrows inclusively (联动: 拖选范围过滤)', () => {
    const base = 1_790_563_200_000

    expect(
      filterTimelineEvents(fixture(), { drag: { from: base + 3 * HOUR, to: base + 6 * HOUR } })
    ).toHaveLength(2)
  })

  it('confidence filter is a >= floor', () => {
    expect(filterTimelineEvents(fixture(), { confidenceMin: 87 })).toHaveLength(3)
  })

  it('tag narrowing requires EVERY selected tag (AND semantics)', () => {
    expect(filterTimelineEvents(fixture(), { tags: new Set(['file']) })).toHaveLength(1)
    expect(filterTimelineEvents(fixture(), { tags: new Set(['file', 'user']) })).toHaveLength(1)
    expect(filterTimelineEvents(fixture(), { tags: new Set(['file', 'usb']) })).toHaveLength(0)
  })

  it('starredOnly keeps only starred events (星标联动)', () => {
    const events = fixture()
    const starred = new Set([eventKey(events[2])])

    expect(filterTimelineEvents(events, { starredKeys: starred, starredOnly: true })).toEqual([events[2]])
    expect(filterTimelineEvents(events, { starredKeys: starred, starredOnly: false })).toHaveLength(5)
  })

  it('axes compose: source + confidence + starred together', () => {
    const events = fixture()
    const filter: TimelineFilterState = {
      confidenceMin: 60,
      drag: null,
      range: { from: null, to: null },
      sources: new Set(['registry', 'log']),
      starredKeys: new Set([eventKey(events[0])]),
      starredOnly: true,
      tags: new Set()
    }

    expect(filterTimelineEvents(events, filter)).toEqual([events[0]])
  })
})

describe('histogramBuckets (3h aggregation)', () => {
  it('aggregates onto the fixed 3h grid with exact counts', () => {
    const buckets = histogramBuckets(fixture())

    // Bucket grid anchors at epoch multiples of 3h (computed, not literal, so
    // the assertion reads as grid math rather than magic numbers).
    expect(buckets).toEqual([
      { at: Math.floor((1_790_563_200_000 + 1 * HOUR) / HISTOGRAM_BUCKET_MS) * HISTOGRAM_BUCKET_MS, count: 2 },
      { at: Math.floor((1_790_563_200_000 + 4 * HOUR) / HISTOGRAM_BUCKET_MS) * HISTOGRAM_BUCKET_MS, count: 2 },
      { at: Math.floor((1_790_563_200_000 + 8 * HOUR) / HISTOGRAM_BUCKET_MS) * HISTOGRAM_BUCKET_MS, count: 1 }
    ])
  })

  it('buckets are ascending and bucket starts are grid-aligned', () => {
    const buckets = histogramBuckets(fixture())

    for (let index = 1; index < buckets.length; index++) {
      expect(buckets[index].at).toBeGreaterThan(buckets[index - 1].at)
    }

    for (const bucket of buckets) {
      expect(bucket.at % HISTOGRAM_BUCKET_MS).toBe(0)
    }
  })

  it('empty dataset yields no buckets', () => {
    expect(histogramBuckets([])).toEqual([])
  })
})

describe('drag span normalization', () => {
  it('keeps an ascending span as-is', () => {
    expect(normalizeDragSpan(10, 20)).toEqual({ from: 10, to: 20 })
  })

  it('flips a descending pointer drag', () => {
    expect(normalizeDragSpan(20, 10)).toEqual({ from: 10, to: 20 })
  })
})

describe('store mutations + derived stores', () => {
  it('toggleSource flips membership in the filter set', () => {
    toggleSource('pcap')
    expect($sourceFilter.get().has('pcap')).toBe(true)
    toggleSource('pcap')
    expect($sourceFilter.get().has('pcap')).toBe(false)
  })

  it('$filteredEvents recomputes across every axis', () => {
    setCaseTimelineDataset('CASE-2026-014', fixture(), false)

    expect($filteredEvents.get()).toHaveLength(5)

    setSourceFilter(new Set(['registry']))
    expect($filteredEvents.get()).toHaveLength(2)

    setConfidenceFilter(90)
    expect($filteredEvents.get()).toHaveLength(1)

    resetTimelineFilters()
    setRangeFilter(1_790_563_200_000, 1_790_563_200_000 + 2 * HOUR)
    expect($filteredEvents.get()).toHaveLength(2)

    resetTimelineFilters()
    setDragSelection({ from: 20, to: 10 })
    expect($dragSelection.get()).toEqual({ from: 10, to: 20 })
    expect($filteredEvents.get()).toHaveLength(0) // fixture lives in 2026, drag at epoch 10–20
  })

  it('toggleTag AND-narrows the derived rows', () => {
    setCaseTimelineDataset('CASE-2026-014', fixture(), false)

    toggleTag('file')
    toggleTag('user')
    expect($tagFilter.get().size).toBe(2)
    expect($filteredEvents.get()).toHaveLength(1)

    toggleTag('usb')
    expect($filteredEvents.get()).toHaveLength(0)
  })

  it('$histogramBuckets ignores confidence/tags/stars but honors time axes', () => {
    setCaseTimelineDataset('CASE-2026-014', fixture(), false)

    expect($histogramBuckets.get()).toHaveLength(3)

    // Non-time axes must NOT change the histogram.
    setConfidenceFilter(95)
    expect($histogramBuckets.get()).toHaveLength(3)

    // Time axes DO narrow it (drag 联动 visible in the histogram).
    resetTimelineFilters()
    setDragSelection({ from: 0, to: 1_790_563_200_000 + 3 * HOUR })
    expect($histogramBuckets.get()).toHaveLength(1)
  })

  it('$timelineSummary reports total, filtered, and starred counts', () => {
    setCaseTimelineDataset('CASE-2026-014', fixture(), false)

    toggleTimelineStar(fixture()[0])
    toggleTimelineStar(fixture()[3])
    setSourceFilter(new Set(['log']))

    expect($timelineSummary.get()).toEqual({
      eventCount: 5,
      filteredCount: 1,
      starredCount: 2
    })
  })

  it('setCaseTimelineDataset installs rows + provenance flags', () => {
    setCaseTimelineDataset('CASE-2026-014', fixture(), true, 'mock reason')

    expect($timelineEvents.get()).toEqual(fixture())
    expect($timelineMockGenerated.get()).toBe(true)
  })
})

describe('stars: persistence + data seam (A5-③/T16 seam)', () => {
  it('toggleTimelineStar persists per case in localStorage and restores on setTimelineCase', () => {
    setCaseTimelineDataset('CASE-A', fixture(), false)

    expect(toggleTimelineStar(fixture()[1])).toBe(true)
    expect($starredKeys.get().size).toBe(1)
    expect(window.localStorage.getItem('fulilian-desktop-case-timeline-stars-v1:CASE-A')).toContain(
      JSON.stringify(eventKey(fixture()[1])).slice(1, -1)
    )

    // Switching cases swaps the star set.
    setCaseTimelineDataset('CASE-B', fixture(), false)
    expect($starredKeys.get().size).toBe(0)

    setCaseTimelineDataset('CASE-A', fixture(), false)
    expect($starredKeys.get().size).toBe(1)
    expect($starredKeys.get().has(eventKey(fixture()[1]))).toBe(true)
  })

  it('toggle off removes the key and the persisted entry shrinks', () => {
    setCaseTimelineDataset('CASE-A', fixture(), false)

    toggleTimelineStar(fixture()[0])
    expect(toggleTimelineStar(fixture()[0])).toBe(false)
    expect($starredKeys.get().size).toBe(0)
    expect(window.localStorage.getItem('fulilian-desktop-case-timeline-stars-v1:CASE-A')).toBe('[]')
  })

  it('starredOnly derived rows and starredEvents() (T16 seam) stay consistent', () => {
    setCaseTimelineDataset('CASE-A', fixture(), false)

    toggleTimelineStar(fixture()[3])
    toggleTimelineStar(fixture()[0])

    setStarredOnly(true)
    expect($filteredEvents.get().map(row => row.event)).toEqual([fixture()[0].event, fixture()[3].event])

    expect(starredEvents().map(row => row.event)).toEqual([fixture()[0].event, fixture()[3].event])
    expect(starredEvents()[0].at).toBeLessThan(starredEvents()[1].at)

    setStarredOnly(false)
    expect($filteredEvents.get()).toHaveLength(5)
  })

  it('clearTimelineState drops dataset and filters; stars stay per case', () => {
    setCaseTimelineDataset('CASE-A', fixture(), false)

    toggleTimelineStar(fixture()[0])
    clearTimelineState()

    expect($filteredEvents.get()).toEqual([])
    expect($starredOnly.get()).toBe(false)
    expect($confidenceFilter.get()).toBe(0)
    expect($timelineMockGenerated.get()).toBe(false)

    setCaseTimelineDataset('CASE-A', [], false)
    expect($starredKeys.get().size).toBe(1)
  })
})
