import { atom } from 'nanostores'

// SESSION CHANGES (step14 R2) — open state for the session-scoped changes
// review pane. The repo-level diff review lives in store/review.ts (⌘G); this
// is the per-conversation complement: files the FOCUSED session's tool calls
// touched, each expanding to its working-tree-vs-HEAD diff. Scope is honest
// "files this session touched" — the backend has no session⇄commit ownership
// (probe T0), so this is not a git-level change list.

export const $sessionChangesOpen = atom(false)

export function openSessionChanges(): void {
  $sessionChangesOpen.set(true)
}

export function closeSessionChanges(): void {
  $sessionChangesOpen.set(false)
}

export function toggleSessionChanges(): void {
  $sessionChangesOpen.set(!$sessionChangesOpen.get())
}
