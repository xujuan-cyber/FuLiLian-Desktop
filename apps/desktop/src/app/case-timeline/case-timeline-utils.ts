// Case timeline page helpers (step 16 · T13). Pure, DOM-free logic the page
// and its tests share: the CSV export flow (save-dialog → hardened write IPC),
// the local-time rendering of event epochs, and the star-audit delegation —
// the star toggle rides the EXISTING `forensics:timeline` channel as an audit
// variant (no third channel: 通道预算两条), and main formats the structured
// desktop.log line (T7 先例；行内只有 case/source/tags 原子，无事件内容明文).

import type { Translations } from '@/i18n'
import { writeDesktopFileText } from '@/lib/desktop-fs'
import { timelineToCsv } from '@/store/case-timeline-csv'
import type { TimelineEvent } from '@/store/case-timeline-types'
import { notify } from '@/store/notifications'

/** Local "MM-DD HH:mm:ss" for the table's mono time column (预览 07). */
export function timelineEventAt(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')

  return (
    `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** Save-dialog → write IPC for the filtered events. Column names are the
 *  fixed TIMELINE_CSV_HEADER set (A5-② 单测锚定，不经 i18n)。 */
export async function runTimelineCsvExport(
  caseId: string,
  events: ReadonlyArray<TimelineEvent>,
  a: Translations['caseTimeline']
): Promise<null | string> {
  const pick = window.fulilianDesktop?.selectSavePath

  if (!pick) {
    throw new Error('Saving is not available')
  }

  const output = await pick({
    defaultPath: `${caseId || 'case'}-timeline.csv`,
    filters: [{ extensions: ['csv'], name: 'CSV' }],
    title: a.exportCsv
  })

  if (!output) {
    return null
  }

  await writeDesktopFileText(output, timelineToCsv(events))

  notify({ kind: 'success', title: a.exportCsv, message: output })

  return output
}

/** Shape of the star-audit variant riding the `forensics:timeline` channel:
 *  atoms only (case/source/tags), never the event text — the main process
 *  folds them into the `[case-timeline:audit]` desktop.log line. */
export interface TimelineStarAudit {
  at: number
  on: boolean
  source: string
  tags: readonly string[]
}

/** 星标入审计：把 toggle 结果经 `forensics:timeline` 的 audit 变体交给主进程
 *  rememberLog（T7 先例；无结构化审计 store——T8 已证缺口，记回执）。行内只有
 *  case/source/tags 原子，不含事件内容明文。fire-and-forget：失败静默。 */
export function reportTimelineStarAudit(event: TimelineEvent, on: boolean): void {
  try {
    const audit: TimelineStarAudit = {
      at: event.at,
      on,
      source: event.source,
      tags: event.tags
    }

    void window.fulilianDesktop?.caseTimeline?.timeline($currentAuditCaseId(), audit)
  } catch {
    // Bridge unavailable — the audit trail degrades; star state is local-only.
  }
}

function $currentAuditCaseId(): string {
  // Imported lazily to avoid a store→page cycle at module load; the case id is
  // whatever the page has loaded (the audit line is per-case).
  return timelineAuditCaseId
}

let timelineAuditCaseId = ''

/** The page seeds the case id once per load so audit lines name the case. */
export function setTimelineAuditCaseId(caseId: string): void {
  timelineAuditCaseId = caseId
}
