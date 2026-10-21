/**
 * Gateway event schema — the typed contract for every event the backend
 * pushes over the gateway WS/JSON-RPC stream.
 *
 * Replaces the `GatewayEventPayload` god type (130+ optional fields shared by
 * ~50 event types) with a discriminated union keyed on the event `type`.
 * Shapes for agent-process events (message / thinking / reasoning / tool /
 * plan / approval / clarify / usage) mirror the ACP `session/update` vocabulary
 * that `acp_adapter/` already emits to external clients, so one backend event
 * vocabulary serves both surfaces. Wire fields stay snake_case — the gateway,
 * `acp_adapter`, and this schema share them verbatim; no mapping layer.
 *
 * Phase 1 of the P1-1 alignment (design doc:
 * `design/桌面端事件模型对齐ACP-设计稿.md`): types + a normalizer only. No
 * consumer is migrated yet; `GatewayEventPayload` stays authoritative for
 * existing code until Phase 2 retires it file by file.
 */

import type { BillingBlock } from '@fulilian/shared'

import type { ErrorSurface } from '@/lib/error-surface'
import type { UsageStats } from '@/types/fulilian'

// ---------------------------------------------------------------------------
// Event type literals — the single source the scattered ad-hoc sets derive from
// ---------------------------------------------------------------------------

/** Agent-process events: one step of the agent's execution (ACP-aligned). */
export const AGENT_PROCESS_EVENT_TYPES = [
  'message.start',
  'message.delta',
  'message.interim',
  'message.complete',
  'thinking.delta',
  'reasoning.delta',
  'reasoning.available',
  'tool.start',
  'tool.progress',
  'tool.generating',
  'tool.complete',
  'session.usage',
  'session.context_breakdown'
] as const

/** Desktop-only domain events: gateway/app surface concerns, not ACP-aligned. */
export const DESKTOP_EVENT_TYPES = [
  'approval.request',
  'approval.received',
  'approval.pending',
  'clarify.request',
  'clarify.expire',
  'secret.request',
  'sudo.request',
  'mcp.setup.request',
  'error',
  'status.update',
  'session.title',
  'session.info',
  'session.status',
  'session.reclaimed',
  'subagent.spawn_requested',
  'subagent.start',
  'subagent.update',
  'subagent.complete',
  'message.reaction',
  'reaction',
  'moa.reference',
  'moa.aggregating',
  'moa.progress',
  'moa.phase',
  'pane.reveal',
  'layout.apply',
  'tour.request',
  'tip.show',
  'preview.html',
  'preview.open',
  'preview.act.request',
  'preview.read.request',
  'browser.progress',
  'terminal.cwd',
  'terminal.backend',
  'terminal.read.request',
  'terminal.close',
  'agent.terminal.output',
  'window.read.request',
  'gateway.ready'
] as const

export type AgentProcessEventType = (typeof AGENT_PROCESS_EVENT_TYPES)[number]
export type DesktopEventType = (typeof DESKTOP_EVENT_TYPES)[number]
export type GatewayEventType = AgentProcessEventType | DesktopEventType

// ---------------------------------------------------------------------------
// Payload shapes — agent-process events (ACP-aligned)
// ---------------------------------------------------------------------------

/** `message.start` — a turn was accepted by the backend. */
export interface MessageStartPayload {
  model?: string
  provider?: string
  reasoning_effort?: string
  service_tier?: string
  fast?: boolean
  approval_mode?: string
  yolo?: boolean
}

/** `message.delta` / `message.interim` — streamed reply text. */
export interface MessageChunkPayload {
  text?: string
  /** `message.interim` only: pre-rendered rich text for the preview bubble. */
  rendered?: string
  response_previewed?: boolean
}

/** `message.complete` — the turn settled (success or failure). */
export interface MessageCompletePayload {
  text?: string
  /** Pre-rendered rich text for the final bubble when the backend renders it. */
  rendered?: string
  status?: string
  /** `status: 'error'` — structured layer descriptor (agent/error_surface.py). */
  error?: string | boolean
  error_surface?: unknown
  billing?: BillingBlock
  failure_reason?: string
  /** `status: 'error'` — the streamed partial is visible output, keep it. */
  partial?: boolean
  /** The failed turn was retained backend-side and will replay via session.resume. */
  recoverable?: boolean
  /** The final text was already previewed via `message.interim`. */
  response_previewed?: boolean
  duration_s?: number
  usage?: Partial<UsageStats>
}

