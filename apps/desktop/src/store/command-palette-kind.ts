import { setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { $newChatProfile, requestFreshSession } from '@/store/profile'

/**
 * Command-palette work-mode new-session actions (step 16 · T8, 方案 §3-T8
 * 动作区「新建三模式」).
 *
 * Kind payload口径 — same as T6 tray / T7 quick capture: the kind rides the
 * payload as RECORDED INTENT, never as a fabricated container. The kind data
 * layer does not exist yet (`container-kind.ts` still answers `'project'` for
 * everything), so today every new session lands as a project container; the
 * mode is dispatched on the same `fulilian:new-session-shortcut` event the
 * ⌘N path uses, in `event.detail.kind`, for the creation seam that will
 * consume it once the kind column lands.
 *
 * The session start itself is the REAL flow: workspace scope back to sessions,
 * any stale quick-create profile selection cleared, then a fresh draft via
 * `$freshSessionRequest` — the store-level trigger that the chat controller
 * subscribes to (same destination as the `session.new` keybind).
 */

/** The three work-mode containers (DESIGN_PROPOSAL §4.1 vocabulary). */
export type PaletteSessionKind = 'ctf' | 'forensics' | 'project'

export const PALETTE_SESSION_KINDS: readonly PaletteSessionKind[] = ['forensics', 'ctf', 'project']

export function startNewSessionWithKind(kind: PaletteSessionKind): void {
  setWorkspaceScope('sessions')
  $newChatProfile.set(null)
  requestFreshSession()
  window.dispatchEvent(new CustomEvent('fulilian:new-session-shortcut', { detail: { kind } }))
}
