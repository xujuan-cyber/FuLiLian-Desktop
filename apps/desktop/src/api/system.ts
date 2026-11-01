import type {
  ActionResponse,
  ActionStatusResponse,
  BackendUpdateCheckResponse,
  CuratorStatusResponse,
  DebugShareResponse,
  ElevenLabsVoicesResponse,
  MemoryProviderConfig,
  MemoryProviderOAuthStatus,
  MemoryStatusResponse
} from '@/types/fulilian'

import { capabilityScoped, fulilianApi, type ProfileScope, profileScoped } from './client'

// surface=declared serves the curated desktop schema; the dashboard consumes the raw plugin schema.
export function getMemoryProviderConfig(provider: string, profile?: null | string): Promise<MemoryProviderConfig> {
  return fulilianApi<MemoryProviderConfig>({
    ...profileScoped(profile),
    path: `/api/memory/providers/${encodeURIComponent(provider)}/config?surface=declared`
  })
}

export function saveMemoryProviderConfig(
  provider: string,
  values: Record<string, string>,
  profile?: null | string
): Promise<{ ok: boolean }> {
  return fulilianApi<{ ok: boolean }>({
    ...profileScoped(profile),
    path: `/api/memory/providers/${encodeURIComponent(provider)}/config?surface=declared`,
    method: 'PUT',
    body: { values }
  })
}

// Memory-provider OAuth connect (provider-keyed; 404s for providers without an
// OAuth flow). Profile-scoped: the grant lands in the active profile's config.
export function startMemoryProviderOAuth(
  provider: string,
  profile?: null | string
): Promise<MemoryProviderOAuthStatus> {
  return fulilianApi<MemoryProviderOAuthStatus>({
    ...profileScoped(profile),
    path: `/api/memory/providers/${encodeURIComponent(provider)}/oauth/start`,
    method: 'POST'
  })
}

export function getMemoryProviderOAuthStatus(
  provider: string,
  profile?: null | string
): Promise<MemoryProviderOAuthStatus> {
  return fulilianApi<MemoryProviderOAuthStatus>({
    ...profileScoped(profile),
    path: `/api/memory/providers/${encodeURIComponent(provider)}/oauth/status`
  })
}

// ---------------------------------------------------------------------------
// Memory data + curator (parity with `fulilian memory` / `fulilian curator`).
// ---------------------------------------------------------------------------

export function getMemoryStatus(): Promise<MemoryStatusResponse> {
  return fulilianApi<MemoryStatusResponse>({
    ...profileScoped(),
    path: '/api/memory'
  })
}

export function resetMemory(target: 'all' | 'memory' | 'user'): Promise<{ ok: boolean; deleted: string[] }> {
  return fulilianApi<{ ok: boolean; deleted: string[] }>({
    ...profileScoped(),
    path: '/api/memory/reset',
    method: 'POST',
    body: { target }
  })
}

export function getCuratorStatus(): Promise<CuratorStatusResponse> {
  return fulilianApi<CuratorStatusResponse>({
    ...profileScoped(),
    path: '/api/curator'
  })
}

export function setCuratorPaused(paused: boolean): Promise<{ ok: boolean; paused: boolean }> {
  return fulilianApi<{ ok: boolean; paused: boolean }>({
    ...profileScoped(),
    path: '/api/curator/paused',
    method: 'PUT',
    body: { paused }
  })
}

export function runCurator(): Promise<ActionResponse> {
  return fulilianApi<ActionResponse>({
    ...profileScoped(),
    path: '/api/curator/run',
    method: 'POST',
    body: {}
  })
}

export function restartGateway(): Promise<ActionResponse> {
  return fulilianApi<ActionResponse>({
    ...profileScoped(),
    path: '/api/gateway/restart',
    method: 'POST'
  })
}

export function updateFulilian(): Promise<ActionResponse> {
  return fulilianApi<ActionResponse>({
    ...profileScoped(),
    path: '/api/fulilian/update',
    method: 'POST'
  })
}

/** Query the connected backend's own update state. In remote mode this is the
 *  authoritative source for the backend's behind-count + "what's changed",
 *  distinct from the Electron client clone's git state. */
export function checkFulilianUpdate(force = false): Promise<BackendUpdateCheckResponse> {
  return fulilianApi<BackendUpdateCheckResponse>({
    ...profileScoped(),
    path: `/api/fulilian/update/check${force ? '?force=true' : ''}`
  })
}

export function getActionStatus(name: string, lines = 200, profile?: ProfileScope): Promise<ActionStatusResponse> {
  return window.fulilianDesktop.api<ActionStatusResponse>({
    ...capabilityScoped(profile),
    path: `/api/actions/${encodeURIComponent(name)}/status?lines=${Math.max(1, lines)}`
  })
}

export function getElevenLabsVoices(profile?: null | string): Promise<ElevenLabsVoicesResponse> {
  return fulilianApi<ElevenLabsVoicesResponse>({
    path: '/api/audio/elevenlabs/voices',
    ...profileScoped(profile)
  })
}

/** `gh` CLI presence + auth state, for the composer's GitHub skill pill
 *  (GitHub is deliberately not an MCP — the github/* skills are the
 *  integration). Backend caches for 5 minutes; `refresh` bypasses. */
export function getGhAuthStatus(refresh = false): Promise<{ available: boolean; authenticated: boolean }> {
  return fulilianApi<{ available: boolean; authenticated: boolean }>({
    ...profileScoped(),
    path: `/api/git/gh-auth${refresh ? '?refresh=true' : ''}`
  })
}

// ---------------------------------------------------------------------------
// Maintenance operations (parity with `fulilian doctor` / `fulilian security
// audit` / `fulilian backup` / `fulilian debug share` and the dashboard System
// page). All except debug share are spawn-based background actions tailed via
// getActionStatus().
// ---------------------------------------------------------------------------

export function runDoctor(): Promise<ActionResponse> {
  return fulilianApi<ActionResponse>({ path: '/api/ops/doctor', method: 'POST', body: {} })
}

export function runSecurityAudit(): Promise<ActionResponse> {
  return fulilianApi<ActionResponse>({ path: '/api/ops/security-audit', method: 'POST', body: {} })
}

export function runBackup(): Promise<ActionResponse & { archive?: string }> {
  return fulilianApi<ActionResponse & { archive?: string }>({
    path: '/api/ops/backup',
    method: 'POST',
    body: {}
  })
}

export function runDebugShare(): Promise<DebugShareResponse> {
  return fulilianApi<DebugShareResponse>({
    path: '/api/ops/debug-share',
    method: 'POST',
    body: {},
    // Synchronous upload of report + logs to the paste service.
    timeoutMs: 120_000
  })
}
