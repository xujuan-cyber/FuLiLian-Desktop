// Case timeline bridge (step 16 · T13, 方案 §5-T13「前置」).
//
// Two IPC channels the timeline page consumes:
//   `ctf:importEvent`     — CTFd-adapted challenge import (seeded events for
//                           the imported challenge land on the timeline).
//   `forensics:timeline`  — timeline extraction for a case: rows of
//                           { at, source, event, confidence, tags[] }.
//
// ⚠ MOCK 口径（方案明示）：P2 取证时间线提取管线未就绪 ⇒ 默认路径返回确定性
// mock 数据集（纯函数生成、无随机、含时间/来源/置信度分布可测），数据层显式
// 标注 `mockGenerated: true`，UI 必须呈现 mock 标注、不得冒充真实取证结果。
//
// 真实管线接缝（显式，落点已预留）：
//   - sidecar：复用既有 gateway 子进程管理模式拉起 `fulilian_ctf` 能力
//     （`venv/Scripts/python.exe -m fulilian_ctf.solve_rpc`，newline-delimited
//     JSON-RPC，见 fulilian_ctf/solve_rpc.py::serve；进程树回收复用
//     backend-child.ts 的 stopBackendChild 口径）。本模块**不在此 spawn**：
//     需要改 Python（solve_rpc 现只挂 health/solve 两个 method，无
//     timeline/import 方法）才能跑通 ⇒ 红线禁止，留待管线就绪后在
//     `timelineFromBackend`（下方）接线。本轮凡走到真实路径一律
//     fail-soft 回落 mock，绝不伪造"真实"结果。
//   - 网关仅 127.0.0.1 红线延续：sidecar 只监听回环（将来实现时遵守）。

import { ipcMain } from 'electron'

// ── 数据结构（方案 §5-T13：{ at, source, event, confidence, tags[] }）──────

/** Timeline event source chips (预览 07：注册表/系统日志/pcap/文件). */
export const TIMELINE_SOURCES = ['registry', 'log', 'pcap', 'file'] as const

export type TimelineSource = (typeof TIMELINE_SOURCES)[number]

export interface TimelineEvent {
  /** Epoch ms. */
  at: number
  source: TimelineSource
  event: string
  /** 0–100. */
  confidence: number
  tags: string[]
}

/** Payload returned by `forensics:timeline`. `mockGenerated` is the honest
 *  provenance marker: true ⇒ the dataset was synthesized, not extracted. */
export interface TimelinePayload {
  caseId: string
  events: TimelineEvent[]
  mockGenerated: boolean
  /** Why the real pipeline was not used (absent when it was). */
  mockReason?: string
}

// ── 确定性 mock 数据集 ─────────────────────────────────────────────────────
// 纯函数 + 固定种子（LCG，无 Math.random）：同 caseId 同入参恒同输出，分布
// （来源/置信度/3h 桶）可单测锚定。预览 07 的语义（外接设备/持久化/网络外联/
// 用户操作）在此落成标签词表。

/** Tag vocabulary the mock dataset draws from (预览 07 左栏标签 chips). */
export const TIMELINE_TAGS = ['usb', 'persistence', 'network', 'user', 'boot', 'file'] as const

export type TimelineTag = (typeof TIMELINE_TAGS)[number]

interface MockSeedSpec {
  caseId: string
  count: number
  /** First event epoch ms; events spread forward at fixed stride + jitter. */
  startAt: number
}

/** Deterministic LCG so the dataset is stable across calls and machines. */
function lcg(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 0x1_0000_0000
  }
}

