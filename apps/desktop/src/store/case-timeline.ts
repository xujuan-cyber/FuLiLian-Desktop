// Case timeline page state (step 16 · T13, 方案 §5-T13).
//
// nanostores mirror of the timeline surface: the dataset fetched over the
// caseTimeline bridge, every filter axis (sources / time range / confidence /
// tags / drag-range / starred-only), the star set, and derived views (filtered
// rows, 3h histogram buckets, summary counts). Pure logic is exported for
// direct unit testing; the page subscribes through `useStore`.
//
// 口径：星标是本地分析标注（localStorage 持久化），落审计走 desktop.log
// 结构化标记行（electron/quick-entry.ts T7 先例；无结构化审计 store —— T8 已证
// 缺口，记回执）。星标同步进报告章节依赖 T16 报告管线，本 store 只留数据接缝
// （`starredEvents()`）。

import { atom, computed } from 'nanostores'

import { TIMELINE_EVENT_SOURCES, type TimelineEvent, type TimelinePayload, type TimelineSource } from '@/store/case-timeline-types'

export { TIMELINE_EVENT_SOURCES as TIMELINE_SOURCES }
export type { TimelineEvent, TimelinePayload, TimelineSource }

/** Histogram aggregation bucket (方案 §5-T13: 按 3h 聚合). */
export const HISTOGRAM_BUCKET_MS = 3 * 60 * 60 * 1000

/** localStorage key of the per-case star set: caseId → sorted event epoch list.
 *  An event's star identity is (at, source, event) — epoch+source+text — so a
 *  refetch that yields the same rows keeps its stars. */
const STAR_KEY_BASE = 'fulilian-desktop-case-timeline-stars-v1'

// ── State ────────────────────────────────────────────────────────────────────

export const $caseId = atom<string>('')
export const $timelineEvents = atom<TimelineEvent[]>([])
export const $timelineMockGenerated = atom<boolean>(false)
export const $timelineMockReason = atom<null | string>(null)
export const $timelineLoading = atom<boolean>(false)
export const $timelineError = atom<null | string>(null)

/** Sources the filter narrows to; empty set = ALL sources (no narrowing). */
export const $sourceFilter = atom<ReadonlySet<TimelineSource>>(new Set())

/** Inclusive time-range bounds (epoch ms); null = unbounded on that side. */
export const $rangeFilter = atom<{ from: null | number; to: null | number }>({ from: null, to: null })

/** Minimum confidence (0–100), inclusive. 0 = no floor. */
export const $confidenceFilter = atom<number>(0)

/** Tag chips the filter narrows to; empty set = no tag narrowing. An event
 *  matches when it carries EVERY selected tag. */
export const $tagFilter = atom<ReadonlySet<string>>(new Set())

/** Histogram drag-selection, inclusive on both ends (epoch ms); null when no
 *  drag is active. Selecting narrows the table (联动) but not the histogram. */
export const $dragSelection = atom<{ from: number; to: number } | null>(null)

/** Starred-only table toggle (左栏「已星标」chip). */
export const $starredOnly = atom<boolean>(false)

/** Per-case star set. Keyed by eventKey(event) (see below). */
export const $starredKeys = atom<ReadonlySet<string>>(new Set())

/** Stable star identity of an event: epoch + source + text. */
export function eventKey(event: Pick<TimelineEvent, 'at' | 'event' | 'source'>): string {
  return `${event.at}|${event.source}|${event.event}`
}

// ── Pure filters (unit-tested directly, A5-①) ──────────────────────────────

export interface TimelineFilterState {
  confidenceMin: number
  drag: { from: number; to: number } | null
  range: { from: null | number; to: null | number }
  sources: ReadonlySet<TimelineSource>
  starredKeys: ReadonlySet<string>
  starredOnly: boolean
  tags: ReadonlySet<string>
}

const NO_FILTER: TimelineFilterState = {
  confidenceMin: 0,
  drag: null,
  range: { from: null, to: null },
  sources: new Set(),
  starredKeys: new Set(),
  starredOnly: false,
  tags: new Set()
}

/**
 * Apply every filter axis to `events`. Order is fixed: sources → range →
 * drag → confidence → tags → starred. An empty source/tag set does not
 * narrow; range bounds are inclusive; drag range is inclusive on both ends;
 * confidence is `>=`.
 */
