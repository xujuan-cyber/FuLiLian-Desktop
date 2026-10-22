import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import { useCallback } from 'react'

import { searchSessions } from '@/api/sessions'
import { sessionTitle } from '@/lib/chat-runtime'
import { normalize } from '@/lib/text'
import { $sessions } from '@/store/session'
import type { SessionSearchResult } from '@/types/fulilian'

import type { CompletionEntry, CompletionPayload } from './use-live-completion-adapter'
import { useLiveCompletionAdapter } from './use-live-completion-adapter'

/** How many rows the drawer shows before it just stops being a list. */
const SESSION_INLINE_LIMIT = 8

interface HashItemMetadata extends Record<string, string> {
  display: string
  meta: string
  /** The session to jump to on a modifier-click. Empty for rows without one. */
  sessionId: string
  /** The inserted reference text — the session title, verbatim. */
  rawText: string
}

interface HashCandidate {
  id: string
  preview: string
  title: string
}

function localCandidates(query: string): HashCandidate[] {
  const needle = normalize(query)
  const sessions = $sessions.get()

  if (!needle) {
    return sessions.slice(0, SESSION_INLINE_LIMIT).map(session => ({
      id: session.id,
      preview: (session.preview ?? '').trim(),
      title: sessionTitle(session)
    }))
  }

  return sessions
    .filter(
      session =>
        sessionTitle(session).toLowerCase().includes(needle) ||
        (session.preview ?? '').toLowerCase().includes(needle) ||
        session.id.toLowerCase().includes(needle)
    )
    .slice(0, SESSION_INLINE_LIMIT)
    .map(session => ({
      id: session.id,
      preview: (session.preview ?? '').trim(),
      title: sessionTitle(session)
    }))
}

function remoteCandidates(results: SessionSearchResult[], seen: Set<string>): HashCandidate[] {
  const out: HashCandidate[] = []

  for (const result of results) {
    if (seen.has(result.session_id)) {
      continue
    }

    seen.add(result.session_id)

    // A search hit stands in for the full row: the search endpoint returns a
    // content snippet, not the stored title, so the snippet IS the honest
    // description of why this session matched.
    out.push({
      id: result.session_id,
      preview: (result.snippet ?? '').trim(),
      title: (result.snippet ?? '').trim() || result.session_id
    })

    if (out.length >= SESSION_INLINE_LIMIT) {
      break
    }
  }

  return out
}

function toEntry(candidate: HashCandidate): CompletionEntry {
  return {
    display: candidate.title,
    meta: candidate.preview,
    sessionId: candidate.id,
    text: candidate.title
  }
}

/** Live `#` completions — quick references to other sessions. The list is the
 *  local recent-sessions window (the same store the sidebar and `/resume` read)
 *  widened by the full-library search endpoint when a query is typed. Picking a
 *  row inserts the session's title as plain text: the message protocol has no
 *  session-reference payload, so no context injection is claimed — and a
 *  modifier-click on a row jumps to that session instead (wired by the
 *  composer via the item's `sessionId` metadata). */
export function useHashCompletions(options: { enabled: boolean }): {
  adapter: Unstable_TriggerAdapter
  loading: boolean
} {
  const { enabled } = options

  const fetcher = useCallback(async (query: string): Promise<CompletionPayload> => {
    const local = localCandidates(query)
    const seen = new Set(local.map(candidate => candidate.id))

    // Deep search only earns its round trip once the local window can't answer:
    // an empty query browses recents, and a narrow query may have buried hits
    // past the sidebar's page window.
    if (query.trim()) {
      try {
        const response = await searchSessions(query.trim())
        const remote = remoteCandidates(response.results ?? [], seen)

        return { items: [...local, ...remote].slice(0, SESSION_INLINE_LIMIT).map(toEntry), query }
      } catch {
        // The local window is the floor: an unreachable search degrades to it
        // rather than emptying a popover the store could already fill.
      }
    }

    return { items: local.map(toEntry), query }
  }, [])

  const toItem = useCallback((entry: CompletionEntry, index: number): Unstable_TriggerItem => {
    const title = typeof entry.text === 'string' ? entry.text : ''
    const meta = typeof entry.meta === 'string' ? entry.meta : ''

    const metadata: HashItemMetadata = {
      display: title,
      meta,
      // The id rides out-of-band: search rows resolve by id, and the composer
      // reads it for the modifier-click jump. A title collision never matters
      // because the insert is the title itself.
      sessionId: entry.sessionId ?? '',
      rawText: title
    }

    return {
      id: `${entry.text}|${index}`,
      type: 'session',
      label: title,
      ...(meta ? { description: meta } : {}),
      metadata
    }
  }, [])

  // Local rows answer synchronously from the store; only the search widened
  // queries wait on the network, and those always miss the cache.
  const isCached = useCallback((query: string) => !query.trim(), [])

  return useLiveCompletionAdapter({ debounceMs: 200, enabled, fetcher, isCached, toItem })
}
