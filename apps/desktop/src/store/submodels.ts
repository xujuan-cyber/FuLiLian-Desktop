// Step 21 · 自定义子模型派发 — RPC wrappers for the `submodels.*` JSON-RPC
// family (tui_gateway/methods_submodels.py). Same shape as clarify.ts's
// `$gateway.get()?.request` precedent: thin, stateless, no caching — the
// settings page owns refresh semantics.
//
// Contract notes (frozen at M0, verified against methods_submodels.py):
// - list entries carry masked provider.api_key plus server-side
//   `valid` / `errors` so the UI can flag hand-edited broken profiles.
// - save is a single-profile upsert; the server whitelists unknown keys
//   (response.dropped) and rejects invalid entries (never persists).
// - wizard_turn is stateless: the caller owns the full history and the LAST
//   message must have role 'user'. A missing `draft` means "keep talking",
//   not an error.

import { $gateway } from './gateway'

export interface SubmodelProvider {
  api_key?: string
  api_mode?: string
  base_url?: string
}

export interface SubmodelParams {
  temperature?: number
}

export interface SubmodelProfile {
  description?: string
  enabled?: boolean
  id: string
  max_iterations?: number
  model?: string
  name: string
  params?: SubmodelParams | null
  provider?: SubmodelProvider | null
  system_prompt_extra?: string
  toolsets?: string[]
}

/** One `submodels.list` entry: a profile plus its server-side verdict. */
export interface SubmodelListEntry extends SubmodelProfile {
  errors?: string[]
  valid?: boolean
}

export interface SubmodelTemplate extends SubmodelProfile {
  id: string
}

/** A wizard conversation turn. Only 'user' | 'assistant' cross the wire. */
export interface SubmodelWizardMessage {
  content: string
  role: 'assistant' | 'user'
}

export interface SaveSubmodelResult {
  dropped: string[]
  id: string
  replaced: boolean
}

export interface WizardTurnResult {
  /** Present only when the conversation has converged. */
  draft?: Record<string, unknown>
  reply: string
}

async function submodelsRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const gateway = $gateway.get()

  if (!gateway) {
    throw new Error('Fulilian gateway unavailable')
  }

  return gateway.request<T>(method, params)
}

export async function listSubmodels(): Promise<SubmodelListEntry[]> {
  const result = await submodelsRequest<{ submodels?: SubmodelListEntry[] }>('submodels.list', {})

  return result.submodels ?? []
}

export async function saveSubmodel(entry: SubmodelProfile): Promise<SaveSubmodelResult> {
  return submodelsRequest<SaveSubmodelResult>('submodels.save', { entry })
}

export async function deleteSubmodel(id: string): Promise<{ id: string; removed: boolean }> {
  return submodelsRequest<{ id: string; removed: boolean }>('submodels.delete', { id })
}

export async function listSubmodelTemplates(): Promise<SubmodelTemplate[]> {
  const result = await submodelsRequest<{ templates?: SubmodelTemplate[] }>('submodels.templates', {})

  return result.templates ?? []
}

export async function submodelWizardTurn(messages: SubmodelWizardMessage[]): Promise<WizardTurnResult> {
  return submodelsRequest<WizardTurnResult>('submodels.wizard_turn', { messages })
}