export function filterTimelineEvents(
  events: ReadonlyArray<TimelineEvent>,
  filter: Partial<TimelineFilterState>
): TimelineEvent[] {
  const sources = filter.sources
  const range = filter.range ?? NO_FILTER.range
  const drag = filter.drag ?? null
  const minConfidence = filter.confidenceMin ?? 0
  const tags = filter.tags
  const starredOnly = filter.starredOnly ?? false
  const starredKeys = filter.starredKeys

  return events.filter(event => {
    if (sources && sources.size > 0 && !sources.has(event.source)) {
      return false
    }

    if (range.from !== null && event.at < range.from) {
      return false
    }

    if (range.to !== null && event.at > range.to) {
      return false
    }

    if (drag && (event.at < drag.from || event.at > drag.to)) {
      return false
    }

    if (event.confidence < minConfidence) {
      return false
    }

    if (tags && tags.size > 0) {
      for (const tag of tags) {
        if (!event.tags.includes(tag)) {
          return false
        }
      }
    }

    if (starredOnly && !(starredKeys ?? new Set<string>()).has(eventKey(event))) {
      return false
    }

    return true
  })
}

/** Inclusive expand of a drag span so pointer math (histogram bars) never
 *  drops the bucket it started on when dragging upwards. */
export function normalizeDragSpan(from: number, to: number): { from: number; to: number } {
  return from <= to ? { from, to } : { from: to, to: from }
}

// ── Histogram (3h buckets, 方案 §5-T13) ────────────────────────────────────

export interface HistogramBucket {
  /** Bucket start epoch ms (aligned to HISTOGRAM_BUCKET_MS grid). */
  at: number
  count: number
}

/**
 * Bucket events onto the 3h grid. The grid anchors on epoch 0 so buckets are
 * stable regardless of the dataset span (same bucketing in preview 07). Empty
 * input yields no buckets; the page renders its own empty state.
 */
export function histogramBuckets(events: ReadonlyArray<TimelineEvent>): HistogramBucket[] {
  const counts = new Map<number, number>()

  for (const event of events) {
    const bucket = Math.floor(event.at / HISTOGRAM_BUCKET_MS) * HISTOGRAM_BUCKET_MS
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }

  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([at, count]) => ({ at, count }))
}

// ── Derived stores ──────────────────────────────────────────────────────────

/** Every filter axis applied — the table's rows. */
export const $filteredEvents = computed(
  [$timelineEvents, $sourceFilter, $rangeFilter, $dragSelection, $confidenceFilter, $tagFilter, $starredOnly, $starredKeys],
  (events, sources, range, drag, confidenceMin, tags, starredOnly, starredKeys) =>
    filterTimelineEvents(events, { confidenceMin, drag, range, sources, starredKeys, starredOnly, tags })
)

/** Histogram rides the base dataset minus time-bounded axes (range + drag) so
 *  a drag-selection can be SEEN while it narrows the table. */
export const $histogramBuckets = computed(
  [$timelineEvents, $rangeFilter, $dragSelection],
  (events, range, drag) =>
    histogramBuckets(filterTimelineEvents(events, { drag, range }))
)

/** Tag chips (vocabulary = union of the dataset's tags, 预览 07 左栏). */
export const $timelineTagVocabulary = computed($timelineEvents, events => {
  const tags = new Set<string>()

  for (const event of events) {
    for (const tag of event.tags) {
      tags.add(tag)
    }
  }

  return [...tags].sort()
})

export interface TimelineSummary {
  eventCount: number
  filteredCount: number
  starredCount: number
}

/** Page-head + footer stats (预览 07: 事件 N · 过滤后显示 M · 已星标 K). */
export const $timelineSummary = computed(
  [$timelineEvents, $filteredEvents, $starredKeys],
  (events, filtered, starred): TimelineSummary => ({
    eventCount: events.length,
    filteredCount: filtered.length,
    starredCount: events.filter(event => starred.has(eventKey(event))).length
  })
)

// ── Mutations ───────────────────────────────────────────────────────────────

