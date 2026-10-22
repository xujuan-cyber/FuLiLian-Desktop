// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AnalyticsDailyEntry, AnalyticsModelEntry } from '@/types/fulilian'

import { ModelDistributionBar, modelShares, UsageTrendChart } from './usage-charts'

function modelEntry(model: string, input: number, output: number, cost = 0): AnalyticsModelEntry {
  return { estimated_cost: cost, input_tokens: input, model, output_tokens: output, sessions: 1 } as AnalyticsModelEntry
}

describe('modelShares (R7 模型分布聚合)', () => {
  it('returns an honest empty list for no rows', () => {
    expect(modelShares([])).toEqual([])
  })

  it('drops zero-token rows and orders the rest largest-first', () => {
    const shares = modelShares([modelEntry('small', 10, 0), modelEntry('big', 900, 100), modelEntry('ghost', 0, 0)])

    expect(shares.map(share => share.model)).toEqual(['big', 'small'])
    expect(shares[0].sharePercent).toBeCloseTo(1000 / 1010 * 100, 2)
    expect(shares[1].sharePercent).toBeCloseTo(10 / 1010 * 100, 2)
  })

  it('folds the tail into an explicit "+n" slice so the bar stays legible', () => {
    const rows = [
      modelEntry('a', 500, 0),
      modelEntry('b', 300, 0),
      modelEntry('c', 100, 0),
      modelEntry('d', 50, 0),
      modelEntry('e', 30, 0),
      modelEntry('f', 20, 0),
      modelEntry('g', 10, 0),
      modelEntry('h', 10, 0)
    ]

    const shares = modelShares(rows)

    expect(shares).toHaveLength(7)
    expect(shares[6].model).toBe('+n')
    expect(shares[6].tokens).toBe(20)

    const total = shares.reduce((acc, share) => acc + share.sharePercent, 0)

    expect(total).toBeCloseTo(100)
  })

  it('carries each named model’s estimated cost through to its share', () => {
    const shares = modelShares([modelEntry('a', 100, 0, 1.25)])

    expect(shares[0].costUsd).toBeCloseTo(1.25)
  })
})

describe('zero-dependency SVG charts (U4)', () => {
  const daily: AnalyticsDailyEntry[] = [
    { api_calls: 1, day: '2026-09-28', input_tokens: 400, output_tokens: 100, sessions: 1 },
    { api_calls: 0, day: '2026-09-29', input_tokens: 0, output_tokens: 0, sessions: 0 }
  ] as AnalyticsDailyEntry[]

  it('paints stacked columns per day and a quiet baseline tick for empty days', () => {
    const { container } = render(<UsageTrendChart daily={daily} />)
    const svg = container.querySelector('svg')

    expect(svg).not.toBeNull()
    // Day 1: input rect + output rect; day 2: baseline tick only.
    expect(svg?.querySelectorAll('rect')).toHaveLength(3)
  })

  it('renders the distribution bar as one segment per share and nothing when empty', () => {
    const shares = modelShares([modelEntry('a', 700, 0), modelEntry('b', 300, 0)])
    const { container, rerender } = render(<ModelDistributionBar shares={shares} />)

    expect(container.querySelectorAll('rect')).toHaveLength(2)

    rerender(<ModelDistributionBar shares={[]} />)

    expect(container.querySelector('svg')).toBeNull()
  })
})
