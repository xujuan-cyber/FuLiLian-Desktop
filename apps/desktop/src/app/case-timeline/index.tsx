// Case timeline analysis page (step 16 · T13, 方案 §5-T13; 预览 07).
//
// Layout: page head (case no. mono + stats + [保存为发现][导出 CSV][加入报告]
// 深墨主按钮) → left filter rail (source checkboxes with counts, confidence
// slider, tag chips, starred-only) → main area = SVG histogram (3h buckets,
// drag to range-filter, 联动 the table) + event table (mono time / source chip
// / event / confidence bar / tags / star).
//
// 诚实落地：案号来自路由参数（真实数据源=案件 id）；数据集经
// `window.fulilianDesktop.caseTimeline.timeline`——P2 管线未就绪 ⇒ mock 数据
// 集，页头下明示「示例数据集」横幅（mockBanner），不冒充真实取证结果。星标经
// desktop.log 结构化标记行入审计（T7 先例），同步报告章节依赖 T16（footer 注记
// + store starredEvents() 数据接缝）。

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { ReportCenterDialog } from '@/app/report-center'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ChevronLeft, Download, FileText, Save, Star, StarFilled, X } from '@/lib/icons'
import { type Translations, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import {
  $confidenceFilter,
  $dragSelection,
  $filteredEvents,
  $histogramBuckets,
  $sourceFilter,
  $starredKeys,
  $starredOnly,
  $tagFilter,
  $timelineError,
  $timelineEvents,
  $timelineLoading,
  $timelineMockGenerated,
  $timelineSummary,
  $timelineTagVocabulary,
  clearTimelineState,
  eventKey,
  setCaseTimelineDataset,
  setConfidenceFilter,
  setDragSelection,
  setStarredOnly,
  setTimelineCase,
  toggleSource,
  toggleTag,
  toggleTimelineStar,
  type TimelineEvent,
  type TimelinePayload
} from '@/store/case-timeline'
import { TIMELINE_EVENT_SOURCES } from '@/store/case-timeline-types'
import { runTimelineCsvExport, reportTimelineStarAudit, setTimelineAuditCaseId, timelineEventAt } from './case-timeline-utils'

type SourceId = (typeof TIMELINE_EVENT_SOURCES)[number]

const SOURCE_LABEL_KEY: Record<SourceId, keyof Translations['caseTimeline']> = {
  file: 'sourceFile',
  log: 'sourceLog',
  pcap: 'sourcePcap',
  registry: 'sourceRegistry'
}

function sourceLabel(source: SourceId, a: Translations['caseTimeline']): string {
  return a[SOURCE_LABEL_KEY[source]] as string
}

/** Chip tone per source (预览 07: log=success, registry=info, pcap=warning,
 *  file=inset) — mode colors stay MARKERS at chip scale, never fills; the
 *  --dt-* custom properties fall back to the neutral text token when a skin
 *  does not define them (token discipline: no hardcoded hex). */
const SOURCE_CHIP_CLASS: Record<SourceId, string> = {
  file: 'bg-(--ui-bg-quaternary) text-(--ui-text-secondary)',
  log: 'bg-(--ui-success-soft,var(--ui-bg-quaternary)) text-(--dt-success,var(--ui-text-secondary))',
  pcap: 'bg-(--ui-warning-soft,var(--ui-bg-quaternary)) text-(--dt-warning,var(--ui-text-secondary))',
  registry: 'bg-(--ui-info-soft,var(--ui-bg-quaternary)) text-(--dt-info,var(--ui-text-secondary))'
}

export function CaseTimelineView({ caseId: caseIdProp }: { caseId?: string } = {}) {
  // The workspace mount row (<Route element={page(<CaseTimelineView />)}
  // path="cases/:caseId/timeline">) renders the element WITHOUT params, so the
  // id comes from the router match; the prop exists for direct-mount tests.
  const params = useParams()
  const caseId = caseIdProp ?? params.caseId ?? ''
  const { t } = useI18n()
  const a = t.caseTimeline
  const navigate = useNavigate()

  const loading = useStore($timelineLoading)
  const loadError = useStore($timelineError)
  const mockGenerated = useStore($timelineMockGenerated)
  const events = useStore($timelineEvents)
  const filtered = useStore($filteredEvents)
  const buckets = useStore($histogramBuckets)
  const summary = useStore($timelineSummary)
  const tagVocabulary = useStore($timelineTagVocabulary)
  const starred = useStore($starredKeys)

  // Dataset load = the case opens. The bridge (P2 pipeline pending) serves the
  // deterministic mock dataset with an explicit provenance flag.
  useEffect(() => {
    setTimelineCase(caseId)
    setTimelineAuditCaseId(caseId)
    $timelineLoading.set(true)

    const bridge = window.fulilianDesktop?.caseTimeline

    if (!bridge) {
      $timelineError.set('Desktop IPC bridge is unavailable')
      $timelineLoading.set(false)

      return
    }

    let cancelled = false

    bridge
      .timeline(caseId)
      .then((payload: TimelinePayload | null) => {
        if (cancelled) {
          return
        }

        // null = the invoke was the star-audit variant (a dataset fetch never
        // passes the second argument, so this is defensive honesty, not a
        // silent data loss).
        if (!payload) {
          $timelineError.set('unexpected empty timeline payload')
          $timelineLoading.set(false)

          return
        }

        setCaseTimelineDataset(payload.caseId, payload.events, payload.mockGenerated, payload.mockReason)
        $timelineLoading.set(false)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        $timelineError.set(error instanceof Error ? error.message : String(error))
        $timelineLoading.set(false)
      })

    return () => {
      cancelled = true
      clearTimelineState()
    }
  }, [caseId])

  const [reportOpen, setReportOpen] = useState(false)

  const exportCsv = useCallback(() => {
    runTimelineCsvExport(caseId, filtered, a).catch(error => notifyError(error, a.exportCsvFailed))
  }, [a, caseId, filtered])

  if (loading) {
    return <PageLoader label={a.loading} />
  }

  if (loadError) {
    return (
      <div className="grid h-full place-items-center px-6 text-center" data-testid="case-timeline-error">
        <div>
          <div className="text-sm font-medium">{a.loadFailed}</div>
          <div className="mt-1 text-xs text-muted-foreground">{loadError}</div>
        </div>
      </div>
    )
  }

  return (
    <section aria-label={`${caseId} · ${a.title}`} className="flex h-full min-h-0 flex-col bg-background">
      {/* ── Page head ── */}
      <header className="flex flex-none items-center gap-3 border-b px-5 py-3" data-testid="case-timeline-head">
        <Button
          aria-label={a.back}
          className="text-(--ui-text-tertiary)"
          onClick={() => navigate(-1)}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <span className="font-mono text-[13px] text-(--ui-text-secondary)">{caseId}</span>
        <h1 className="text-[16px] font-bold">{a.title}</h1>
        <span className="text-xs text-(--ui-text-tertiary)" data-testid="case-timeline-stats">
          {a.statEvents(summary.eventCount)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            onClick={() => {
              // 保存为发现（T16 报告管线接缝：星标集即「发现」候选，经
              // store starredEvents() 供 T16 消费；本轮登记 toast，不伪造落盘）。
              notify({ kind: 'success', title: a.savedAsFinding, message: a.footerStarSeam })
            }}
            size="sm"
            variant="outline"
          >
            <Save />
            {a.saveAsFinding}
          </Button>
          <Button onClick={exportCsv} size="sm" variant="outline">
            <Download />
            {a.exportCsv}
          </Button>
          <Button onClick={() => setReportOpen(true)} size="sm">
            <FileText />
            {a.addToReport}
          </Button>
        </div>
      </header>

      <ReportCenterDialog onOpenChange={setReportOpen} open={reportOpen} />

      {mockGenerated && (
        <div
          className="flex-none border-b bg-(--ui-bg-quaternary) px-5 py-1.5 text-xs text-(--ui-text-secondary)"
          data-testid="case-timeline-mock-banner"
          role="note"
        >
          {a.mockBanner}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── Left filter rail ── */}
        <aside className="flex w-60 flex-none flex-col gap-0.5 overflow-y-auto border-r bg-(--ui-bg-secondary) px-3 py-3">
          <FilterRailHeading label={a.sourcesHeading} />
          <SourceRows />

          <FilterRailHeading label={a.confidenceHeading} />
          <ConfidenceSlider />

          <FilterRailHeading label={a.tagsHeading} />
          <TagChips />
        </aside>

        {/* ── Main: histogram + table ── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {events.length === 0 ? (
            <div className="grid flex-1 place-items-center px-6 text-center" data-testid="case-timeline-empty">
              <div className="text-sm font-medium">{a.empty}</div>
            </div>
          ) : (
            <>
              <Histogram buckets={buckets} />
              <EventTable events={filtered} starred={starred} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function FilterRailHeading({ label }: { label: string }) {
  return (
    <div className="px-1 pb-1 pt-3 text-[11px] font-bold tracking-wide text-(--ui-text-tertiary) first:pt-0">
      {label}
    </div>
  )
}

function SourceRows() {
  const { t } = useI18n()
  const selected = useStore($sourceFilter)
  const events = useStore($timelineEvents)

  const counts = useMemo(() => {
    const counts = new Map<string, number>()

    for (const event of events) {
      counts.set(event.source, (counts.get(event.source) ?? 0) + 1)
    }

    return counts
  }, [events])

  return (
    <div data-testid="case-timeline-source-rows">
      {TIMELINE_EVENT_SOURCES.map(source => {
        // Empty selection = ALL sources shown; a checked box that would
        // uncheck the last one falls back to all (empty set), so the rail
        // never dead-ends.
        const checked = selected.size === 0 || selected.has(source)

        return (
          <label
            className="flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[12.5px] hover:bg-(--chrome-action-hover)"
            key={source}
          >
            <Checkbox checked={checked} onCheckedChange={() => toggleSource(source)} />
            <span className="min-w-0 truncate">{sourceLabel(source, t.caseTimeline)}</span>
            <span className="ml-auto font-mono text-[10.5px] text-(--ui-text-tertiary)">
              {t.caseTimeline.sourceCount(counts.get(source) ?? 0)}
            </span>
          </label>
        )
      })}
    </div>
  )
}

function ConfidenceSlider() {
  const { t } = useI18n()
  const min = useStore($confidenceFilter)

  return (
    <div className="px-1 pb-1">
      <input
        aria-label={t.caseTimeline.confidenceHeading}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-(--ui-stroke-tertiary)"
        max={100}
        min={0}
        onChange={event => setConfidenceFilter(Number(event.target.value))}
        step={1}
        style={{ accentColor: 'var(--dt-info, var(--dt-primary))' }}
        type="range"
        value={min}
      />
      <div className="mt-1 flex justify-between text-[11px] text-(--ui-text-tertiary)">
        <span className="font-mono text-(--ui-text-primary)">{t.caseTimeline.confidenceFloor(min)}</span>
        <span>100%</span>
      </div>
    </div>
  )
}

function TagChips() {
  const { t } = useI18n()
  const a = t.caseTimeline
  const vocabulary = useStore($timelineTagVocabulary)
  const selected = useStore($tagFilter)
  const starredOnly = useStore($starredOnly)

  return (
    <div className="flex flex-wrap gap-1.5 px-1" data-testid="case-timeline-tag-chips">
      {vocabulary.map(tag => (
        <TagChip
          key={tag}
          label={tag}
          on={selected.has(tag)}
          onToggle={() => toggleTag(tag)}
        />
      ))}
      <TagChip label={a.starredOnlyChip} on={starredOnly} onToggle={() => setStarredOnly(!starredOnly)} />
    </div>
  )
}

function TagChip({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      className={cn(
        'h-6 cursor-pointer rounded-full px-2.5 text-[11.5px] transition-colors duration-100',
        on
          ? 'bg-(--ui-info-soft,var(--ui-bg-quaternary)) font-bold text-(--dt-info,var(--ui-text-primary))'
          : 'bg-(--ui-bg-quaternary) text-(--ui-text-secondary) ring-1 ring-(--ui-stroke-tertiary) hover:bg-(--chrome-action-hover)'
      )}
      data-active={on ? 'true' : undefined}
      onClick={onToggle}
      type="button"
    >
      {label}
    </button>
  )
}

// ── Histogram (SVG 自绘, 3h buckets, 拖选范围过滤) ──────────────────────────

const HISTO_WIDTH = 1080
const HISTO_HEIGHT = 108
const HISTO_BAR_WIDTH = 22

function Histogram({ buckets }: { buckets: Array<{ at: number; count: number }> }) {
  const { t } = useI18n()
  const a = t.caseTimeline
  const drag = useStore($dragSelection)
  const dragAnchorRef = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const maxCount = Math.max(1, ...buckets.map(bucket => bucket.count))
  const first = buckets[0]?.at ?? 0
  const span = buckets.length > 0 ? buckets[buckets.length - 1].at - first : 0

  // Bars are positioned PROPORTIONALLY on the time axis (not slot-indexed), so
  // the x-coordinate of a bar is the exact inverse of the pointer→time mapping
  // and the drag overlay lines up with the bars it covers.
  const timeToX = useCallback(
    (time: number) => {
      if (span <= 0) {
        return 4
      }

      return 4 + ((time - first) / span) * (HISTO_WIDTH - 8 - HISTO_BAR_WIDTH)
    },
    [first, span]
  )

  const timeAtPointer = useCallback(
    (clientX: number): number => {
      const rect = svgRef.current?.getBoundingClientRect()

      if (!rect || buckets.length === 0) {
        return 0
      }

      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))

      return Math.round(first + ratio * span)
    },
    [buckets.length, first, span]
  )

  const dragLeft = drag ? timeToX(Math.min(drag.from, drag.to)) : 0
  const dragRight = drag ? timeToX(Math.max(drag.from, drag.to)) : 0

  return (
    <div className="mx-5 mt-4 flex-none rounded-xl border bg-card px-4 pb-2 pt-3" data-testid="case-timeline-histogram">
      <div className="mb-2 flex items-baseline gap-2.5">
        <span className="text-[12.5px] font-bold text-(--ui-text-secondary)">{a.histogramTitle}</span>
        <span className="text-[11px] text-(--ui-text-tertiary)">{a.histogramAggregate}</span>
        {drag && (
          <span className="ml-auto rounded-md bg-(--ui-info-soft,var(--ui-bg-quaternary)) px-2 py-0.5 font-mono text-[11px] text-(--dt-info,var(--ui-text-primary))">
            {a.histogramDrag(timelineEventAt(drag.from), timelineEventAt(drag.to))}
            <button
              aria-label={a.back}
              className="ml-1.5 inline-flex cursor-pointer align-middle"
              onClick={() => setDragSelection(null)}
              type="button"
            >
              <X className="size-3" />
            </button>
          </span>
        )}
      </div>
      <svg
        aria-hidden="true"
        data-testid="case-timeline-histogram-svg"
        fill="none"
        height={HISTO_HEIGHT}
        onPointerDown={event => {
          dragAnchorRef.current = timeAtPointer(event.clientX)
        }}
        onPointerMove={event => {
          if (dragAnchorRef.current !== null) {
            setDragSelection({ from: dragAnchorRef.current, to: timeAtPointer(event.clientX) })
          }
        }}
        onPointerUp={() => {
          dragAnchorRef.current = null
        }}
        preserveAspectRatio="none"
        ref={svgRef}
        style={{ touchAction: 'none' }}
        viewBox={`0 0 ${HISTO_WIDTH} ${HISTO_HEIGHT}`}
        width="100%"
      >
        {[27, 54, 81].map(y => (
          <line key={y} stroke="var(--ui-stroke-tertiary)" strokeWidth="1" x1="0" x2={HISTO_WIDTH} y1={y} y2={y} />
        ))}
        {buckets.map(bucket => {
          const height = Math.max(4, (bucket.count / maxCount) * 86)

          return (
            <rect
              data-bucket-at={bucket.at}
              data-bucket-count={bucket.count}
              fill="var(--dt-info, var(--dt-primary))"
              height={height}
              key={bucket.at}
              opacity="0.85"
              rx="2"
              width={HISTO_BAR_WIDTH}
              x={timeToX(bucket.at)}
              y={HISTO_HEIGHT - height - 2}
            />
          )
        })}
        {drag && (
          <rect
            data-testid="case-timeline-drag-overlay"
            fill="var(--dt-info, var(--dt-primary))"
            height={HISTO_HEIGHT - 4}
            opacity="0.12"
            rx="4"
            width={Math.max(HISTO_BAR_WIDTH, dragRight - dragLeft)}
            x={dragLeft}
            y="4"
          />
        )}
      </svg>
      {buckets.length === 0 && (
        <div className="py-6 text-center text-xs text-(--ui-text-tertiary)">{a.histogramEmpty}</div>
      )}
    </div>
  )
}

// ── Event table ────────────────────────────────────────────────────────────

function EventTable({
  events,
  starred
}: {
  events: ReadonlyArray<TimelineEvent>
  starred: ReadonlySet<string>
}) {
  const { t } = useI18n()
  const a = t.caseTimeline

  return (
    <div
      className="mx-5 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border"
      data-testid="case-timeline-table"
    >
      <div className="flex h-[34px] flex-none items-center gap-3 border-b px-3.5 text-[11px] font-bold tracking-wide text-(--ui-text-tertiary)">
        <span className="w-36 flex-none">{a.columnTime}</span>
        <span className="w-24 flex-none">{a.columnSource}</span>
        <span className="min-w-0 flex-1">{a.columnEvent}</span>
        <span className="w-28 flex-none">{a.columnConfidence}</span>
        <span className="w-24 flex-none">{a.columnTags}</span>
        <span className="w-8 flex-none" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.map(event => (
          <EventRow event={event} key={eventKey(event)} starred={starred.has(eventKey(event))} />
        ))}
        {events.length === 0 && (
          <div
            className="grid h-24 place-items-center text-xs text-(--ui-text-tertiary)"
            data-testid="case-timeline-table-empty"
          >
            {a.emptyFiltered}
          </div>
        )}
      </div>
      <TableFooter />
    </div>
  )
}

function EventRow({ event, starred }: { event: TimelineEvent; starred: boolean }) {
  const { t } = useI18n()
  const a = t.caseTimeline
  const low = event.confidence < 70

  return (
    <div
      className={cn(
        'flex min-h-[46px] items-center gap-3 border-b px-3.5 py-1.5 text-[12.5px] last:border-b-0',
        starred && 'bg-(--ui-accent-soft,var(--ui-bg-quaternary))',
        low && 'opacity-80'
      )}
      data-starred={starred ? 'true' : undefined}
    >
      <span className="w-36 flex-none font-mono text-[11.5px] text-(--ui-text-secondary)">
        {timelineEventAt(event.at)}
      </span>
      <span className="w-24 flex-none">
        <span
          className={cn(
            'inline-flex h-[21px] items-center rounded-full px-2 text-[10.5px] font-bold',
            SOURCE_CHIP_CLASS[event.source]
          )}
        >
          {sourceLabel(event.source, a)}
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate pr-4">{event.event}</span>
      <span className="flex w-28 flex-none items-center gap-2">
        <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-(--ui-bg-quaternary)">
          <span
            className={cn(
              'absolute inset-y-0 left-0 rounded-full',
              low ? 'bg-(--dt-warning,var(--ui-text-tertiary))' : 'bg-(--dt-success,var(--ui-text-secondary))'
            )}
            style={{ width: `${event.confidence}%` }}
          />
        </span>
        <span className="w-8 text-right font-mono text-[11px] text-(--ui-text-secondary)">
          {event.confidence}%
        </span>
      </span>
      <span className="flex w-24 flex-none flex-wrap gap-1">
        {event.tags.map(tag => (
          <span
            className="rounded-full bg-(--ui-bg-quaternary) px-2 py-0.5 text-[10.5px] text-(--ui-text-secondary)"
            key={tag}
          >
            {tag}
          </span>
        ))}
      </span>
      <span className="w-8 flex-none text-center">
        <button
          aria-label={a.starredOnlyChip}
          aria-pressed={starred}
          className="inline-flex cursor-pointer"
          data-testid="case-timeline-star"
          onClick={() => {
            const on = toggleTimelineStar(event)

            // 星标入审计：desktop.log 结构化标记行（T7 先例；不含事件内容明文，
            // 只有 case/source/tags 原子）。fire-and-forget，失败静默。
            reportTimelineStarAudit(event, on)
          }}
          type="button"
        >
          {starred ? (
            <StarFilled className="size-[15px] text-(--dt-accent,var(--ui-text-primary))" />
          ) : (
            <Star className="size-[15px] text-(--ui-stroke-secondary)" />
          )}
        </button>
      </span>
    </div>
  )
}

function TableFooter() {
  const { t } = useI18n()
  const summary = useStore($timelineSummary)

  return (
    <div className="flex flex-none items-center gap-2 border-t bg-(--ui-bg-secondary) px-3.5 py-2 text-[11.5px] text-(--ui-text-tertiary)">
      <span data-testid="case-timeline-footer-total">{t.caseTimeline.footerTotal(summary.eventCount)}</span>
      <span>·</span>
      <span data-testid="case-timeline-footer-filtered">{t.caseTimeline.footerFiltered(summary.filteredCount)}</span>
      <span>·</span>
      <span data-testid="case-timeline-footer-starred">{t.caseTimeline.footerStarred(summary.starredCount)}</span>
      <span className="ml-auto font-medium text-(--dt-info,var(--ui-text-secondary))">
        {t.caseTimeline.footerStarSeam}
      </span>
    </div>
  )
}
