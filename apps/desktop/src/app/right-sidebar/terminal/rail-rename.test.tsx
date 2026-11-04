import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { TerminalRail } from './rail'
import { $activeTerminalId, $terminals } from './terminals'

// The test environment resolves translations synchronously, so it always sees
// the English fallback bundle (catalog.ts keeps only `en` resident at startup).

beforeAll(() => {
  stubResizeObserver()
  stubMenuDomApis()
})

afterEach(() => {
  cleanup()
  $terminals.set([])
  $activeTerminalId.set(null)
})

/** Radix opens a ContextMenu on contextmenu after a pointerdown positions it. */
function openContextMenu(target: HTMLElement) {
  fireEvent.pointerDown(target, { button: 2, ctrlKey: false, pointerType: 'mouse' })
  fireEvent.contextMenu(target, { button: 2 })
}

describe('TerminalRail rename', () => {
  it('renames a user tab from its context menu and relabels the tab', async () => {
    $terminals.set([{ auto: true, cwd: 'C:\\repo', id: 'term-1', kind: 'user', title: 'PowerShell' }])
    $activeTerminalId.set('term-1')

    render(<TerminalRail />)

    openContextMenu(screen.getByRole('tab', { name: '1. PowerShell' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }))

    const input = (await screen.findByRole('textbox')) as HTMLInputElement
    expect(input.value).toBe('PowerShell')

    fireEvent.change(input, { target: { value: 'build shell' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The tab relabels through the real renameTerminal store path, and the
    // auto flag flips so shell reporting can't override the user's title.
    expect(screen.getByRole('tab', { name: '1. build shell' })).toBeTruthy()
    expect($terminals.get()[0]).toMatchObject({ auto: false, title: 'build shell' })
  })

  it('does not offer rename for read-only agent tabs', async () => {
    $terminals.set([{ auto: true, cwd: 'C:\\repo', id: 'agent-1', kind: 'agent', procId: 'proc-1', title: 'claude' }])
    $activeTerminalId.set('agent-1')

    render(<TerminalRail />)

    openContextMenu(screen.getByRole('tab', { name: '1. claude' }))
    await screen.findByRole('menuitem', { name: 'Close' })

    expect(screen.queryByRole('menuitem', { name: 'Rename…' })).toBeNull()
  })

  it('disables save while the name is blank', async () => {
    $terminals.set([{ auto: false, cwd: 'C:\\repo', id: 'term-1', kind: 'user', title: 'PowerShell' }])
    $activeTerminalId.set('term-1')

    render(<TerminalRail />)

    openContextMenu(screen.getByRole('tab', { name: '1. PowerShell' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }))

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '   ' } })

    const save = screen.getByRole('button', { name: 'Save' })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    // Submitting must be a no-op: the blank name can't wipe the tab title.
    fireEvent.click(save)
    expect($terminals.get()[0]).toMatchObject({ title: 'PowerShell' })
  })
})
