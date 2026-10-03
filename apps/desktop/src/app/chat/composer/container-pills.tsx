import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { composerFloatingPill } from '@/components/chat/composer-dock'

import type { ContainerKind } from '../sidebar/container-kind'

/**
 * CONTAINER PILLS — the composer strip's work-mode metadata pills
 * (DESIGN_PROPOSAL §7 映射行: 取证 [案号][证据数], CTF [分类·分值][倒计时]),
 * static placeholders only. The kind metadata has no data layer this round, so
 * `project` (every reachable session) renders NOTHING — the strip is unchanged
 * — and the forensics/CTF structures carry honest `—` placeholders instead of
 * fabricated case numbers, counts or scores. The seam they switch on is the
 * same `sessionContainerKind()` lookup the sidebar groups use. Same
 * pointer-events rule as the other floating pills: never
 * `pointer-events-none` — the pop-out drag region sits behind this strip.
 */
export function ContainerPills({ className, kind }: { className?: string; kind: ContainerKind }) {
  const { t } = useI18n()
  const p = t.container.pills

  if (kind === 'project') {
    return null
  }

  const field = (label: string, value: string, mono = true) => (
    <span
      className={cn(composerFloatingPill, 'max-w-44', className)}
      data-testid={`container-pill-${label}`}
    >
      <span className="shrink-0 opacity-70">{label}</span>
      <span className={cn('min-w-0 truncate', mono && 'font-mono')}>{value}</span>
    </span>
  )

  if (kind === 'forensics') {
    return (
      <>
        {field(p.caseNo, p.emptyValue)}
        {field(p.evidence, p.emptyValue)}
      </>
    )
  }

  return (
    <>
      {field(p.categoryPoints, p.emptyValue)}
      {field(p.countdown, p.countdownNone)}
    </>
  )
}
