import { describe, expect, it } from 'vitest'

import {
  AGENT_PROCESS_EVENT_TYPES,
  DESKTOP_EVENT_TYPES,
  isV2EventName,
  type GatewayEventType,
  type ParsedGatewayEvent,
  parseGatewayEvent,
  type ToolUpdatePayload
} from './gateway-event-schema'

/** A raw wire event as the gateway emits it (RpcEvent subset + payload). */
function raw(type: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { type, payload, session_id: 'sess-1', profile: 'main', ...extra }
}

describe('parseGatewayEvent — agent-process events', () => {
  it('maps message.delta to a message_chunk with the streamed text', () => {
    const event = parseGatewayEvent(raw('message.delta', { text: '你好', timestamp: 1730000000 }))

    expect(event).not.toBeNull()
    expect(event?.kind).toBe('message_chunk')
    expect(event?.v).toBe(1)

    if (event?.kind === 'message_chunk') {
      expect(event.interim).toBe(false)
      expect(event.payload.text).toBe('你好')
    }

    expect(event?.timestamp).toBe(1730000000)
    expect(event?.session_id).toBe('sess-1')
    expect(event?.profile).toBe('main')
  })

  it('maps message.interim to a message_chunk flagged interim', () => {
    const event = parseGatewayEvent(raw('message.interim', { text: 'partial', rendered: '<p>partial</p>' }))

    expect(event?.kind).toBe('message_chunk')

    if (event?.kind === 'message_chunk') {
      expect(event.interim).toBe(true)
      expect(event.payload.rendered).toBe('<p>partial</p>')
    }
  })

  it('maps message.start and message.complete with their turn metadata', () => {
    const start = parseGatewayEvent(
      raw('message.start', { model: 'gpt-5', provider: 'openai', reasoning_effort: 'high', fast: true })
    )

    expect(start?.kind).toBe('message_start')

    const complete = parseGatewayEvent(
      raw('message.complete', {
        text: 'done',
        status: 'error',
        error_surface: { layer: 'agent', code: 'x', retryable: true },
        partial: true,
        recoverable: true,
        duration_s: 12.5
      })
    )

    expect(complete?.kind).toBe('message_complete')

    if (complete?.kind === 'message_complete') {
      expect(complete.payload.status).toBe('error')
      expect(complete.payload.partial).toBe(true)
      expect(complete.payload.duration_s).toBe(12.5)
    }
  })

  it('maps thinking.delta and reasoning.delta to thought_chunk, reasoning.available to thought_snapshot', () => {
    expect(parseGatewayEvent(raw('thinking.delta', { text: 'hmm' }))?.kind).toBe('thought_chunk')
    expect(parseGatewayEvent(raw('reasoning.delta', { text: 'hmm' }))?.kind).toBe('thought_chunk')
    expect(parseGatewayEvent(raw('reasoning.available', { text: 'full' }))?.kind).toBe('thought_snapshot')
  })

  it('normalizes the legacy tool_id alias and arguments spelling on tool events', () => {
    const start = parseGatewayEvent(
      raw('tool.start', { tool_id: 't-1', name: 'patch', arguments: { path: '/a', mode: 'replace' } })
    )

    expect(start?.kind).toBe('tool_call')

    if (start?.kind === 'tool_call') {
      expect(start.payload.tool_call_id).toBe('t-1')
      expect(start.payload.args).toEqual({ path: '/a', mode: 'replace' })
      // Raw aliases stay on the payload object (harmless), but the typed
      // accessors read only the normalized names.
    }

    const complete = parseGatewayEvent(
      raw('tool.complete', { tool_call_id: 't-1', result: 'ok', inline_diff: '--- a\n+++ b' })
    )

    expect(complete?.kind).toBe('tool_call_update')

    if (complete?.kind === 'tool_call_update') {
      const payload = complete.payload as ToolUpdatePayload
      expect(payload.result).toBe('ok')
      expect(payload.inline_diff).toBe('--- a\n+++ b')
      // The legacy alias was normalized onto the canonical name.
      expect(payload.tool_call_id).toBe('t-1')
    }

    expect(parseGatewayEvent(raw('tool.progress', { preview: 'running…' }))?.kind).toBe('tool_call_update')
    expect(parseGatewayEvent(raw('tool.generating', { name: 'read_file' }))?.kind).toBe('tool_call_update')
  })

  it('routes usage events to usage_update', () => {
    const event = parseGatewayEvent(raw('session.usage', { usage: { input_tokens: 10 } }))
    expect(event?.kind).toBe('usage_update')
    expect(parseGatewayEvent(raw('session.context_breakdown', {}))?.kind).toBe('usage_update')
  })
})

describe('parseGatewayEvent — approval and elicitation events', () => {
  it('maps approval.request to permission_request with its gate metadata', () => {
    const event = parseGatewayEvent(
      raw('approval.request', { command: 'rm -rf /tmp/x', description: 'cleanup', allow_permanent: false })
    )

    expect(event?.kind).toBe('permission_request')

    if (event?.kind === 'permission_request') {
      expect(event.payload.command).toBe('rm -rf /tmp/x')
      // tirith may forbid a permanent allow — the client renders this as a
      // disabled "always" option (ACP allow_always absent).
      expect(event.payload.allow_permanent).toBe(false)
    }
  })

  it('maps clarify/secret/mcp.setup requests to elicitation kinds', () => {
    const clarify = parseGatewayEvent(
      raw('clarify.request', { request_id: 'r1', question: '哪个？', choices: ['a', 'b'], multi_select: false })
    )

    expect(clarify?.kind).toBe('elicitation')

    const secret = parseGatewayEvent(raw('secret.request', { env_var: 'API_KEY', prompt: '输入密钥' }))
    expect(secret?.kind).toBe('elicitation')

    const mcp = parseGatewayEvent(raw('mcp.setup.request', { server: 'fs', action: 'install' }))
    expect(mcp?.kind).toBe('elicitation')
  })
})

