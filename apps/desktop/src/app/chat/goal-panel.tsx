import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { compactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { $goalsBySession } from '@/store/goals'
import { $sessionStates } from '@/store/session-states'

// GOAL PANEL (step14 R3) — the standing goal summary ZCode#3 shows in the
// chat's top-right. Replaces the composer status-stack's goal group (U5):
// the status stack collapses away, this stays for as long as the session has
// a goal, so the goal is glanceable without scrolling or expanding anything.
//
// Honesty contract (B13): every number states what it counts.
//   • Token / cost / context come from the session's live usage snapshot —
//     the SAME `state.usage` field the SDK's `focusedUsage` projects — so
//     they are "this launch, this session, as streamed".
//   • `calls` is labeled 调用数 (call count), never 迭代轮次 — the backend
//     has no goal-iteration counter (probe §2).
//   • Elapsed is client-side time since the goal's last update, labeled
//     本次启动内 — it does not survive a reload.
//   • A missing figure renders "—", never a zero.

const MISSING = '—'
const ELAPSED_TICK_MS = 30_000

const statusKey = {
  active: 'goalActive',
  done: 'goalDone',
  paused: 'goalPaused',
  waiting: 'goalWaiting'
} as const

/** Client-side elapsed since `from`, coarse-grained: it is a glanceable
 *  "how long has this been going" hint, not a stopwatch. */
function coarseDuration(ms: number): null | string {
  if (ms < 0) {
    return null
  }

  const minutes = Math.floor(ms / 60_000)

  if (minutes < 1) {
    return '<1m'
  }

  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

function Fact({ label, value, note }: { label: string; note?: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span className="shrink-0 text-[0.6875rem] text-(--ui-text-tertiary)">{label}</span>
      <span className="min-w-0 truncate text-right text-[0.6875rem] font-medium text-(--ui-text-primary)">
        {value}
        {note ? <span className="ml-1 font-normal text-(--ui-text-quaternary)">{note}</span> : null}
      </span>
    </div>
  )
}

export function GoalPanel({ sessionId }: { sessionId: null | string }) {
  const { t } = useI18n()
  const p = t.goalPanel
  const goals = useStore($goalsBySession)
  // THIS surface's session state — the same atom the SDK's focusedUsage
  // projects, scoped here so a focused tile can't bleed its numbers into the
  // header of the session behind it.
  const usage = useStore($sessionStates)[sessionId ?? '']?.usage ?? null
  const goal = sessionId ? goals[sessionId] : undefined

  // Elapsed ticks client-side while a goal is up. 30s granularity — the value
  // renders in minutes, so a 1s ticker would repaint for nothing.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!goal) {
      return undefined
    }

    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS)

    return () => clearInterval(timer)
  }, [goal])

  // No goal → nothing (contract: 无 goal 不渲染).
  if (!sessionId || !goal) {
    return null
  }

  const elapsed = coarseDuration(now - goal.updatedAt)
  const statusLabel = t.statusStack[statusKey[goal.status]]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={p.aria}
          className="max-w-56 font-normal text-(--ui-text-tertiary) hover:text-(--ui-text-primary)"
          size="xs"
          type="button"
          variant="ghost"
        >
          <Codicon className="shrink-0 text-muted-foreground/70" name="target" size="0.8rem" />
          <span className="shrink-0">{statusLabel}</span>
          <span className={cn('min-w-0 truncate', goal.status === 'done' && 'line-through opacity-70')}>
            {goal.title}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="grid gap-2" data-slot="goal-panel-details">
          <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-[0.6875rem] text-(--ui-text-tertiary)">{p.goal}</span>
            <span className="min-w-0 truncate text-right text-[0.6875rem] font-medium text-(--ui-text-primary)">
              {goal.title}
            </span>
          </div>
          <Fact label={p.tokens} value={usage ? compactNumber(usage.total) : MISSING} />
          <Fact label={p.cost} value={usage?.cost_usd !== undefined ? `$${usage.cost_usd.toFixed(2)}` : MISSING} />
          <Fact
            label={p.context}
            value={usage?.context_percent !== undefined ? `${Math.round(usage.context_percent)}%` : MISSING}
          />
          {/* "calls" is a tool/model call count — never call it a round/轮次. */}
          <Fact label={p.calls} value={usage ? String(usage.calls) : MISSING} />
          <Fact
            label={p.elapsed}
            note={elapsed ? p.elapsedNote : undefined}
            value={elapsed ?? MISSING}
          />
          {goal.detail ? (
            <div className="border-t border-(--ui-stroke-tertiary) pt-2 text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)">
              {goal.detail}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
