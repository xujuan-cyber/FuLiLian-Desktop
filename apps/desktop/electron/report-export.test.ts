// Report-export pipeline tests (step 16 · T16). The module is injectable, so
// every electron surface (dialog, BrowserWindow, fs) is faked; the audit
// assertions pin the T16-4 「审计零遗漏」 contract: exactly one marker line
// per action invocation, in every outcome.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AUDIT_LINE_PATTERN,
  type ReportExportIpcDeps,
  type ReportPrintWindow,
  REPORT_EXPORT_AUDIT_MARKER,
  REPORT_EXPORT_CHANNEL,
  filterAuditLines,
  formatReportExportAuditLine,
  markdownToReportHtml,
  registerReportExportIpc,
  reportHtmlTemplate,
  sanitizeFilename
} from './report-export'

// Harness capturing ipcMain.handle registrations so the channel handler is
// invoked directly — no electron runtime involved (case-timeline.test.ts 先例).
const { ipcHandle, ipcLog } = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  ipcLog: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: ipcHandle } }))

function registeredHandler(): (event: unknown, payload?: unknown) => Promise<unknown> {
  const call = ipcHandle.mock.calls.find(entry => entry[0] === REPORT_EXPORT_CHANNEL)

  if (!call) {
    throw new Error(`channel not registered: ${REPORT_EXPORT_CHANNEL}`)
  }

  return call[1] as (event: unknown, payload?: unknown) => Promise<unknown>
}

interface Harness {
  close: ReturnType<typeof vi.fn>
  loadUrl: ReturnType<typeof vi.fn>
  printToPdf: ReturnType<typeof vi.fn>
  savedBytes?: Uint8Array
  saveDialog: ReturnType<typeof vi.fn>
  writeFile: ReturnType<typeof vi.fn>
}

function makePrintWindow(bytes: Uint8Array): ReportPrintWindow {
  return {
    close: vi.fn(),
    loadUrl: vi.fn().mockResolvedValue(undefined),
    printToPdf: vi.fn().mockResolvedValue(bytes)
  }
}

function mountHarness(pdfBytes: Uint8Array): { handle: (payload: unknown) => Promise<unknown>; tools: Harness } {
  ipcHandle.mockClear()
  ipcLog.mockClear()

  const tools: Harness = {
    close: vi.fn(),
    loadUrl: vi.fn().mockResolvedValue(undefined),
    printToPdf: vi.fn().mockResolvedValue(pdfBytes),
    saveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: 'C:\\Users\\x\\Downloads\\CASE-1-report.pdf' }),
    writeFile: vi.fn().mockResolvedValue(undefined)
  }

  const win: ReportPrintWindow = {
    close: tools.close as unknown as () => void,
    loadUrl: tools.loadUrl as unknown as (url: string) => Promise<void>,
    printToPdf: tools.printToPdf as unknown as () => Promise<Uint8Array>
  }

  registerReportExportIpc({
    log: ipcLog,
    createPrintWindow: () => win,
    showSaveDialog: tools.saveDialog as unknown as ReportExportIpcDeps['showSaveDialog'],
    writeFile: tools.writeFile as unknown as ReportExportIpcDeps['writeFile'],
    downloadsPath: 'C:\\Users\\x\\Downloads'
  })

  return { handle: payload => registeredHandler()({}, payload), tools }
}

beforeEach(() => {
  ipcHandle.mockClear()
  ipcLog.mockClear()
})

// ── Audit line format (atoms + count only, 脱敏红线) ────────────────────────