describe('parseGatewayEvent — desktop namespace and unknown types', () => {
  it('passes desktop-namespace events through wide instead of dropping them', () => {
    const event = parseGatewayEvent(raw('pane.reveal', { pane: 'terminal' }))

    expect(event?.kind).toBe('desktop')

    if (event?.kind === 'desktop') {
      expect(event.payload.pane).toBe('terminal')
    }

    expect(parseGatewayEvent(raw('moa.phase', { phase: 'aggregate' }))?.kind).toBe('desktop')
    expect(parseGatewayEvent(raw('brand.new.event.tomorrow', { x: 1 }))?.kind).toBe('desktop')
  })

  it('returns null only when the event has no type', () => {
    expect(parseGatewayEvent({ payload: {} })).toBeNull()
    expect(parseGatewayEvent({ type: '', payload: {} })).toBeNull()
  })

  it('treats a missing payload as an empty record, never a throw', () => {
    const event = parseGatewayEvent({ type: 'message.delta' })
    expect(event?.kind).toBe('message_chunk')

    if (event?.kind === 'message_chunk') {
      expect(event.payload.text).toBeUndefined()
    }
  })
})

describe('schema constants stay in sync with the routing sets', () => {
  // The routing sets in lib/gateway-events.ts and gateway-event/index.ts are
  // hand-maintained string arrays. This guard fails when a new event type is
  // added to either side without registering it in the schema constants (or
  // vice versa) — the drift that motivated the single source.
  const KNOWN: ReadonlySet<string> = new Set<string>([...AGENT_PROCESS_EVENT_TYPES, ...DESKTOP_EVENT_TYPES])

  it('every known routing-set entry is registered in the schema constants', async () => {
    const { UNSCOPED_STREAM_EVENT_TYPES } = await import('@/lib/gateway-events')

    for (const type of UNSCOPED_STREAM_EVENT_TYPES) {
      expect(KNOWN.has(type), `UNSCOPED_STREAM_EVENT_TYPES entry "${type}" missing from schema constants`).toBe(true)
    }
  })

  it('every agent-process event type appears in the legacy gateway stream sets that enumerate them', async () => {
    const mod = await import('@/lib/gateway-events')

    for (const type of AGENT_PROCESS_EVENT_TYPES) {
      const registered = mod.UNSCOPED_STREAM_EVENT_TYPES.has(type)
      // Every agent-process event is either pinned-stream eligible or scoped;
      // nothing here should be unregistered in both worlds.
      expect(typeof registered).toBe('boolean')
      expect(registered || type.startsWith('session.')).toBe(true)
    }
  })

  it('classifies every registered type as agent-process or desktop, never both', () => {
    const seen = new Set<string>()

    for (const type of [...AGENT_PROCESS_EVENT_TYPES, ...DESKTOP_EVENT_TYPES] as GatewayEventType[]) {
      expect(seen.has(type), `duplicate registration: ${type}`).toBe(false)
      seen.add(type)
    }
  })
})

describe('parseGatewayEvent — v2 (ACP-shaped) wire names', () => {
  it('maps each v2 name onto the same kind as its v1 predecessor and stamps v:2', () => {
    const pairs: Array<[string, string, ParsedGatewayEvent['kind']]> = [
      ['agent_message_chunk', 'message.delta', 'message_chunk'],
      ['agent_thought_chunk', 'thinking.delta', 'thought_chunk'],
      ['tool_call', 'tool.start', 'tool_call'],
      ['tool_call_update', 'tool.progress', 'tool_call_update'],
      ['usage_update', 'session.usage', 'usage_update'],
      ['permission_request', 'approval.request', 'permission_request'],
      ['elicitation', 'clarify.request', 'elicitation']
    ]

    for (const [v2, v1, kind] of pairs) {
      const viaV2 = parseGatewayEvent(raw(v2, { text: 'x' }))
      const viaV1 = parseGatewayEvent(raw(v1, { text: 'x' }))

      expect(viaV2?.kind, v2).toBe(kind)
      expect(viaV2?.kind, `${v2} vs ${v1}`).toBe(viaV1?.kind)
      expect(viaV2?.v).toBe(2)
      expect(viaV1?.v).toBe(1)
    }
  })

  it('carries the interim flag on the v2 agent_message_chunk payload', () => {
    const event = parseGatewayEvent(raw('agent_message_chunk', { text: 'preview', interim: true }))

    expect(event?.kind).toBe('message_chunk')
    if (event?.kind === 'message_chunk') {
      expect(event.interim).toBe(true)
      expect(event.v).toBe(2)
    }
  })

  it('keeps desktop-namespace names on v1 regardless of negotiation', () => {
    const event = parseGatewayEvent(raw('status.update', { kind: 'compacting' }))

    expect(event?.v).toBe(1)
    expect(event?.kind).toBe('desktop')
  })

  it('normalizes the legacy tool aliases on v2 tool_call_update too', () => {
    const event = parseGatewayEvent(raw('tool_call_update', { tool_id: 't-9', arguments: { path: '/x' } }))

    expect(event?.kind).toBe('tool_call_update')
    expect(event?.v).toBe(2)
    if (event?.kind === 'tool_call_update') {
      expect(event.payload.tool_call_id).toBe('t-9')
      expect(event.payload.args).toEqual({ path: '/x' })
    }
  })

  it('exposes the v2 name predicate for negotiation-aware consumers', () => {
    expect(isV2EventName('agent_message_chunk')).toBe(true)
    expect(isV2EventName('message.delta')).toBe(false)
    expect(isV2EventName('status.update')).toBe(false)
  })
})
