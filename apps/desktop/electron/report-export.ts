// Report & export pipeline (step 16 · T16, 方案 §5-T16).
//
// ONE invoke channel, three verbs — the renderer's report-center dialog and
// the timeline page's export actions fan in here:
//   `fulilian:report-export` { kind: 'pdf' }         → MD→PDF via the native
//       `webContents.printToPDF` (no new dependency): the renderer assembles
//       the report markdown (report-center store, section template aligned
//       with fulilian_ctf/writeup.py), main renders it in a hidden window and
//       prints A4. File lands wherever the native save dialog picks (defaults
//       to app.getPath('downloads')).
//   `fulilian:report-export` { kind: 'audit' }       → ONE structured
//       desktop.log audit marker line per export/section action (T7/T13
//       先例). The line carries atoms + a char COUNT only — never export
//       content (脱敏红线延续). Unlike the T13 star audit (which skips when
//       no case id exists), an EXPORT is a compliance event: the line is
//       written exactly once per action invocation with case=unknown as the
//       fallback — 审计零遗漏.
//   `fulilian:report-export` { kind: 'audit-lines' } → the bounded tail of
//       desktop.log filtered to the audit marker lines (T7 quick-capture /
//       T13 case-timeline / T16 report-export), the main-side data source
//       the renderer's JSONL export aggregates with the notification-center
//       feed (T15) into one JSONL document.
//
// The CSV export itself stays renderer-side (T13's fixed-column serializer +
// generic save/write IPC — column set pinned there); this module only audits
// it. Pure logic (line format, log filtering, markdown→print-HTML, filename
// sanitize) is exported for direct unit tests; every electron surface is
// injectable (fs-ipc.ts 先例).

import fs from 'node:fs'
import path from 'node:path'

import { app, dialog, ipcMain } from 'electron'

// ── Audit marker line (T7/T13 先例) ─────────────────────────────────────────

/** Marker prefix of every T16 export/section audit line. */
export const REPORT_EXPORT_AUDIT_MARKER = '[report-export:audit]'

/** Every desktop.log line that counts as an audit record for the JSONL
 *  export: the three structured marker families written so far. */
export const AUDIT_LINE_PATTERN = /\[(?:case-timeline|quick-capture|report-export):audit\]/

/** Collapse to a log-safe atom (mirrors quick-entry/case-timeline auditAtom):
 *  non-word chars fold to `_`, capped, so the trail never carries content. */
export function auditAtom(raw: unknown, fallback: string): string {
  const safe = String(raw ?? '')
    .slice(0, 64)
    .replace(/[^\w.:-]+/g, '_')

  return safe || fallback
}

/** ONE line per export/section action. Atoms + optional char COUNT only —
 *  never the export content. Always returns a line (see module header: an
 *  export audit must never be skipped, case=unknown is the fallback). */
export function formatReportExportAuditLine(payload: {
  action: string
  caseId?: null | string
  chars?: number
  outcome: string
}): string {
  const chars =
    typeof payload?.chars === 'number' && Number.isFinite(payload.chars) && payload.chars >= 0
      ? ` chars=${Math.floor(payload.chars)}`
      : ''

  return (
    `${REPORT_EXPORT_AUDIT_MARKER} case=${auditAtom(payload?.caseId, 'unknown')} ` +
    `action=${auditAtom(payload?.action, 'unknown')} outcome=${auditAtom(payload?.outcome, 'unknown')}${chars}`
  )
}

/** Filter a desktop.log chunk down to its audit marker lines (raw, newest
 *  last, bounded) — the `audit-lines` verb's pure core. */
export function filterAuditLines(content: string, maxLines = 2000): string[] {
  return String(content ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && AUDIT_LINE_PATTERN.test(line))
    .slice(-maxLines)
}

/** Bounded tail read of desktop.log (last 512 KiB) — the log is append-only
 *  and has grown unbounded before (see main.ts DESKTOP_LOG rotation), so the
 *  reader never slurps the whole file. Errors degrade to empty (the JSONL
 *  export then honestly carries only the renderer-side records). */
export const AUDIT_LOG_TAIL_BYTES = 512 * 1024