describe('formatReportExportAuditLine', () => {
  it('always returns exactly one line — case=unknown fallback, never empty (审计零遗漏)', () => {
    // An EXPORT is a compliance event: even with no case id the line exists.
    expect(formatReportExportAuditLine({ action: 'pdf', outcome: 'written' })).toBe(
      `${REPORT_EXPORT_AUDIT_MARKER} case=unknown action=pdf outcome=written`
    )
  })

  it('carries only atoms + a char count — content never fits the line', () => {
    const line = formatReportExportAuditLine({
      action: 'sections.generate',
      caseId: 'CASE 2026-014',
      chars: 1234,
      outcome: 'written'
    })

    expect(line).toBe(`${REPORT_EXPORT_AUDIT_MARKER} case=CASE_2026-014 action=sections.generate outcome=written chars=1234`)
    // No markdown/prose leakage into the audit trail.
    expect(line).not.toMatch(/报告|writeup|flag\{/)
  })

  it('folds hostile atoms (newlines, spaces) to underscores', () => {
    const line = formatReportExportAuditLine({ action: 'a\nb c', caseId: 'x/y\\z', outcome: 'o!' })

    expect(line).toBe(`${REPORT_EXPORT_AUDIT_MARKER} case=x_y_z action=a_b_c outcome=o_`)
  })
})

// ── Audit-line filter (the JSONL export's main-side source) ─────────────────

describe('filterAuditLines', () => {
  it('keeps exactly the three audit marker families, trims the rest', () => {
    const chunk = [
      '[2026-10-06T01:00:00Z] [fulilian] [boot] ready',
      '[2026-10-06T01:01:00Z] [fulilian] [case-timeline:audit] case=C1 action=star source=log tags=boot',
      '[2026-10-06T01:02:00Z] [fulilian] [quick-capture:audit] mode=forensics target=x chars=12 outcome=forwarded',
      'garbage without marker',
      '',
      '[2026-10-06T01:03:00Z] [fulilian] [report-export:audit] case=C1 action=pdf outcome=written chars=900'
    ].join('\n')

    const lines = filterAuditLines(chunk)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('[case-timeline:audit]')
    expect(lines[1]).toContain('[quick-capture:audit]')
    expect(lines[2]).toContain('[report-export:audit]')
  })

  it('bounds the tail to maxLines (newest kept)', () => {
    const chunk = Array.from({ length: 10 }, (_, i) => `[report-export:audit] case=c${i} action=a outcome=w`).join('\n')
    const lines = filterAuditLines(chunk, 3)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('c7')
    expect(lines[2]).toContain('c9')
  })

  it('pattern covers the three families and nothing looser', () => {
    expect(AUDIT_LINE_PATTERN.test('[case-timeline:audit]')).toBe(true)
    expect(AUDIT_LINE_PATTERN.test('[quick-capture:audit]')).toBe(true)
    expect(AUDIT_LINE_PATTERN.test('[report-export:audit]')).toBe(true)
    expect(AUDIT_LINE_PATTERN.test('[case-timeline]')).toBe(false)
    expect(AUDIT_LINE_PATTERN.test('[notification] x')).toBe(false)
  })
})

// ── MD → print HTML (writeup.py rule set, 只读对照) ─────────────────────────

describe('markdownToReportHtml', () => {
  it('mirrors writeup.py::writeup_to_format html rules (h1/h2/fence/li)', () => {
    const html = markdownToReportHtml('# Writeup: t\n\n## 题目描述\n\ntext\n\n```bash\nwhoami\n```\n\n- item\n')

    expect(html).toContain('<h1>Writeup: t</h1>')
    expect(html).toContain('<h2>题目描述</h2>')
    expect(html).toContain('<p>text</p>')
    expect(html).toContain('<pre><code>whoami\n</code></pre>')
    expect(html).toContain('<li>item</li>')
  })

  it('escapes angle brackets outside and inside prose (no injection into the print doc)', () => {
    const html = markdownToReportHtml('# a <script>alert(1)</script>')

    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})

describe('reportHtmlTemplate / sanitizeFilename', () => {
  it('A4 template wraps the body and carries a charset meta', () => {
    const doc = reportHtmlTemplate('<h1>x</h1>', 'T')

    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('@page { size: A4;')
    expect(doc).toContain('charset="utf-8"')
    expect(doc).toContain('<h1>x</h1>')
  })

  it('filename folds path-hostile runs (git repo roots are legal case keys)', () => {
    expect(sanitizeFilename('D:\\repos\\case one')).toBe('D-repos-case one')
    expect(sanitizeFilename('...')).toBe('report')
  })
})

// ── The registered channel (end-to-end through the handler) ─────────────────

describe('registerReportExportIpc', () => {
  it('pdf: saves → writes → exactly ONE audit line with outcome=written + char count', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
    const { handle, tools } = mountHarness(bytes)

    const result = (await handle({ caseId: 'CASE-1', kind: 'pdf', markdown: '# t', title: 'T' })) as {
      ok: boolean
      path: string
    }

    expect(result).toEqual({ ok: true, path: 'C:\\Users\\x\\Downloads\\CASE-1-report.pdf' })
    expect(tools.printToPdf).toHaveBeenCalledTimes(1)
    expect(tools.writeFile).toHaveBeenCalledWith('C:\\Users\\x\\Downloads\\CASE-1-report.pdf', bytes)
    expect(tools.close).toHaveBeenCalledTimes(1)

    const auditLines = ipcLog.mock.calls.map(call => String(call[0])).filter(line => line.includes(REPORT_EXPORT_AUDIT_MARKER))

    expect(auditLines).toHaveLength(1)
    expect(auditLines[0]).toContain('action=pdf')
    expect(auditLines[0]).toContain('outcome=written')
    expect(auditLines[0]).toContain('chars=4')
  })

  it('pdf: canceled dialog still logs exactly ONE audit line (outcome=canceled)', async () => {
    ipcHandle.mockClear()
    ipcLog.mockClear()

    const saveDialog = vi.fn().mockResolvedValue({ canceled: true })

    registerReportExportIpc({
      log: ipcLog,
      showSaveDialog: saveDialog,
      downloadsPath: 'C:\\Users\\x\\Downloads'
    })

    const result = await registeredHandler()({}, { caseId: 'CASE-1', kind: 'pdf', markdown: '# t' })

    expect(result).toEqual({ canceled: true })
    expect(saveDialog).toHaveBeenCalledTimes(1)

    const auditLines = ipcLog.mock.calls.map(call => String(call[0])).filter(line => line.includes(REPORT_EXPORT_AUDIT_MARKER))

    expect(auditLines).toHaveLength(1)
    expect(auditLines[0]).toContain('outcome=canceled')
  })

  it('pdf: print failure still logs exactly ONE audit line (outcome=failed) and rejects', async () => {
    ipcHandle.mockClear()
    ipcLog.mockClear()

    const saveDialog = vi.fn().mockResolvedValue({ canceled: false, filePath: 'x.pdf' })
    const win = {
      close: vi.fn(),
      loadUrl: vi.fn().mockResolvedValue(undefined),
      printToPdf: vi.fn().mockRejectedValue(new Error('print failed'))
    }

    registerReportExportIpc({
      log: ipcLog,
      createPrintWindow: () => win,
      showSaveDialog: saveDialog,
      writeFile: vi.fn(),
      downloadsPath: 'C:\\Users\\x\\Downloads'
    })

    await expect(registeredHandler()({}, { caseId: 'CASE-1', kind: 'pdf', markdown: '# t' })).rejects.toThrow('print failed')
    expect(win.close).toHaveBeenCalledTimes(1)

    const auditLines = ipcLog.mock.calls.map(call => String(call[0])).filter(line => line.includes(REPORT_EXPORT_AUDIT_MARKER))

    expect(auditLines).toHaveLength(1)
    expect(auditLines[0]).toContain('outcome=failed')
  })

  it('pdf: rejects an empty markdown BEFORE any side effect (honest empty, no blank PDF)', async () => {
    const { handle, tools } = mountHarness(new Uint8Array([1]))

    await expect(handle({ caseId: 'CASE-1', kind: 'pdf', markdown: '   ' })).rejects.toThrow()
    expect(tools.saveDialog).not.toHaveBeenCalled()
    expect(ipcLog.mock.calls.filter(call => String(call[0]).includes(REPORT_EXPORT_AUDIT_MARKER))).toHaveLength(0)
  })

  it('audit verb: forwards the atoms through exactly one log call', async () => {
    const { handle } = mountHarness(new Uint8Array())

    await handle({ action: 'csv', caseId: 'CASE-2', chars: 88, kind: 'audit', outcome: 'written' })

    expect(ipcLog).toHaveBeenCalledTimes(1)
    expect(String(ipcLog.mock.calls[0][0])).toBe(`${REPORT_EXPORT_AUDIT_MARKER} case=CASE-2 action=csv outcome=written chars=88`)
  })

  it('audit-lines verb: returns the filtered desktop.log marker lines', async () => {
    ipcHandle.mockClear()
    ipcLog.mockClear()

    const content = [
      '[x] [case-timeline:audit] case=C1 action=star source=log tags=-',
      'noise',
      '[x] [report-export:audit] case=C1 action=pdf outcome=written chars=10'
    ].join('\n')

    registerReportExportIpc({ log: ipcLog, readAuditText: () => content })

    const result = (await registeredHandler()({}, { kind: 'audit-lines' })) as { lines: string[] }

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toContain('case-timeline:audit')
  })

  it('unknown kind rejects with the sanitized kind in the message', async () => {
    const { handle } = mountHarness(new Uint8Array())

    await expect(handle({ kind: 'shell' })).rejects.toThrow('shell')
  })

  it('defaultPath lands in the downloads directory (导出路径走读 ⑤)', async () => {
    const bytes = new Uint8Array([0x25])
    const { handle, tools } = mountHarness(bytes)

    await handle({ caseId: 'D:\\case x', kind: 'pdf', markdown: '# t' })

    expect(tools.saveDialog.mock.calls[0][0].defaultPath).toBe('C:\\Users\\x\\Downloads\\D-case x-report.pdf')
  })
})
