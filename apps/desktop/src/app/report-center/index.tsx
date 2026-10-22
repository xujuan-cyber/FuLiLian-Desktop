// Report-center dialog (step 16 · T16, 方案 §5-T16) — the unified export
// entry (统一入口).
//
// Mounted in the case-timeline page head: the T13「加入报告」button opens this
// dialog instead of firing the honest-placeholder toast. One surface for the
// three export verbs (方案 §5-T16: MD→PDF / 时间线 CSV / 审计 JSONL) plus the
// section template (T16-2) and its draft preview (T16-5):
//
// - PDF: the draft markdown (report-center store, section schema aligned with
//   fulilian_ctf/writeup.py — the seam comment there points at the sidecar
//   writeup handoff) goes over the `reportExport.pdf` bridge; main renders it
//   through the native `webContents.printToPDF` (no new dependency) behind a
//   save dialog defaulting to Downloads.
// - CSV: reuses the T13 fixed-column serializer verbatim (TIMELINE_CSV_HEADER
//   pinned; 列名固定集不破坏).
// - Audit JSONL: aggregates the desktop.log audit-marker tail (`auditLines`
//   bridge) with the notification-center feed + starred findings into one
//   JSONL document — one JSON object per line.
//
// 审计零遗漏 (T16-4): every export action and the draft-assembly action
// records exactly one `[report-export:audit]` desktop.log marker line through
// the `audit` bridge verb (atoms + char count only — never export content,
// T7/T13 口径). The star toggle audit stays T13's (case-timeline:audit).

import { useStore } from '@nanostores/react'
import { useCallback, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { writeDesktopFileText } from '@/lib/desktop-fs'
import { CheckCircle2, FileText } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $caseId, starredEvents } from '@/store/case-timeline'
import { timelineToCsv } from '@/store/case-timeline-csv'
import { notify, notifyError } from '@/store/notifications'
import {
  $reportExport,
  buildAuditJsonl,
  buildReportMarkdown,
  REPORT_SECTION_IDS,
  type ReportSectionId,
  sectionsWithData,
  setReportExportBusy,
  setReportExportError
} from '@/store/report-center'

/** Shape of one JSONL line in the audit export. Atoms + counts only. */
interface AuditRecord {
  at: number
  source: 'notification-center' | 'report-star'
  action: string
  count: number
}

/** Collect the audit records the renderer owns (T15 feed + star set); the
 *  desktop.log marker tail rides `auditLines`. Every line is one JSON object
 *  — 逐行合法 JSON (A5-①③). */
function collectAuditRecords(): AuditRecord[] {
  const starred = starredEvents()

  return [
    {
      action: 'starred-findings',
      at: Date.now(),
      count: starred.length,
      source: 'report-star'
    }
  ]
}

