import { useMemo } from 'react'

import { compactNumber } from '@/lib/format'
import type { AnalyticsDailyEntry, AnalyticsModelEntry } from '@/types/fulilian'

/**
 * Zero-dependency usage charts for the Command Center's Usage panel (R7).
 * Hand-drawn SVG on the existing panel's token palette — no chart library
 * (U4). Both components render honest empty states by simply not painting
 * bars for absent data; the panel owns the empty-state copy.
 */

// The daily trend's intrinsic SVG viewport. `preserveAspectRatio="none"` lets
// N bars stretch to any panel width; only fills live inside (no strokes or
// text), so the non-uniform scale distorts nothing that carries meaning.
const TREND_VIEW_WIDTH = 1000
const TREND_VIEW_HEIGHT = 96

const TREND_INPUT_FILL = 'var(--dt-primary)'
const TREND_OUTPUT_FILL = '#10b981'

/** Daily token trend as a stacked SVG column chart (input over output), one
 *  column per day in the fetched window. A `<title>` per column carries the
 *  exact figures — the same content the old div chart's title attribute had. */
export function UsageTrendChart({ daily }: { daily: AnalyticsDailyEntry[] }) {
  const columns = useMemo(
    () =>
      daily.map((entry, index) => ({
        day: entry.day,
        index,
        input: entry.input_tokens || 0,
        output: entry.output_tokens || 0,
        total: (entry.input_tokens || 0) + (entry.output_tokens || 0)
      })),
    [daily]
  )

  const maxTotal = useMemo(
    () => columns.reduce((acc, column) => Math.max(acc, column.input + column.output), 1),
    [columns]
  )
  const slot = columns.length > 0 ? TREND_VIEW_WIDTH / columns.length : TREND_VIEW_WIDTH
  // A thin gutter between columns; at 90 days the bar body still reads.
  const gap = Math.min(4, slot * 0.25)
  const barWidth = Math.max(slot - gap, 1)

  return (
    <svg
      aria-hidden="true"
      className="h-24 w-full"
      preserveAspectRatio="none"
      role="presentation"
      viewBox={`0 0 ${TREND_VIEW_WIDTH} ${TREND_VIEW_HEIGHT}`}
    >
      {columns.map(column => {
        const total = column.input + column.output
        const x = column.index * slot
        const inputHeight = Math.round((column.input / maxTotal) * TREND_VIEW_HEIGHT)
        const outputHeight = Math.round((column.output / maxTotal) * TREND_VIEW_HEIGHT)
        const yOutput = TREND_VIEW_HEIGHT - outputHeight
        const yInput = yOutput - inputHeight

        return (
          <g key={column.day}>
            <title>{`${column.day} · in ${compactNumber(column.input)} · out ${compactNumber(column.output)}`}</title>
            {column.input > 0 && (
              <rect fill={TREND_INPUT_FILL} fillOpacity="0.5" height={inputHeight} width={barWidth} x={x} y={yInput} />
            )}
            {column.output > 0 && (
              <rect fill={TREND_OUTPUT_FILL} fillOpacity="0.6" height={outputHeight} width={barWidth} x={x} y={yOutput} />
            )}
            {column.total === 0 && (
              // A quiet baseline tick so a no-activity day still reads as a day
              // in the window rather than a rendering hole.
              <rect
                fill="var(--ui-text-tertiary)"
                fillOpacity="0.25"
                height={1}
                width={barWidth}
                x={x}
                y={TREND_VIEW_HEIGHT - 1}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

const DISTRIBUTION_VIEW_HEIGHT = 10

const SEGMENT_FILLS = [
  'var(--dt-primary)',
  'var(--ui-success)',
  'var(--dt-midground)',
  'var(--ui-text-tertiary)',
  'var(--dt-accent-foreground)',
  'var(--dt-sidebar-border)'
]

export interface ModelShare {
  model: string
  sharePercent: number
  tokens: number
  costUsd: number
}

/** Aggregate the analytics response's per-model rows into token-share entries,
 *  ordered largest first, with the tail folded into an explicit "other" slice —
 *  a 90-day window can easily carry dozens of models and the bar stays legible
 *  with at most six named segments. */
export function modelShares(models: AnalyticsModelEntry[]): ModelShare[] {
  const usable = models.filter(entry => (entry.input_tokens || 0) + (entry.output_tokens || 0) > 0)

  if (usable.length === 0) {
    return []
  }

  const totalTokens = usable.reduce((acc, entry) => acc + (entry.input_tokens || 0) + (entry.output_tokens || 0), 0)

  const sorted = [...usable]
    .map(entry => ({
      costUsd: entry.estimated_cost || 0,
      model: entry.model,
      tokens: (entry.input_tokens || 0) + (entry.output_tokens || 0)
    }))
    .sort((a, b) => b.tokens - a.tokens)

  const named = sorted.slice(0, 6)
  const tail = sorted.slice(6)
  const tailTokens = tail.reduce((acc, entry) => acc + entry.tokens, 0)
  const tailCost = tail.reduce((acc, entry) => acc + entry.costUsd, 0)

  const shares: ModelShare[] = named.map(entry => ({
    model: entry.model,
    sharePercent: (entry.tokens / totalTokens) * 100,
    tokens: entry.tokens,
    costUsd: entry.costUsd
  }))

  if (tail.length > 0) {
    shares.push({
      costUsd: tailCost,
      model: '+n',
      sharePercent: (tailTokens / totalTokens) * 100,
      tokens: tailTokens
    })
  }

  return shares
}

/** Model distribution as a single horizontal stacked SVG bar. One `<title>`
 *  per segment: model, share, tokens, and the period's estimated cost — the
 *  cost figure the old Top Models list never surfaced. */
export function ModelDistributionBar({ shares }: { shares: ModelShare[] }) {
  if (shares.length === 0) {
    return null
  }

  return (
    <svg
      aria-hidden="true"
      className="h-2.5 w-full overflow-hidden rounded-full"
      preserveAspectRatio="none"
      role="presentation"
      viewBox={`0 0 1000 ${DISTRIBUTION_VIEW_HEIGHT}`}
    >
      {shares.map((share, index) => {
        const width = (share.sharePercent / 100) * 1000

        return (
          <rect
            fill={index < SEGMENT_FILLS.length ? SEGMENT_FILLS[index] : 'var(--ui-stroke-tertiary)'}
            height={DISTRIBUTION_VIEW_HEIGHT}
            key={share.model}
            width={Math.max(width - 1, 1)}
            x={shares.slice(0, index).reduce((acc, part) => acc + (part.sharePercent / 100) * 1000, 0)}
            y={0}
          >
            <title>
              {`${share.model} · ${share.sharePercent.toFixed(1)}% · ${compactNumber(share.tokens)} · $${share.costUsd.toFixed(2)}`}
            </title>
          </rect>
        )
      })}
    </svg>
  )
}
