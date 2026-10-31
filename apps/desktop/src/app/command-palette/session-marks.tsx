import type { ReactNode } from 'react'

import { SessionStatusDot } from '@/app/chat/session-status-dot'
import type { SessionInfo } from '@/types/fulilian'

/**
 * Session-row marks for the palette's 会话 zone (step 16 · T8, 方案 §3-T8):
 * the row-leading StatusDot, riding the SAME primitive the sidebar uses so a
 * session can never read differently between surfaces.
 */

/** The row-leading dot: the ONE session status primitive (sidebar rows, pane
 *  tabs, and now palette rows). `session` may be absent for a deep-search hit
 *  outside the recents page — the dot still resolves the live state from the
 *  stored session id. */
export const sessionLeadNode = (sessionId: string, session?: SessionInfo | null): ReactNode => (
  <SessionStatusDot session={session} storedSessionId={sessionId} />
)
