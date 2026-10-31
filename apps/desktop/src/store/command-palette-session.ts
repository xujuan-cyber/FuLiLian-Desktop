import { setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { $newChatProfile, requestFreshSession } from '@/store/profile'

/**
 * Command-palette new-session action (step 16 · T8 动作区).
 *
 * The session start is the REAL flow: workspace scope back to sessions, any
 * stale quick-create profile selection cleared, then a fresh draft via
 * `$freshSessionRequest` — the store-level trigger the chat controller
 * subscribes to (same destination as the `session.new` keybind).
 *
 * It also fires the same `fulilian:new-session-shortcut` window event the ⌘N
 * path uses, so the sidebar's listener treats both doors identically.
 *
 * P1 note: this module used to carry a `kind` payload ('forensics' | 'ctf' |
 * 'project') for the three work modes. The modes are gone and nothing ever
 * consumed `detail.kind`, so the payload — and the vocabulary with it — was
 * dropped. A new session is just a new session.
 */
export function startNewSession(): void {
  setWorkspaceScope('sessions')
  $newChatProfile.set(null)
  requestFreshSession()
  window.dispatchEvent(new CustomEvent('fulilian:new-session-shortcut'))
}