/** `thinking.delta` / `reasoning.delta` — streamed reasoning text. */
export interface ThoughtChunkPayload {
  text?: string
}

/** `reasoning.available` — the full reasoning segment landed at once. */
export interface ThoughtSnapshotPayload {
  text?: string
  rendered?: string
}

/**
 * Tool invocation identity shared by the three tool events. The gateway's
 * historical `tool_id` normalizes to `tool_call_id` in {@link parseGatewayEvent};
 * both are typed here because pre-normalization consumers still see the wire.
 */
export interface ToolIdentity {
  tool_call_id?: string
  /** Legacy alias for `tool_call_id` — read via the normalizer, never directly. */
  tool_id?: string
  name?: string
}

/** `tool.start` — a tool call opened. */
export interface ToolStartPayload extends ToolIdentity {
  args?: unknown
  /** Legacy alias for `args` — normalizes to `args`. */
  arguments?: unknown
  preview?: string
}

/**
 * `tool.progress` / `tool.generating` / `tool.complete` — one flat wire shape
 * shared by the in-flight and settling variants (the gateway does not
 * discriminate them; consumers branch on the event `type`). Fields absent at
 * each stage are simply undefined.
 */
export interface ToolUpdatePayload extends ToolIdentity {
  args?: unknown
  /** Legacy alias for `args` — normalizes to `args`. */
  arguments?: unknown
  preview?: string
  result?: unknown
  summary?: string
  /** Unified-diff text for file edits (ACP `tool_call` diff content shape). */
  inline_diff?: string
  error?: string | boolean
}

/** `session.usage` — token/cost accounting for the active turn. */
export interface UsageUpdatePayload {
  usage?: Partial<UsageStats>
}

// ---------------------------------------------------------------------------
// Payload shapes — desktop-namespace events (kept intentionally wide; each
// interface tightens in Phase 2 as its consumer migrates)
// ---------------------------------------------------------------------------

/** `approval.request` — dangerous command / execute_code gate. */
export interface ApprovalRequestPayload {
  request_id?: string
  command?: string
  description?: string
  /** Optional answer buttons the backend offers alongside approve/reject. */
  choices?: unknown
  /** False when a tirith content-security warning forbids a permanent allow. */
  allow_permanent?: boolean
  smart_denied?: boolean
}

/**
 * Blocking-input requests share one flat wire shape (request_id + a
 * family-specific tail); consumers branch on the event `type`. Fields absent
 * on a given family are simply undefined.
 */
export interface ElicitationPayload {
  request_id?: string
  /** `clarify.request` — single-question form. */
  question?: string
  choices?: string[] | null
  multi_select?: boolean
  /** `clarify.request` — batch form replaces question/choices; `answers`
   *  rides reconnect replay carrying per-question locks. */
  questions?: unknown
  answers?: Record<string, unknown>
  /** `secret.request` — skill credential capture. */
  env_var?: string
  prompt?: string
  /** `mcp.setup.request` — inline MCP consent card (setup_mcp tool). */
  server?: string
  action?: string
  reason?: string
}

/** `error` — gateway/agent-level error outside a turn boundary. */
export interface ErrorPayload {
  message?: string
  text?: string
}

/** Any desktop-namespace event not yet individually typed. */
export type DesktopEventPayload = Record<string, unknown>

// ---------------------------------------------------------------------------
// Parsed union
// ---------------------------------------------------------------------------

/** Common envelope fields every parsed event carries. */
export interface GatewayEventEnvelope {
  /** Schema version. `1` for the legacy untyped wire, `2` once the backend
   *  emits ACP-aligned event names (Phase 3). Absent on the current wire. */
  v: 1 | 2
  type: GatewayEventType
  /** Unix seconds from the payload when present; consumers must not fall back
   *  to their own clock when this is absent on legacy gateways (existing
   *  behavior, preserved). */
  timestamp?: number
  session_id?: string
  profile?: string
}

