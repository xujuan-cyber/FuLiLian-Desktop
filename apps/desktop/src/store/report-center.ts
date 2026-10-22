// Report-center store (step 16 · T16, 方案 §5-T16).
//
// nanostores mirror of the report-center surface: the case report's section
// template (T16-2), the report draft assembled from REAL data sources only
// (T16-5 诚实落地 — starred timeline events via the T13 `starredEvents()`
// seam, honest 「无内容」 empty states when a section has nothing to say),
// and the state of the three export actions (MD→PDF / CSV / JSONL 审计).
//
// ── 章节模板对接 fulilian_ctf/writeup.py（只读对照，Python 红线零改动）──────
// writeup.py::generate_writeup 输出的章节骨架（只读对照，E:\FuLilian-Desktop\
// fulilian_ctf\writeup.py:89-133）：
//   标题块  → `# Writeup: {title}` + meta bullets（Challenge/Category/
//             Difficulty/Model/Duration）
//   「题目描述」   → description（或「（无描述）」诚实空态）
//   「解题思路」   → 黑板 Fact 时间线叙事（或「（黑板无记录的中间发现）」）
//   「关键命令」   → command 步骤 fenced bash 块，≤10 条（无则整节省略）
//   「Flag」       → flag 块 + 验证结果（或「（未解出）」）
//   「踩过的坑（死路）」→ dead_ends 列表 ≤10 条（无则整节省略）
// 写面口径：本 store 落的是**取证报告**章节模板（勘验报告规范），与 CTF
// writeup 形态对齐（标题块 + 有数据才出节的「诚实空态」策略），schema 同源。
// 未来由 sidecar 调 Python（fulilian_ctf.solve_rpc 扩 writeup method）生成
// 完整 writeup 的接入点 = `buildReportMarkdown` 换数据源；本轮 PDF/MD 由
// electron 侧生成（electron/report-export.ts），**不冒充完整 writeup**。

import { atom } from 'nanostores'

import { $caseId, starredEvents } from '@/store/case-timeline'
import type { TimelineEvent } from '@/store/case-timeline-types'

// ── Section template (T16-2) ────────────────────────────────────────────────

/** The report's section ids. Order is the document order; `source` names the
 *  REAL data feed each section renders from. The ids mirror the writeup.py
 *  skeleton's block sequence (meta → 描述 → 思路 → 关键内容 → 结论 → 附件). */
export const REPORT_SECTION_IDS = ['summary', 'timeline', 'findings', 'artifacts', 'flags'] as const

export type ReportSectionId = (typeof REPORT_SECTION_IDS)[number]

export interface ReportSection {
  id: ReportSectionId
  /** Whether the section's data feed has anything to render this round. */
  hasData: boolean
}

/** Which sections carry data for the CURRENT case. Honest: a section without
 *  a data layer this round is `hasData: false` and renders its empty state —
 *  never fabricated content (T16-5). */
export function sectionsWithData(input: { hasTimeline: boolean }): ReportSection[] {
  const hasTimeline = input?.hasTimeline === true

  return REPORT_SECTION_IDS.map(id => ({ hasData: id === 'timeline' ? hasTimeline : false, id }))
}

// ── Report draft assembly (T16-5: real data only) ───────────────────────────

const EMPTY_SECTION_MARK = '（本节暂无内容）'

function localStamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** The findings (starred timeline events) rendered as the report's bullet
 *  list. Atoms only — the event TEXT is analysis content and belongs in the
 *  deliverable, but the count line stays a count (审计口径不进正文). */
export function findingsLines(events: ReadonlyArray<TimelineEvent>): string[] {
  return events.map(event => {
    const tags = event.tags.length > 0 ? ` [${event.tags.join(', ')}]` : ''

    return `- ${localStamp(event.at)} · ${event.source} · confidence ${event.confidence}%${tags}`
  })
}

