import type { ReactNode } from 'react'

import { SessionStatusDot } from '@/app/chat/session-status-dot'
import { sessionContainerKind } from '@/app/chat/sidebar/container-kind'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { SessionInfo } from '@/types/fulilian'

/**
 * Session-row marks for the palette's 会话 zone (step 16 · T8, 方案 §3-T8):
 * the row-leading StatusDot and the §4.3 mode badge, both riding the SAME
 * primitives the sidebar uses so a session can never read differently between
 * surfaces.
 *
 * Honesty note (T6/T7/T8 seam): the kind data layer does not exist yet —
 * `sessionContainerKind` answers `'project'` for every session — so
 * `sessionBadgeKind` returns null for today's rows and NO badge is ever
 * painted. When the kind column lands, the badge appears from the same
 * lookup; nothing here fabricates a 取证/CTF marker.
 */

/** Which mode badge a session row paints. Only forensics/CTF containers are
 *  marked (the §4.3 badge column is kind-colored); a project session — every
 *  session, until the kind column lands — carries no badge. */
export const sessionBadgeKind = (session?: SessionInfo | null): 'ctf' | 'forensics' | null => {
  const kind = sessionContainerKind(session ?? undefined)

  return kind === 'project' ? null : kind
}

/** The row-leading dot: the ONE session status primitive (sidebar rows, pane
 *  tabs, and now palette rows). `session` may be absent for a deep-search hit
 *  outside the recents page — the dot still resolves the live state from the
 *  stored session id. */
export const sessionLeadNode = (sessionId: string, session?: SessionInfo | null): ReactNode => (
  <SessionStatusDot session={session} storedSessionId={sessionId} />
)

// §4.3 badge typography: 10.5px, same as the sidebar group headers; the color
// is the mode color riding text, not a status state.
const KIND_BADGE: Record<'ctf' | 'forensics', string> = {
  ctf: 'text-accent-bright',
  forensics: 'text-info'
}

export function SessionKindBadge({ kind }: { kind: 'ctf' | 'forensics' }) {
  const { t } = useI18n()

  return (
    <span className={cn('shrink-0 text-[10.5px] font-medium leading-none', KIND_BADGE[kind])}>
      {t.sidebar.kind[kind]}
    </span>
  )
}