export function setSourceFilter(sources: ReadonlySet<TimelineSource>): void {
  $sourceFilter.set(new Set(sources))
}

export function toggleSource(source: TimelineSource): void {
  const next = new Set($sourceFilter.get())

  if (next.has(source)) {
    next.delete(source)
  } else {
    next.add(source)
  }

  $sourceFilter.set(next)
}

export function setRangeFilter(from: null | number, to: null | number): void {
  $rangeFilter.set({ from, to })
}

export function setConfidenceFilter(min: number): void {
  $confidenceFilter.set(Math.min(100, Math.max(0, Math.floor(min))))
}

export function toggleTag(tag: string): void {
  const next = new Set($tagFilter.get())

  if (next.has(tag)) {
    next.delete(tag)
  } else {
    next.add(tag)
  }

  $tagFilter.set(next)
}

export function setDragSelection(span: { from: number; to: number } | null): void {
  $dragSelection.set(span ? normalizeDragSpan(span.from, span.to) : null)
}

export function setStarredOnly(on: boolean): void {
  $starredOnly.set(on)
}

/** Reset every filter axis (keeps dataset + stars). */
export function resetTimelineFilters(): void {
  $sourceFilter.set(new Set())
  $rangeFilter.set({ from: null, to: null })
  $confidenceFilter.set(0)
  $tagFilter.set(new Set())
  $dragSelection.set(null)
  $starredOnly.set(false)
}

/** Drop the dataset and every filter (page unmount / case switch). */
export function clearTimelineState(): void {
  $caseId.set('')
  $timelineEvents.set([])
  $timelineMockGenerated.set(false)
  $timelineMockReason.set(null)
  $timelineLoading.set(false)
  $timelineError.set(null)
  resetTimelineFilters()
}

// ── Stars (localStorage persistence + data seam for T16) ───────────────────

function starStorageKey(caseId: string): string {
  return `${STAR_KEY_BASE}:${caseId}`
}

function readStarredKeys(caseId: string): ReadonlySet<string> {
  if (typeof window === 'undefined') {
    return new Set()
  }

  try {
    const raw = window.localStorage.getItem(starStorageKey(caseId))

    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function writeStarredKeys(caseId: string, keys: ReadonlySet<string>): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(starStorageKey(caseId), JSON.stringify([...keys].sort()))
  } catch {
    // localStorage unavailable — stars degrade to session-only.
  }
}

/** Swap the loaded case (page mount). Restores that case's star set. */
export function setTimelineCase(caseId: string): void {
  $caseId.set(caseId)
  $starredKeys.set(readStarredKeys(caseId))
}

/** Install a fetched dataset (page load = the case opens). Restores that
 *  case's star set, resets transient axes, keeps persistent filters. Every
 *  case switch funnels here, so in-memory star state never leaks across
 *  cases. `mockGenerated` carries the bridge's provenance flag so the page
 *  can surface it honestly. */
export function setCaseTimelineDataset(
  caseId: string,
  events: TimelineEvent[],
  mockGenerated: boolean,
  mockReason?: null | string
): void {
  setTimelineCase(caseId)
  $timelineEvents.set(events)
  $timelineMockGenerated.set(mockGenerated)
  $timelineMockReason.set(mockReason ?? null)
  $timelineError.set(null)
  $dragSelection.set(null)
}

/** Star/unstar one event. Returns the resulting on-state (audit callers use
 *  it to pick `star` vs `unstar`). Persistence is per-case localStorage. */
export function toggleTimelineStar(event: TimelineEvent): boolean {
  const caseId = $caseId.get()
  const key = eventKey(event)
  const next = new Set($starredKeys.get())
  const on = !next.has(key)

  if (on) {
    next.add(key)
  } else {
    next.delete(key)
  }

  $starredKeys.set(next)

  if (caseId) {
    writeStarredKeys(caseId, next)
  }

  return on
}

/** Starred events of the CURRENT dataset, time-ascending — the data seam T16
 *  (报告章节「关键发现」) consumes. */
export function starredEvents(): TimelineEvent[] {
  const starred = $starredKeys.get()

  return $timelineEvents
    .get()
    .filter(event => starred.has(eventKey(event)))
    .sort((a, b) => a.at - b.at)
}