export function ReportCenterDialog({ open, onOpenChange }: { onOpenChange: (open: boolean) => void; open: boolean }) {
  const { t } = useI18n()
  const a = t.reportCenter
  const caseId = useStore($caseId)
  const exportState = useStore($reportExport)
  const starred = useMemo(() => starredEvents(), [caseId, open])
  const sections = useMemo(() => sectionsWithData({ hasTimeline: starred.length > 0 }), [starred.length])
  const [draft, setDraft] = useState<null | string>(null)

  /** ONE audit line per action (T16-4). Fire-and-forget; failure is silent —
   *  the audit trail degrades but the export result toast is honest. */
  const audit = useCallback(
    (action: string, outcome: string, chars?: number) => {
      void window.fulilianDesktop?.reportExport?.audit({ action, caseId, chars, outcome })
    },
    [caseId]
  )

  const generateDraft = useCallback(() => {
    setDraft(buildReportMarkdown({ caseId, starred }))
    audit('sections.generate', 'written', buildReportMarkdown({ caseId, starred }).length)
    notify({ kind: 'success', title: a.sectionsGenerated, message: a.draftHint })
  }, [a, audit, caseId, starred])

  const exportPdf = useCallback(async () => {
    const bridge = window.fulilianDesktop?.reportExport

    if (!bridge) {
      notifyError(new Error('Desktop IPC bridge is unavailable'), a.exportPdfFailed)

      return
    }

    setReportExportBusy('pdf')

    try {
      const markdown = draft ?? buildReportMarkdown({ caseId, starred })
      const result = await bridge.pdf({ caseId, markdown, title: a.title })

      if (result?.canceled) {
        audit('pdf', 'canceled')
      } else {
        audit('pdf', 'written', markdown.length)
        notify({ kind: 'success', title: a.pdfSaved, message: result?.path ?? '' })
      }
    } catch (error) {
      setReportExportError(error instanceof Error ? error.message : String(error))
      notifyError(error, a.exportPdfFailed)
      audit('pdf', 'failed')
    } finally {
      setReportExportBusy(null)
    }
  }, [a, audit, caseId, draft, starred])

  const exportCsv = useCallback(async () => {
    const pick = window.fulilianDesktop?.selectSavePath

    if (!pick) {
      notifyError(new Error('Saving is not available'), a.exportCsvFailed)

      return
    }

    setReportExportBusy('csv')

    try {
      const output = await pick({
        defaultPath: `${caseId || 'case'}-timeline.csv`,
        filters: [{ extensions: ['csv'], name: 'CSV' }],
        title: a.exportCsv
      })

      if (!output) {
        audit('csv', 'canceled')

        return
      }

      // The T13 fixed-column serializer — same header, same RFC 4180 quoting
      // (列名固定集 at_iso,source,event,confidence,tags 不破坏, A5-⑥).
      const csv = timelineToCsv(starred)

      await writeDesktopFileText(output, csv)
      audit('csv', 'written', csv.length)
      notify({ kind: 'success', title: a.exportCsv, message: output })
    } catch (error) {
      notifyError(error, a.exportCsvFailed)
      audit('csv', 'failed')
    } finally {
      setReportExportBusy(null)
    }
  }, [a, audit, caseId, starred])

  const exportAuditJsonl = useCallback(async () => {
    const bridge = window.fulilianDesktop?.reportExport
    const pick = window.fulilianDesktop?.selectSavePath

    if (!bridge || !pick) {
      notifyError(new Error('Saving is not available'), a.exportAuditFailed)

      return
    }

    setReportExportBusy('auditJsonl')

    try {
      const output = await pick({
        defaultPath: `${caseId || 'case'}-audit.jsonl`,
        filters: [{ extensions: ['jsonl'], name: 'JSONL' }],
        title: a.exportAuditJsonl
      })

      if (!output) {
        audit('audit-jsonl', 'canceled')

        return
      }

      // desktop.log audit-marker tail (main-side) + renderer-owned records —
      // every emitted line is one valid JSON object (A5-①③ 逐行合法 JSON).
      const { lines } = await bridge.auditLines()
      const jsonl = buildAuditJsonl(lines, collectAuditRecords())

      await writeDesktopFileText(output, jsonl)
      audit('audit-jsonl', 'written', jsonl.length)
      notify({ kind: 'success', title: a.auditSaved, message: output })
    } catch (error) {
      notifyError(error, a.exportAuditFailed)
      audit('audit-jsonl', 'failed')
    } finally {
      setReportExportBusy(null)
    }
  }, [a, audit, caseId])

  const SECTION_LABEL: Record<ReportSectionId, string> = {
    artifacts: a.sectionArtifacts,
    findings: a.sectionFindings,
    flags: a.sectionFlags,
    summary: a.sectionSummary,
    timeline: a.sectionTimeline
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent bodyClassName="gap-5" className="max-w-xl" data-testid="report-center-dialog">
        <DialogHeader>
          <DialogTitle icon={FileText}>{a.title}</DialogTitle>
          <DialogDescription>{a.draftHint}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{a.caseLabel}</span>
            <span className="font-mono text-[13px]">{caseId || '—'}</span>
            <span className="ml-auto text-xs text-muted-foreground" data-testid="report-center-starred-count">
              {a.starredCount(starred.length)}
            </span>
          </div>

          <div className="grid gap-1.5" data-testid="report-center-sections">
            <span className="text-[11px] font-bold tracking-wide text-muted-foreground">{a.sectionsHeading}</span>
            <div className="flex flex-wrap gap-1.5">
              {REPORT_SECTION_IDS.map(id => {
                const section = sections.find(entry => entry.id === id)

                return (
                  <span
                    className={cn(
                      'inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px]',
                      section?.hasData
                        ? 'bg-accent font-bold text-accent-foreground'
                        : 'bg-secondary text-muted-foreground ring-1 ring-border'
                    )}
                    data-active={section?.hasData ? 'true' : undefined}
                    data-testid={`report-center-section-${id}`}
                    key={id}
                  >
                    {section?.hasData ? <CheckCircle2 className="mr-1 size-3" /> : null}
                    {SECTION_LABEL[id]}
                  </span>
                )
              })}
            </div>
            <span className="text-[11px] text-muted-foreground">{a.sectionEmpty}</span>
          </div>

          {draft !== null && (
            <pre
              className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed"
              data-testid="report-center-draft"
            >
              {draft}
            </pre>
          )}

          {starred.length === 0 && draft === null && (
            <p className="text-xs text-muted-foreground" data-testid="report-center-empty">
              {a.emptyDraft}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button disabled={exportState.busy !== null} onClick={exportAuditJsonl} size="sm" variant="ghost">
            {a.exportAuditJsonl}
          </Button>
          <Button disabled={exportState.busy !== null} onClick={exportCsv} size="sm" variant="outline">
            {a.exportCsv}
          </Button>
          <Button disabled={exportState.busy !== null} onClick={exportPdf} size="sm">
            {exportState.busy === 'pdf' ? a.exportBusy : a.exportPdf}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
