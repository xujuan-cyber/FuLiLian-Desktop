// Fixed-column CSV serializer for the case timeline export (step 16 · T13).
// Own module (leaf, DOM-free) so the column-name contract is importable from
// both the page and tests without dragging React in. Mirrors the electron
// bridge's serializer (`electron/case-timeline.ts` timelineToCsv) exactly:
// same header, same RFC 4180 quoting — the two are kept in lockstep by the
// mirrored unit tests pinning `at_iso,source,event,confidence,tags`.

import type { TimelineEvent } from '@/store/case-timeline-types'

/** Fixed CSV header — pinned by unit tests on BOTH sides; never localized. */
export const TIMELINE_CSV_HEADER = 'at_iso,source,event,confidence,tags'

function csvCell(raw: string): string {
  const value = String(raw ?? '')

  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Serialize timeline events to CSV (RFC 4180 quoting; header always first). */
export function timelineToCsv(events: ReadonlyArray<TimelineEvent>): string {
  const rows = events.map(event =>
    [
      new Date(event.at).toISOString(),
      csvCell(event.source),
      csvCell(event.event),
      String(event.confidence),
      csvCell(event.tags.join(';'))
    ].join(',')
  )

  return [TIMELINE_CSV_HEADER, ...rows].join('\r\n')
}
