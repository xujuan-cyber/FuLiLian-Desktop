import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the gateway store seam — the wrappers must go through
// $gateway.get()?.request exactly like clarify.ts does.
const request = vi.fn()

vi.mock('@/store/gateway', () => ({
  $gateway: {
    get: () => ({ request })
  }
}))

import type { FulilianGateway } from '@/fulilian'
import { $gateway } from '@/store/gateway'

import {
  deleteSubmodel,
  listSubmodels,
  listSubmodelTemplates,
  saveSubmodel,
  submodelWizardTurn
} from './submodels'

const gatewayStub = () => ({ request }) as unknown as FulilianGateway

beforeEach(() => {
  request.mockReset()
  ;($gateway as { get: () => unknown }).get = gatewayStub
})

describe('submodels RPC wrappers', () => {
  it('listSubmodels unwraps the submodels array and defaults to empty', async () => {
    const entry = { errors: [], id: 'a', name: 'A', valid: true }
    request.mockResolvedValueOnce({ submodels: [entry] })
    await expect(listSubmodels()).resolves.toEqual([entry])
    expect(request).toHaveBeenCalledWith('submodels.list', {})

    request.mockResolvedValueOnce({})
    await expect(listSubmodels()).resolves.toEqual([])
  })

  it('saveSubmodel sends the entry under `entry` and returns the receipt', async () => {
    const entry = { id: 'a', name: 'A' }
    request.mockResolvedValueOnce({ dropped: ['x'], id: 'a', replaced: false })
    await expect(saveSubmodel(entry)).resolves.toEqual({ dropped: ['x'], id: 'a', replaced: false })
    expect(request).toHaveBeenCalledWith('submodels.save', { entry })
  })

  it('deleteSubmodel passes id and returns removal receipt', async () => {
    request.mockResolvedValueOnce({ id: 'a', removed: true })
    await expect(deleteSubmodel('a')).resolves.toEqual({ id: 'a', removed: true })
    expect(request).toHaveBeenCalledWith('submodels.delete', { id: 'a' })
  })

  it('listSubmodelTemplates unwraps templates and defaults to empty', async () => {
    request.mockResolvedValueOnce({ templates: [{ id: 'tpl-a', name: 'A' }] })
    await expect(listSubmodelTemplates()).resolves.toEqual([{ id: 'tpl-a', name: 'A' }])
    expect(request).toHaveBeenCalledWith('submodels.templates', {})

    request.mockResolvedValueOnce({})
    await expect(listSubmodelTemplates()).resolves.toEqual([])
  })

  it('submodelWizardTurn sends messages and passes the draft through untouched', async () => {
    const messages = [
      { content: 'hi', role: 'user' as const },
      { content: 'hello', role: 'assistant' as const },
      { content: 'make me a reviewer', role: 'user' as const }
    ]

    request.mockResolvedValueOnce({ reply: 'ok' })
    await expect(submodelWizardTurn(messages)).resolves.toEqual({ reply: 'ok' })
    expect(request).toHaveBeenCalledWith('submodels.wizard_turn', { messages })

    request.mockResolvedValueOnce({ draft: { name: 'Reviewer' }, reply: 'done' })
    await expect(submodelWizardTurn(messages)).resolves.toEqual({ draft: { name: 'Reviewer' }, reply: 'done' })
  })

  it('throws when no gateway is connected', async () => {
    ;($gateway as { get: () => unknown }).get = () => null

    try {
      await expect(listSubmodels()).rejects.toThrow('Fulilian gateway unavailable')
      expect(request).not.toHaveBeenCalled()
    } finally {
      ;($gateway as { get: () => unknown }).get = gatewayStub
    }
  })
})
