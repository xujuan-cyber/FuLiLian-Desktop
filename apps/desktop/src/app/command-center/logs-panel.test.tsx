// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LogsPanel } from './logs-panel'

const mocks = vi.hoisted(() => ({
  getLogs: vi.fn()
}))

vi.mock('@/fulilian', () => ({
  getLogs: mocks.getLogs
}))

vi.mock('../hooks/use-refresh-hotkey', () => ({
  useRefreshHotkey: () => undefined
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      commandCenter: {
        loadingLogs: 'Loading logs...',
        logSearchPlaceholder: 'Filter log lines...',
        noLogs: 'No log lines.'
      },
      ui: {
        search: {
          clear: 'Clear'
        }
      }
    }
  })
}))

function logsResponse(lines: string[]) {
  return { lines, next_offset: null }
}

describe('R11 logs page', () => {
  beforeEach(() => {
    mocks.getLogs.mockReset()
    mocks.getLogs.mockResolvedValue(logsResponse(['line-1', 'line-2']))
  })

  it('fetches the agent file at ALL levels with the deep tail on mount', async () => {
    render(<LogsPanel />)

    await waitFor(() => expect(mocks.getLogs).toHaveBeenCalledTimes(1))

    expect(mocks.getLogs).toHaveBeenCalledWith({ file: 'agent', level: 'ALL', lines: 500, search: undefined })
    expect(await screen.findByText(/line-1/)).toBeTruthy()
  })

  it('passes the file and level filters through to the endpoint (A9)', async () => {
    render(<LogsPanel />)

    await waitFor(() => expect(mocks.getLogs).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('gateway'))
    fireEvent.click(screen.getByText('error'))

    await waitFor(() => expect(mocks.getLogs).toHaveBeenCalledTimes(3))

    expect(mocks.getLogs).toHaveBeenLastCalledWith({ file: 'gateway', level: 'ERROR', lines: 500, search: undefined })
  })

  it('debounces the keyword into the server-side `search` param (A9)', async () => {
    render(<LogsPanel />)

    await waitFor(() => expect(mocks.getLogs).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText('Filter log lines...'), { target: { value: 'traceback' } })

    await waitFor(() => expect(mocks.getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'traceback' })), {
      timeout: 2000
    })
  })

  it('renders the honest empty state when the endpoint returns no lines', async () => {
    mocks.getLogs.mockResolvedValue(logsResponse([]))

    render(<LogsPanel />)

    expect(await screen.findByText('No log lines.')).toBeTruthy()
  })

  it('surfaces the endpoint error instead of an empty pane', async () => {
    mocks.getLogs.mockRejectedValue(new Error('gateway down'))

    render(<LogsPanel />)

    expect(await screen.findByText('gateway down')).toBeTruthy()
  })
})
