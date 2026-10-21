import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { saveSubmodel, submodelWizardTurn } = vi.hoisted(() => ({
  saveSubmodel: vi.fn(async () => ({ dropped: [], id: 'r', replaced: false })),
  submodelWizardTurn: vi.fn()
}))

vi.mock('@/store/submodels', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveSubmodel,
  submodelWizardTurn
}))

import { SubmodelWizard } from './submodel-wizard'

const renderWizard = (props: Partial<Parameters<typeof SubmodelWizard>[0]> = {}) =>
  render(
    <SubmodelWizard
      knownToolsets={['file', 'web']}
      onOpenChange={vi.fn()}
      onSaved={vi.fn()}
      takenIds={[]}
      {...props}
    />
  )

const send = async (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('SubmodelWizard', () => {
  it('sends the user turn and shows the assistant reply without entering draft mode', async () => {
    submodelWizardTurn.mockResolvedValueOnce({ reply: 'What tools does it need?' })

    renderWizard()
    await send('A code reviewer')

    await waitFor(() => {
      expect(submodelWizardTurn).toHaveBeenCalledWith([{ content: 'A code reviewer', role: 'user' }])
    })
    await waitFor(() => {
      expect(screen.getByText('What tools does it need?')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Save submodel' })).toBeNull()
  })

  it('keeps the conversation going when the response has no draft', async () => {
    submodelWizardTurn
      .mockResolvedValueOnce({ reply: 'First answer' })
      .mockResolvedValueOnce({ reply: 'Second answer' })

    renderWizard()
    await send('turn one')
    await screen.findByText('First answer')

    await send('turn two')

    await waitFor(() => {
      expect(submodelWizardTurn).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.getByText('Second answer')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Save submodel' })).toBeNull()
  })

  it('switches to the draft form when a draft arrives, derives a unique id, and saves', async () => {
    submodelWizardTurn.mockResolvedValueOnce({
      draft: {
        description: 'Reviews code.',
        enabled: true,
        model: 'openrouter:gemini-2-flash',
        name: 'Reviewer',
        params: { temperature: 0.3 },
        toolsets: ['file']
      },
      reply: 'Here is the draft.'
    })

    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    renderWizard({ onOpenChange, onSaved })

    await send('a reviewer please')

    // Draft converged → the chat swaps to the shared editor form prefilled.
    await screen.findByText('The assistant proposed a draft — review and fine-tune it below.')
    const inputs = screen.getAllByRole('textbox')
    const idInput = inputs.find(input => (input as HTMLInputElement).placeholder === 'code-reviewer') as HTMLInputElement
    expect(idInput.value).toBe('reviewer')

    fireEvent.click(screen.getByRole('button', { name: 'Save submodel' }))

    await waitFor(() => {
      expect(saveSubmodel).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Reviews code.',
          enabled: true,
          id: 'reviewer',
          model: 'openrouter:gemini-2-flash',
          name: 'Reviewer',
          params: { temperature: 0.3 },
          toolsets: ['file']
        })
      )
    })
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('back to chat returns from the draft form without saving', async () => {
    submodelWizardTurn.mockResolvedValueOnce({
      draft: { name: 'Reviewer' },
      reply: 'draft'
    })

    renderWizard()
    await send('go')
    await screen.findByText('The assistant proposed a draft — review and fine-tune it below.')

    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save submodel' })).toBeNull()
    })
    expect(saveSubmodel).not.toHaveBeenCalled()
  })

  it('editing an existing profile prepends a hidden JSON context and keeps the last turn as user', async () => {
    submodelWizardTurn.mockResolvedValueOnce({ reply: 'What should change?' })

    const existing = {
      description: 'old',
      enabled: true,
      errors: [],
      id: 'old',
      name: 'Old',
      valid: true
    }

    renderWizard({ existingProfile: existing })
    await send('make it terser')

    await waitFor(() => {
      expect(submodelWizardTurn).toHaveBeenCalledTimes(1)
    })

    const history = submodelWizardTurn.mock.calls[0][0] as { content: string; role: string }[]
    expect(history[0].role).toBe('user')
    expect(history[0].content).toContain('"id": "old"')
    expect(history[history.length - 1]).toEqual({ content: 'make it terser', role: 'user' })

    // The preamble stays out of the rendered chat surface.
    expect(screen.queryByText(/"id": "old"/)).toBeNull()
    expect(screen.getByText('What should change?')).toBeTruthy()
  })

  it('shows an error and keeps the draft absent when the RPC fails', async () => {
    submodelWizardTurn.mockRejectedValueOnce(new Error('boom'))

    renderWizard()
    await send('hello')

    await waitFor(() => {
      expect(screen.getByText('The assistant call failed. Try again.')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Save submodel' })).toBeNull()
  })
})