function seedFromCaseId(caseId: string): number {
  let hash = 2166136261

  for (let index = 0; index < caseId.length; index++) {
    hash ^= caseId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

const MOCK_EVENT_TEMPLATES: ReadonlyArray<{
  event: string
  source: TimelineSource
  tags: string[]
  confidence: number
}> = [
  { event: 'USBSTOR write: SanDisk serial 4C531001…', source: 'registry', tags: ['usb'], confidence: 91 },
  { event: 'Run key new value OneDriveUpdate → %TEMP%\\od.exe', source: 'registry', tags: ['persistence'], confidence: 82 },
  { event: 'Host power on (event ID 6005)', source: 'log', tags: ['boot'], confidence: 98 },
  { event: 'Host entered sleep (event ID 42)', source: 'log', tags: ['boot'], confidence: 96 },
  { event: 'Host shutdown (event ID 6006)', source: 'log', tags: ['boot'], confidence: 98 },
  { event: 'TLS outbound 203.0.113.77:443, no SNI', source: 'pcap', tags: ['network'], confidence: 74 },
  { event: 'DNS query update.onedrive-cdn.net (suspected lookalike)', source: 'pcap', tags: ['network'], confidence: 67 },
  { event: 'D:\\交易记录.xlsx created, owner yingzhang', source: 'file', tags: ['file', 'user'], confidence: 87 },
  { event: 'Recycle bin emptied ($I records deleted, 6 items)', source: 'file', tags: ['file', 'user'], confidence: 85 }
]

/** One deterministic hour bucket per case, offset by a stable stride. */
const MOCK_STRIDE_MS = 3 * 60 * 60 * 1000 + 11 * 60 * 1000

/**
 * The deterministic mock dataset for `caseId`. Same id ⇒ same rows. Sources
 * cycle through every chip, confidences ride their template ± a small
 * deterministic wobble, and timestamps step by ~3h — so the 3h-bucketed
 * histogram and every filter axis have stable, testable distributions.
 */
export function mockTimelineFor({ caseId, count = 40, startAt = 0 }: MockSeedSpec): TimelineEvent[] {
  const random = lcg(seedFromCaseId(caseId))
  const events: TimelineEvent[] = []

  for (let index = 0; index < Math.max(0, Math.floor(count)); index++) {
    const template = MOCK_EVENT_TEMPLATES[Math.floor(random() * MOCK_EVENT_TEMPLATES.length)]
    const wobble = Math.floor(random() * 9) - 4

    events.push({
      at: startAt + index * MOCK_STRIDE_MS + Math.floor(random() * 20) * 60 * 1000,
      source: template.source,
      event: template.event,
      confidence: Math.min(99, Math.max(1, template.confidence + wobble)),
      tags: [...template.tags]
    })
  }

  return events.sort((a, b) => a.at - b.at || a.event.localeCompare(b.event))
}

export const MOCK_TIMELINE_REASON = 'forensics timeline pipeline (P2) not wired — deterministic mock dataset'

// ── CSV 导出（列名固定集，验收③抽查锚定）──────────────────────────────────

/** Fixed CSV header — pinned by unit test (A5-②), never localized. */
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

// ── 星标审计标记行（T7 先例：desktop.log 结构化行，不含事件内容明文）───────
// 现状无结构化审计 store（T8 已证）；沿用 quick-entry.ts formatQuickCaptureAuditLine
// 的 format + auditAtom 口径。T16 报告管线落地正式审计 store 时迁移本标记行。

export const TIMELINE_STAR_AUDIT_MARKER = '[case-timeline:audit]'

/** Collapse to a log-safe atom (mirrors quick-entry auditAtom): non-word chars
 *  fold to `_`, capped length, so the trail never carries event content. */
export function auditAtom(raw: unknown, fallback: string): string {
  const safe = String(raw ?? '')
    .slice(0, 64)
    .replace(/[^\w.:-]+/g, '_')

  return safe || fallback
}

/** One structured desktop.log line per star toggle (not per event content). */
export function formatTimelineStarAuditLine(payload: {
  caseId?: null | string
  on: boolean
  source?: TimelineSource
  tags?: readonly string[]
}): null | string {
  if (!payload?.caseId) {
    return null
  }

  const tags = (payload.tags ?? []).map(tag => auditAtom(tag, '')).filter(Boolean).slice(0, 8).join(';')

  return (
    `${TIMELINE_STAR_AUDIT_MARKER} case=${auditAtom(payload.caseId, 'unknown')} ` +
    `action=${payload.on ? 'star' : 'unstar'} source=${auditAtom(payload.source ?? 'unknown', 'unknown')} ` +
    `tags=${tags || '-'}`
  )
}

// ── CTFd 导入事件（`ctf:importEvent`）──────────────────────────────────────

export interface CtfImportPayload {
  caseId: string
  /** CTFd challenge title (or free-form label) the import seeds events for. */
  challenge: string
  url?: string
}

const CTF_IMPORT_SOURCE_FALLBACK = 'log'

/** Events a CTFd import seeds: deterministic per (caseId, challenge). The
 *  real CTFd adapter (fulilian_ctf/ctfd_adapter.py) owns sync/poll; wiring it
 *  needs the Python red-line lifted, so this stays the mock seam too. */
export function mockCtfImportEvents({ caseId, challenge }: CtfImportPayload): TimelineEvent[] {
  const random = lcg(seedFromCaseId(`${caseId}::${challenge}`))
  const count = 3 + Math.floor(random() * 4)
  const startAt = 1_728_000_000_000 + Math.floor(random() * 48) * 60 * 60 * 1000

  const events: TimelineEvent[] = []

  for (let index = 0; index < count; index++) {
    events.push({
      at: startAt + index * (30 * 60 * 1000),
      source: CTF_IMPORT_SOURCE_FALLBACK,
      event: `CTFd import "${challenge}" sync event ${index + 1}/${count}`,
      confidence: 70 + Math.floor(random() * 21),
      tags: ['file']
    })
  }

  return events.sort((a, b) => a.at - b.at)
}

// ── IPC 注册（fs-ipc.ts 先例：deps 注入、纯逻辑可测）───────────────────────

export interface CaseTimelineIpcDeps {
  /** Structured desktop.log sink (main.ts rememberLog). */
  log?: (chunk: string) => void
  /** Override the dataset producer (tests inject; main omits ⇒ mock). */
  produceTimeline?: (caseId: string) => TimelinePayload
}

const DEFAULT_CASE_TIMELINE_COUNT = 40

function defaultProduceTimeline(caseId: string): TimelinePayload {
  return {
    caseId,
    events: mockTimelineFor({ caseId, count: DEFAULT_CASE_TIMELINE_COUNT, startAt: MOCK_TIMELINE_EPOCH }),
    mockGenerated: true,
    mockReason: MOCK_TIMELINE_REASON
  }
}

/** Mock dataset epoch anchor: a fixed Monday 09:00 UTC so 3h buckets land on
 *  stable boundaries in tests (2026-09-28T01:00:00Z). */
export const MOCK_TIMELINE_EPOCH = 1_790_563_600_000

/** Star-audit variant riding the `forensics:timeline` channel: when the
 *  renderer invokes with a second argument, main folds the atoms into one
 *  structured desktop.log line (T7 quick-capture precedent — no structured
 *  audit store exists; the line carries ONLY atoms, never event text). This
 *  keeps the two-channel budget (`ctf:importEvent` / `forensics:timeline`)
 *  while giving the renderer a rememberLog path. */
export interface TimelineStarAuditPayload {
  at: number
  on: boolean
  source?: string
  tags?: readonly string[]
}

/**
 * Real-pipeline seam. The sidecar (gateway 子进程管理模式 + backend-child 回收)
 * is intentionally NOT spawned here: `fulilian_ctf.solve_rpc` exposes only
 * health/solve today, so any working timeline RPC would require editing
 * Python — the hard red line this task operates under. When the P2 pipeline
 * lands, wire the JSON-RPC call inside `produceTimeline` (the injected
 * producer in registerCaseTimelineIpc) and keep the mock as the fail-soft
 * fallback, preserving the `mockGenerated` provenance flag semantics.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- seam kept explicit per 方案 §5-T13
function timelineFromBackend(_caseId: string): null {
  return null
}

export function registerCaseTimelineIpc({ log = () => {}, produceTimeline }: CaseTimelineIpcDeps = {}): void {
  const produce = produceTimeline ?? defaultProduceTimeline

  // `forensics:timeline` (caseId) → TimelinePayload; (caseId, starAudit) →
  // null after logging the audit line. Invalid ids reject — the renderer
  // treats a rejected invoke as the honest error state.
  ipcMain.handle('forensics:timeline', (_event, rawCaseId, starAudit?: TimelineStarAuditPayload) => {
    const caseId = String(rawCaseId ?? '').trim()

    if (!caseId) {
      throw new Error('forensics:timeline requires a case id')
    }

    if (starAudit !== undefined && starAudit !== null) {
      const line = formatTimelineStarAuditLine({
        caseId,
        on: starAudit?.on === true,
        source: String(starAudit?.source ?? 'unknown') as TimelineSource,
        tags: Array.isArray(starAudit?.tags) ? starAudit.tags.map(tag => String(tag)) : []
      })

      if (line) {
        log(line)
      }

      return null
    }

    const payload = produce(caseId)

    if (payload.mockGenerated) {
      log(`[case-timeline] mock dataset served for ${auditAtom(caseId, 'unknown')} — ${MOCK_TIMELINE_REASON}`)
    }

    return payload
  })

  // `ctf:importEvent` (payload) → TimelineEvent[]. CTFd-adapted import; the
  // Python-side adapter stays untouched (red line), so this seeds mock rows.
  ipcMain.handle('ctf:importEvent', (_event, rawPayload): TimelineEvent[] => {
    const payload: CtfImportPayload = {
      caseId: String(rawPayload?.caseId ?? '').trim(),
      challenge: String(rawPayload?.challenge ?? '').trim(),
      url: rawPayload?.url === undefined ? undefined : String(rawPayload.url)
    }

    if (!payload.caseId || !payload.challenge) {
      throw new Error('ctf:importEvent requires { caseId, challenge }')
    }

    return mockCtfImportEvents(payload)
  })
}