export interface ReportSourceInput {
  /** Case id (mono 案号 = the container key). */
  caseId: string
  /** The starred timeline events (T13 `starredEvents()` seam). */
  starred: ReadonlyArray<TimelineEvent>
}

/** Assemble the report markdown from REAL inputs. Deterministic, pure — the
 *  exported document the PDF/MD path prints. Sections without data render
 *  the honest empty mark; the timeline section lists the starred events. */
export function buildReportMarkdown(input: ReportSourceInput): string {
  const caseId = String(input?.caseId ?? '')
  const starred = input?.starred ?? []

  const lines: string[] = [
    `# 取证报告 ${caseId || '（未命名案件）'}`,
    '',
    `- **案件**: \`${caseId || 'n/a'}\``,
    `- **生成时间**: ${localStamp(Date.now())}`,
    '',
    '## Summary',
    '',
    EMPTY_SECTION_MARK,
    '',
    '## Timeline',
    ''
  ]

  if (starred.length > 0) {
    lines.push(...findingsLines(starred))
  } else {
    lines.push(EMPTY_SECTION_MARK)
  }

  lines.push('', '## Findings', '', EMPTY_SECTION_MARK, '', '## Artifacts', '', EMPTY_SECTION_MARK, '', '## Flags', '', EMPTY_SECTION_MARK, '')

  return lines.join('\n')
}

// ── Export action state ─────────────────────────────────────────────────────

export type ReportExportKind = 'auditJsonl' | 'csv' | 'pdf'

export interface ReportExportState {
  /** The action in flight, if any (dialog/spinner gating). */
  busy: null | ReportExportKind
  /** Last finished action's toast anchor, or the last failure message. */
  lastError: null | string
}

export const $reportExport = atom<ReportExportState>({ busy: null, lastError: null })

export function setReportExportBusy(busy: null | ReportExportKind): void {
  const state = $reportExport.get()

  $reportExport.set({ ...state, busy })
}

export function setReportExportError(lastError: null | string): void {
  const state = $reportExport.get()

  $reportExport.set({ ...state, lastError })
}

/** Reset the action state (dialog close). */
export function clearReportExportState(): void {
  $reportExport.set({ busy: null, lastError: null })
}

// ── Current-case report state ───────────────────────────────────────────────

/** The case the report center is opened for (drives the draft + audits). */
export const $reportCaseId = atom<string>('')

/** Open the report center for a case (the timeline page's [加入报告] seam). */
export function openReportCenter(caseId: string): void {
  $reportCaseId.set(caseId)
}

/** The live report draft: re-assembled from the REAL starred-events seam each
 *  read (the audit trail of the section-generation action lives with the
 *  caller — exactly one `[report-export:audit]` line per generate action). */
export function currentReportMarkdown(): string {
  return buildReportMarkdown({ caseId: $caseId.get(), starred: starredEvents() })
}

// ── Audit JSONL export (T16-1 审计 → JSONL) ─────────────────────────────────

/** One record in the audit JSONL export. Atoms + counts only (脱敏红线). */
export interface AuditJsonlRecord {
  action: string
  at: null | number
  count: number
  /** Raw desktop.log marker line, carried verbatim inside the envelope. */
  raw?: string
  source: string
}

/** Build the audit JSONL document: **every emitted line is one valid JSON
 *  object** (A5-①③ 逐行合法 JSON). The main-side desktop.log marker lines are
 *  raw text, so they ride inside a `{source:'desktop-log', raw}` envelope —
 *  never emitted bare (that would break JSONL), never parsed blind. */
export function buildAuditJsonl(
  logLines: ReadonlyArray<string>,
  records: ReadonlyArray<AuditJsonlRecord>
): string {
  const rows: AuditJsonlRecord[] = [
    ...logLines.map(line => ({
      action: 'log-marker',
      at: null,
      count: 0,
      raw: String(line),
      source: 'desktop-log'
    })),
    ...records
  ]

  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
}