export type ParsedGatewayEvent = GatewayEventEnvelope &
  (
    | { kind: 'message_start'; payload: MessageStartPayload }
    | { kind: 'message_chunk'; payload: MessageChunkPayload; interim: boolean }
    | { kind: 'message_complete'; payload: MessageCompletePayload }
    | { kind: 'thought_chunk'; payload: ThoughtChunkPayload }
    | { kind: 'thought_snapshot'; payload: ThoughtSnapshotPayload }
    | { kind: 'tool_call'; payload: ToolStartPayload }
    | { kind: 'tool_call_update'; payload: ToolUpdatePayload }
    | { kind: 'usage_update'; payload: UsageUpdatePayload }
    | { kind: 'permission_request'; payload: ApprovalRequestPayload }
    | { kind: 'elicitation'; payload: ElicitationPayload }
    | { kind: 'error'; payload: ErrorPayload }
    | { kind: 'desktop'; payload: DesktopEventPayload }
  )

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Normalize one raw gateway event into the typed union. Returns `null` for
 * event types outside the schema (caller decides whether to log or ignore) —
 * unknown types must never throw: the gateway is an older process than the
 * renderer and both evolve independently.
 *
 * Normalization performed here (and nowhere else):
 *  - `tool_id` → `tool_call_id` (legacy alias retired at the type boundary)
 *  - `arguments` → `args` on tool payloads (same)
 *  - `message.interim` → `message_chunk` with `interim: true`
 */
export function parseGatewayEvent(raw: {
  payload?: unknown
  profile?: string
  session_id?: string
  type?: string
}): ParsedGatewayEvent | null {
  const type = raw.type
  if (!type) {
    return null
  }

  const payload = asRecord(raw.payload)
  const envelope: GatewayEventEnvelope = {
    v: 1,
    type: type as GatewayEventType,
    timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : undefined,
    session_id: raw.session_id ?? str(payload.session_id),
    profile: raw.profile
  }

  switch (type) {
    case 'message.start':
      return { ...envelope, kind: 'message_start', payload: payload as MessageStartPayload }
    case 'message.delta':
      return { ...envelope, kind: 'message_chunk', interim: false, payload: payload as MessageChunkPayload }
    case 'message.interim':
      return { ...envelope, kind: 'message_chunk', interim: true, payload: payload as MessageChunkPayload }
    case 'message.complete':
      return { ...envelope, kind: 'message_complete', payload: payload as MessageCompletePayload }
    case 'thinking.delta':
    case 'reasoning.delta':
      return { ...envelope, kind: 'thought_chunk', payload: payload as ThoughtChunkPayload }
    case 'reasoning.available':
      return { ...envelope, kind: 'thought_snapshot', payload: payload as ThoughtSnapshotPayload }
    case 'tool.start':
      return { ...envelope, kind: 'tool_call', payload: normalizeToolPayload(payload) as ToolStartPayload }
    case 'tool.progress':
    case 'tool.generating':
    case 'tool.complete':
      return {
        ...envelope,
        kind: 'tool_call_update',
        payload: normalizeToolPayload(payload) as ToolUpdatePayload
      }
    case 'session.usage':
    case 'session.context_breakdown':
      return { ...envelope, kind: 'usage_update', payload: payload as UsageUpdatePayload }
    case 'approval.request':
      return { ...envelope, kind: 'permission_request', payload: payload as ApprovalRequestPayload }
    case 'clarify.request':
    case 'secret.request':
    case 'mcp.setup.request':
      return {
        ...envelope,
        kind: 'elicitation',
        payload: payload as ElicitationPayload
      }
    case 'error':
      return { ...envelope, kind: 'error', payload: payload as ErrorPayload }
    default:
      // Desktop-namespace and unknown types: passed through wide, never dropped
      // here — routing/pinning decisions stay in lib/gateway-events.ts.
      return { ...envelope, kind: 'desktop', payload }
  }
}

function normalizeToolPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...payload }

  if (normalized.tool_call_id === undefined && typeof normalized.tool_id === 'string') {
    normalized.tool_call_id = normalized.tool_id
  }
  if (normalized.args === undefined && normalized.arguments !== undefined) {
    normalized.args = normalized.arguments
  }

  return normalized
}
