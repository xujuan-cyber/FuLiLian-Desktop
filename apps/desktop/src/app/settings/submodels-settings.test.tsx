import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { confirm, deleteSubmodel, listSubmodelTemplates, listSubmodels, saveSubmodel, submodelWizardTurn } = vi.hoisted(
  () => ({
    confirm: vi.fn(async () => true),
    deleteSubmodel: vi.fn(async () => ({ id: 'a', removed: true })),
    listSubmodelTemplates: vi.fn(async () => [] as { description?: string; id: string; name: string }[]),
    listSubmodels: vi.fn(async () => [] as Record<string, unknown>[]),
    saveSubmodel: vi.fn(async () => ({ dropped: [], id: 'a', replaced: false })),
    submodelWizardTurn: vi.fn()
  })
)

vi.mock('@/store/confirm', () => ({ confirm }))

vi.mock('@/store/submodels', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteSubmodel,
  listSubmodelTemplates,
  listSubmodels,
  saveSubmodel,
  submodelWizardTurn
}))

import { SubmodelsSettings } from './submodels-settings'

const profileA = {
  description: 'Reviews code changes and reports issues.',
  enabled: true,
  errors: [] as string[],
  id: 'a',
  model: 'openrouter:gemini-2-flash',
  name: 'Reviewer',
  toolsets: ['file', 'terminal'],
  valid: true
}

const template = {
  description: 'Template description',
  id: 'tpl-test-runner',
  max_iterations: 15,
  name: '测试运行员',
  params: { temperature: 0.1 },
  toolsets: ['terminal', 'file']
}

beforeEach(() => {
  vi.clearAllMocks()
  listSubmodels.mockResolvedValue([profileA])
  listSubmodelTemplates.mockResolvedValue([template])
  saveSubmodel.mockResolvedValue({ dropped: [], id: 'a', replaced: false })
  deleteSubmodel.mockResolvedValue({ id: 'a', removed: true })
  confirm.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
})

describe('SubmodelsSettings', () => {
  it('renders profile rows with model, toolsets and the invalid marker', async () => {
    listSubmodels.mockResolvedValue([
      profileA,
      { ...profileA, errors: ['unknown toolset "x"'], id: 'b', model: '', name: 'Broken', toolsets: ['web'], valid: false }
    ])

    render(<SubmodelsSettings />)

    expect(await screen.findByText('Reviewer')).toBeTruthy()
    expect(screen.getByText('openrouter:gemini-2-flash')).toBeTruthy()
    expect(screen.getByText('file, terminal')).toBeTruthy()
    expect(screen.getByText('Broken')).toBeTruthy()
    expect(screen.getByText('Invalid')).toBeTruthy()
    expect(screen.getByText(/unknown toolset "x"/)).toBeTruthy()
  })

  it('deletes a profile after confirmation and refreshes the list', async () => {
    render(<SubmodelsSettings />)
    await screen.findByText('Reviewer')

    fireEvent.click(screen.getByTitle('Delete'))

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true, title: 'Delete Reviewer?' }))
    })
    await waitFor(() => {
      expect(deleteSubmodel).toHaveBeenCalledWith('a')
    })
    await waitFor(() => {
      expect(listSubmodels).toHaveBeenCalledTimes(2)
    })
  })

  it('does not delete when the confirm dialog is dismissed', async () => {
    confirm.mockResolvedValue(false)

    render(<SubmodelsSettings />)
    await screen.findByText('Reviewer')

    fireEvent.click(screen.getByTitle('Delete'))

    await waitFor(() => {
      expect(confirm).toHaveBeenCalled()
    })
    expect(deleteSubmodel).not.toHaveBeenCalled()
  })

  it('creates a blank profile through the editor and calls saveSubmodel', async () => {
    render(<SubmodelsSettings />)
    await screen.findByText('Reviewer')

    fireEvent.click(screen.getByRole('button', { name: 'New submodel' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('New submodel')

    const inputs = screen.getAllByRole('textbox')
    // The dialog hosts [id, name, description, toolset draft, model, base url,
    // api mode, api key, max turns, temperature, system prompt extra] — find by
    // order within the form is brittle; drive the two required ones directly.
    const idInput = inputs.find(input => (input as HTMLInputElement).placeholder === 'code-reviewer')
    const nameInput = inputs[inputs.indexOf(idInput!) + 1]

    fireEvent.change(idInput!, { target: { value: 'rev' } })
    fireEvent.change(nameInput, { target: { value: 'Reviewer 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveSubmodel).toHaveBeenCalledWith(expect.objectContaining({ id: 'rev', name: 'Reviewer 2' }))
    })
  })

  it('prefills the editor from a template with the tpl- prefix stripped', async () => {
    render(<SubmodelsSettings />)
    await screen.findByText('Reviewer')

    fireEvent.click(screen.getByRole('button', { name: 'From template' }))
    fireEvent.click(await screen.findByText('测试运行员'))

    await waitFor(() => {
      expect(screen.getByRole('dialog').textContent).toContain('Edit 测试运行员')
    })

    const inputs = screen.getAllByRole('textbox')
    const idInput = inputs.find(input => (input as HTMLInputElement).placeholder === 'code-reviewer')
    expect((idInput as HTMLInputElement).value).toBe('test-runner')
  })

  it('opens the conversational wizard from the header action', async () => {
    render(<SubmodelsSettings />)
    await screen.findByText('Reviewer')

    fireEvent.click(screen.getByRole('button', { name: 'Set up with AI' }))

    await waitFor(() => {
      expect(screen.getByText('Set up a submodel with AI')).toBeTruthy()
    })
    expect(submodelWizardTurn).not.toHaveBeenCalled()
  })
})
