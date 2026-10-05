/**
 * Quick capture inbox (step 16 · T7) — where the capture window's 速记 mode
 * lands.
 *
 * The DESIGN_PROPOSAL routes a note captured without a target container to a
 * "no-container inbox" that a future notification center (step 16 · T15) will
 * surface. That center does not exist yet, so this store is the honest,
 * minimal form of the commitment: a small, append-only, localStorage-backed
 * list — the SAME persistence mechanism the composer drafts and every other
 * renderer preference already use, nothing new invented. The unread surface,
 * badges, and grouping are T15's to add on top of `readQuickCaptureNotes`.
 */

import { atom } from 'nanostores'

export interface QuickCaptureNote {
  at: string
  id: string
  text: string
}

export const QUICK_CAPTURE_INBOX_STORAGE_KEY = 'fulilian:quick-capture-inbox:v1'

// A capture surface accumulates one-liners; without a cap the JSON blob grows
// forever. 200 notes is far past what a human replays, and the eviction drops
// the OLDEST first (same MRU shape as the composer draft stash).
export const QUICK_CAPTURE_INBOX_LIMIT = 200

/** The renderer-visible mirror, primed on first read (T15 will subscribe). */
export const $quickCaptureNotes = atom<QuickCaptureNote[]>([])

function parseStored(raw: null | string): QuickCaptureNote[] {
  if (!raw) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (note): note is QuickCaptureNote =>
        !!note &&
        typeof note === 'object' &&
        typeof (note as QuickCaptureNote).id === 'string' &&
        typeof (note as QuickCaptureNote).at === 'string' &&
        typeof (note as QuickCaptureNote).text === 'string'
    )
  } catch {
    // A hand-edited or truncated blob must not break the next capture.
    return []
  }
}

function persist(notes: QuickCaptureNote[]): void {
  try {
    window.localStorage.setItem(QUICK_CAPTURE_INBOX_STORAGE_KEY, JSON.stringify(notes))
  } catch {
    // Best-effort only — quota/private-mode must never break a capture.
  }

  $quickCaptureNotes.set(notes)
}

/** Read the persisted inbox into the atom (T15's mount-time warm-up). */
export function loadQuickCaptureNotes(): QuickCaptureNote[] {
  let notes: QuickCaptureNote[] = []

  try {
    notes = parseStored(window.localStorage.getItem(QUICK_CAPTURE_INBOX_STORAGE_KEY))
  } catch {
    notes = []
  }

  $quickCaptureNotes.set(notes)

  return notes
}

/** Append a trimmed note; whitespace-only text is rejected. Returns the note
 *  that was stored, or null when nothing was. */
export function appendQuickCaptureNote(text: string): QuickCaptureNote | null {
  const trimmed = typeof text === 'string' ? text.trim() : ''

  if (!trimmed) {
    return null
  }

  const existing = typeof window === 'undefined' ? [] : loadQuickCaptureNotes()
  const note: QuickCaptureNote = { at: new Date().toISOString(), id: crypto.randomUUID(), text: trimmed }
  const next = [...existing, note].slice(-QUICK_CAPTURE_INBOX_LIMIT)

  persist(next)

  return note
}

/** Drain the inbox (T15's future "mark handled"). Returns what was there. */
export function clearQuickCaptureNotes(): QuickCaptureNote[] {
  const existing = typeof window === 'undefined' ? [] : loadQuickCaptureNotes()

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(QUICK_CAPTURE_INBOX_STORAGE_KEY)
    } catch {
      // Best-effort only.
    }
  }

  $quickCaptureNotes.set([])

  return existing
}
