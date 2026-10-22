import { StatusDot } from '@/components/status-dot'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { type ContainerKind, sessionContainerKind } from './sidebar/container-kind'

// Kind markers ride the StatusDot primitive's 6px geometry; the color is the
// MODE color, not a status (DESIGN_PROPOSAL §2 原则 5 — 模式色只做 6px 点与
// 10.5px 徽标). project=success green, forensics=info blue, CTF=accentBright
// orange (whitelist class 2).
const KIND_DOT: Record<ContainerKind, string> = {
  ctf: 'bg-accent-bright',
  forensics: 'bg-info',
  project: 'bg-success'
}

// Badge typography: 10.5px per the §4.3 wireframe.
const KIND_BADGE = 'text-[10.5px] font-medium leading-none text-(--ui-text-secondary)'

/** Honest placeholder for every not-yet-existing data value: an em dash, never
 *  a fabricated case number, count or score. */
export const CONTAINER_META_EMPTY = '—'

/**
 * CONTAINER META — the session header's work-mode strip (§5.2/§5.3/§5.4):
 * a 6px mode dot + 10.5px badge for the session's container kind, with the
 * forensics/CTF stat fields beside it. The kind metadata has NO data layer
 * this round (§4.1 default: every existing session is a project), so:
 *  - project (the only reachable kind): green dot + 「项目」 badge;
 *  - forensics/CTF: the full static structure renders with empty `—` fields —
 *    the seam this component switches on is `sessionContainerKind()`. Tests
 *    assert the honesty: no `CASE-…`, no invented counts, no flag content.
 */
export function ContainerMeta({ className, kind }: { className?: string; kind?: ContainerKind }) {
  const { t } = useI18n()
  const m = t.container.meta
  const resolved = kind ?? sessionContainerKind()

  if (resolved === 'project') {
    return (
      <span className={cn('flex items-center gap-1.5', className)} data-container-kind="project">
        <StatusDot aria-hidden="true" className={cn('shrink-0', KIND_DOT.project)} />
        <span className={KIND_BADGE}>{m.project}</span>
      </span>
    )
  }

  const forensics = resolved === 'forensics'

  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)} data-container-kind={resolved}>
      <span className="flex items-center gap-1.5">
        <StatusDot aria-hidden="true" className={cn('shrink-0', KIND_DOT[resolved])} />
        <span className={KIND_BADGE}>{forensics ? m.forensics : m.ctf}</span>
      </span>
      {forensics ? (
        <span className="flex min-w-0 items-center gap-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          <span className="flex items-center gap-1">
            <span className={KIND_BADGE}>{m.caseNo}</span>
            <span className="font-mono">{CONTAINER_META_EMPTY}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className={KIND_BADGE}>{m.statsEvidence}</span>
            <span className="font-mono">{CONTAINER_META_EMPTY}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className={KIND_BADGE}>{m.statsAudit}</span>
            <span className="font-mono">{CONTAINER_META_EMPTY}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className={KIND_BADGE}>{m.statsReport}</span>
            <span className="font-mono">{CONTAINER_META_EMPTY}</span>
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          <span className="flex items-center gap-1">
            <span className={KIND_BADGE}>{m.event}</span>
            <span className="font-mono">{CONTAINER_META_EMPTY}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className={KIND_BADGE}>{m.categoryPoints}</span>
            <span className="font-mono">{CONTAINER_META_EMPTY}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className={KIND_BADGE}>{m.countdown}</span>
            <span className="font-mono">{m.countdownNone}</span>
          </span>
        </span>
      )}
    </span>
  )
}