export function readAuditLogText(logPath: string): string {
  try {
    const stat = fs.statSync(logPath)
    const size = Math.min(stat.size, AUDIT_LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(size)
    const fd = fs.openSync(logPath, 'r')

    try {
      fs.readSync(fd, buffer, 0, size, stat.size - size)
    } finally {
      fs.closeSync(fd)
    }

    return buffer.toString('utf8')
  } catch {
    return ''
  }
}

// ── MD → print HTML (schema-adjacent to fulilian_ctf/writeup.py) ────────────
// 只读对照：writeup.py::writeup_to_format('html') does the same minimal
// no-dependency conversion (h1 / h2 / fenced block / list item). This module
// mirrors that rule set (+ strong + paragraph wrap) so the PDF preview of a
// future sidecar-generated writeup stays visually consistent. The Python
// red line is untouched — the real writeup keeps being produced by
// fulilian_ctf/writeup.py via the sidecar seam documented in the renderer's
// report-center store.

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function proseToHtml(prose: string): string {
  return prose
    .split('\n')
    .map(line => {
      let match = line.match(/^# (.+)$/)

      if (match) {
        return `<h1>${match[1]}</h1>`
      }

      match = line.match(/^## (.+)$/)

      if (match) {
        return `<h2>${match[1]}</h2>`
      }

      match = line.match(/^[-*] (.+)$/)

      if (match) {
        return `<li>${match[1]}</li>`
      }

      return line.trim() ? `<p>${line}</p>` : ''
    })
    .filter(Boolean)
    .join('\n')
}

/** Minimal markdown → HTML for the print path (no dependency, writeup.py
 *  rule set). Fenced blocks keep their content verbatim. */
export function markdownToReportHtml(markdown: string): string {
  const escaped = escapeHtml(String(markdown ?? ''))
  // Split on fences: even indices are prose, odd are verbatim code bodies.
  const parts = escaped.split(/```(?:\w+)?\n(.*?)```/s)
  let html = ''

  for (let index = 0; index < parts.length; index++) {
    html += index % 2 === 1 ? `<pre><code>${parts[index]}</code></pre>` : proseToHtml(parts[index] ?? '')
  }

  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

/** A4 print template. NOTE: a PDF is a PRINT artifact — the fixed print
 *  palette below is document typesetting, not a UI skin surface; the UI
 *  token discipline (--dt-* chain) governs components, not paper. */
export function reportHtmlTemplate(body: string, title: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(String(title ?? 'Report'))}</title><style>` +
    '@page { size: A4; margin: 18mm 16mm; }' +
    "body { font-family: 'Segoe UI', 'Sarasa Mono SC', system-ui, sans-serif; color: #1F2328; font-size: 12pt; line-height: 1.55; }" +
    'h1 { font-size: 20pt; border-bottom: 1px solid #D8DCE1; padding-bottom: 8px; }' +
    'h2 { font-size: 15pt; margin-top: 22px; }' +
    'li { margin: 4px 0; }' +
    "pre { background: #F5F6F7; border: 1px solid #E7E9EC; padding: 8px 10px; font-family: Consolas, 'Sarasa Mono SC', monospace; font-size: 10pt; white-space: pre-wrap; }" +
    'code { font-family: Consolas, monospace; }' +
    '</style></head><body>' +
    body +
    '</body></html>'
  )
}

/** Case/container keys can be filesystem paths (git repo roots) — fold any
 *  path-hostile run to `-` for the suggested filename. */
export function sanitizeFilename(raw: string, fallback = 'report'): string {
  const safe = String(raw ?? '')
    .replace(/[^\w.\- ]+/g, '-')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 80)

  return safe || fallback
}

// ── IPC (deps 注入、纯逻辑可测 — fs-ipc.ts / case-timeline.ts 先例) ──────────

export const REPORT_EXPORT_CHANNEL = 'fulilian:report-export'

/** Hidden window surface the PDF print path drives (injectable for tests). */
export interface ReportPrintWindow {
  close(): void
  loadUrl(url: string): Promise<void>
  printToPdf(): Promise<Uint8Array>
}

export interface ReportSaveDialogResult {
  canceled: boolean
  filePath?: string
}

export interface ReportExportIpcDeps {
  /** Structured desktop.log sink (main.ts rememberLog). */
  log?: (chunk: string) => void
  /** desktop.log path the `audit-lines` verb tails. */
  auditLogPath?: string
  /** Save-dialog default directory (main passes app.getPath('downloads')). */
  downloadsPath?: string
  /** Override the audit-log reader (tests inject). */
  readAuditText?: () => string
  /** Override the save dialog (tests inject). */
  showSaveDialog?: (options: {
    defaultPath: string
    filters: Array<{ extensions: string[]; name: string }>
    title: string
  }) => Promise<ReportSaveDialogResult>
  /** Override the hidden print window factory (tests inject). */
  createPrintWindow?: () => ReportPrintWindow
  /** Override the PDF write (tests inject). */
  writeFile?: (filePath: string, data: Uint8Array) => Promise<void>
}

function defaultCreatePrintWindow(): ReportPrintWindow {
  // Lazy require-free: BrowserWindow comes from the top-level electron import.
  const { BrowserWindow } = require('electron') as typeof import('electron')

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })

  return {
    close: () => {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    },
    loadUrl: url => win.loadURL(url),
    printToPdf: () => win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  }
}

/**
 * Register the single `fulilian:report-export` invoke handler. main.ts wires
 * it in one call with `{ log: rememberLog, auditLogPath: DESKTOP_LOG_PATH }`.
 *
 * Exactly ONE audit line per action invocation, in every outcome (written /
 * canceled / failed) — 审计零遗漏 (T16-4).
 */
export function registerReportExportIpc(deps: ReportExportIpcDeps = {}): void {
  const log = deps.log ?? (() => {})

  const showSaveDialog =
    deps.showSaveDialog ??
    (async options => {
      const result = await dialog.showSaveDialog(options)

      return { canceled: result.canceled, filePath: result.filePath }
    })

  const createPrintWindow = deps.createPrintWindow ?? defaultCreatePrintWindow

  const writeFile =
    deps.writeFile ??
    (async (filePath, data) => {
      await fs.promises.writeFile(filePath, data)
    })

  const readAuditText = deps.readAuditText ?? (() => readAuditLogText(deps.auditLogPath ?? ''))

  ipcMain.handle(REPORT_EXPORT_CHANNEL, async (_event, raw: unknown): Promise<unknown> => {
    const payload = (raw ?? {}) as Record<string, unknown>
    const kind = String(payload?.kind ?? '')

    if (kind === 'pdf') {
      const caseId = String(payload?.caseId ?? '')
      const title = String(payload?.title ?? '')
      const markdown = String(payload?.markdown ?? '')

      if (!markdown.trim()) {
        throw new Error('report-export: pdf requires the report markdown')
      }

      const downloads = deps.downloadsPath ?? app.getPath('downloads')

      const picked = await showSaveDialog({
        defaultPath: path.join(downloads, `${sanitizeFilename(caseId || 'report', 'report')}-report.pdf`),
        filters: [{ extensions: ['pdf'], name: 'PDF' }],
        title: title || 'Export report PDF'
      })

      const filePath = picked?.filePath ?? null

      if (!filePath) {
        log(formatReportExportAuditLine({ action: 'pdf', caseId, outcome: 'canceled' }))

        return { canceled: true }
      }

      const win = createPrintWindow()

      try {
        const html = reportHtmlTemplate(markdownToReportHtml(markdown), title || caseId || 'report')

        await win.loadUrl(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

        const pdf = await win.printToPdf()
        await writeFile(filePath, pdf)

        log(formatReportExportAuditLine({ action: 'pdf', caseId, chars: pdf.byteLength, outcome: 'written' }))

        return { ok: true, path: filePath }
      } catch (error) {
        log(formatReportExportAuditLine({ action: 'pdf', caseId, outcome: 'failed' }))

        throw error
      } finally {
        win.close()
      }
    }

    if (kind === 'audit') {
      const chars = typeof payload?.chars === 'number' ? payload.chars : undefined

      log(
        formatReportExportAuditLine({
          action: String(payload?.action ?? ''),
          caseId: String(payload?.caseId ?? ''),
          chars: Number.isFinite(chars) ? chars : undefined,
          outcome: String(payload?.outcome ?? '')
        })
      )

      return null
    }

    if (kind === 'audit-lines') {
      return { lines: filterAuditLines(readAuditText()) }
    }

    throw new Error(`report-export: unsupported kind ${auditAtom(kind, 'unknown')}`)
  })
}
