import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { WslCliName, WslCliOptin, WslCliProbeResult } from '@/global'
import { $bindings } from '@/store/keybinds'
import { $wslCliDistro, $wslCliOptin, $wslCliProbe, $wslCliSelected } from '@/store/wsl-cli'

import { TerminalRail } from './rail'
import { $activeTerminalId, $terminals } from './terminals'

const NAMES: WslCliName[] = ['claude', 'codex', 'codebuddy', 'hermes', 'fulilian']

function optinAll(value = false): WslCliOptin {
  return { claude: value, codebuddy: value, codex: value, fulilian: value, hermes: value }
}

function probeResult(available: WslCliName[], error: null | string = null): WslCliProbeResult {
  return {
    distro: 'Ubuntu',
    distros: ['Ubuntu'],
    entries: NAMES.map(name => ({
      available: available.includes(name),
      name,
      posixPath: available.includes(name) ? `/usr/local/bin/${name}` : null,
      version: available.includes(name) ? `${name} 1.0.0` : null
    })),
    error,
    probedAt: 1_700_000_000_000
  }
}

/** Open a dropdown trigger the way the app's other menu tests do. */
async function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
  fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' })
  fireEvent.click(trigger)
}

describe('TerminalRail', () => {
  beforeEach(() => {
    $terminals.set([{ auto: true, cwd: 'C:\\repo', id: 'term-1', kind: 'user', title: 'PowerShell' }])
    $activeTerminalId.set('term-1')
    $bindings.set({ ...$bindings.get(), 'view.showTerminal': ['ctrl+`'] })
    $wslCliProbe.set(probeResult(['claude', 'hermes']))
    // claude + hermes are opted in and available; codex is opted in but the
    // probe did NOT find it, so it must never be offered.
    $wslCliOptin.set({ optin: { ...optinAll(false), claude: true, codex: true, hermes: true }, probedAt: 1 })
    $wslCliSelected.set(null)
    $wslCliDistro.set(null)
  })

  afterEach(() => {
    cleanup()
    $terminals.set([])
    $activeTerminalId.set(null)
    $wslCliProbe.set(null)
    $wslCliOptin.set(null)
    $wslCliSelected.set(null)
    $wslCliDistro.set(null)
  })

  it('keeps a hotkey label inline inside the portaled tooltip decoration', async () => {
    const view = render(<TerminalRail />)

    fireEvent.pointerMove(screen.getByRole('tab', { name: '1. PowerShell' }), { pointerType: 'mouse' })
    await screen.findByRole('tooltip')

    const content = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')
    const label = content?.firstElementChild?.firstElementChild

    expect(content).not.toBeNull()
    expect(view.container.contains(content)).toBe(false)
    expect(label?.classList.contains('inline-flex')).toBe(true)
    expect(label?.classList.contains('flex')).toBe(false)
  })

  it('⌘-click closes the tab; a plain click selects it', () => {
    $terminals.set([...$terminals.get(), { auto: true, cwd: 'C:\\repo', id: 'term-2', kind: 'user', title: 'zsh' }])

    render(<TerminalRail />)

    fireEvent.click(screen.getByRole('tab', { name: '2. zsh' }), { metaKey: true })
    expect($terminals.get().map(term => term.id)).toEqual(['term-1'])

    fireEvent.click(screen.getByRole('tab', { name: '1. PowerShell' }))
    expect($activeTerminalId.get()).toBe('term-1')
    expect($terminals.get()).toHaveLength(1)
  })

  it('offers only opted-in AND available CLIs in the switcher', async () => {
    render(<TerminalRail />)

    await openMenu(screen.getByRole('button', { name: /Terminal CLI/ }))

    const options = await screen.findAllByRole('menuitemradio')

    // local + the two enabled CLIs; `codex` is opted in but not available.
    expect(options.map(option => option.textContent)).toEqual(['Local shell', 'claude', 'hermes'])
    expect(screen.queryByRole('menuitemradio', { name: 'codex' })).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: 'fulilian' })).toBeNull()
  })

  it('re-targets the active tab and mirrors the pick when a CLI is chosen', async () => {
    render(<TerminalRail />)

    await openMenu(screen.getByRole('button', { name: /Terminal CLI/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'hermes' }))

    // The tab carries the frozen target shape; the workspace remounts on it.
    expect($terminals.get()[0]?.wsl).toEqual({ cli: 'hermes', distro: 'Ubuntu' })
    expect($wslCliSelected.get()).toEqual({ cli: 'hermes', distro: 'Ubuntu' })
  })

  it('reports the tab current CLI on the trigger and switches back to local', async () => {
    $terminals.set([
      { auto: true, cwd: 'C:\\repo', id: 'term-1', kind: 'user', title: 'claude', wsl: { cli: 'claude', distro: 'Ubuntu' } }
    ])

    render(<TerminalRail />)

    expect(screen.getByRole('button', { name: 'Terminal CLI: claude' })).toBeTruthy()

    await openMenu(screen.getByRole('button', { name: 'Terminal CLI: claude' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Local shell' }))

    expect($terminals.get()[0]?.wsl).toBeNull()
    expect($wslCliSelected.get()).toBeNull()
  })

  it('keeps the switcher usable when the probe is empty (unknown availability)', async () => {
    $wslCliProbe.set(null)

    render(<TerminalRail />)

    await openMenu(screen.getByRole('button', { name: /Terminal CLI/ }))

    const options = await screen.findAllByRole('menuitemradio')

    // No CLI may be offered while availability is unknown, but the local shell
    // stays reachable so a WSL tab can always be brought back.
    expect(options.map(option => option.textContent)).toEqual(['Local shell'])
  })

  it('hides the distro picker when the probe found a single distribution', async () => {
    // The default fixture reports `distros: ['Ubuntu']` — the placeholder shape
    // DEV-A v2 ships before real multi-distro data lands.
    render(<TerminalRail />)

    await openMenu(screen.getByRole('button', { name: /Terminal CLI/ }))

    await screen.findAllByRole('menuitemradio')

    expect(screen.queryByRole('menuitemradio', { name: 'Ubuntu' })).toBeNull()
    expect(screen.queryByText('Distribution')).toBeNull()
  })

  it('re-targets the active CLI tab into the chosen distribution', async () => {
    $wslCliProbe.set({ ...probeResult(['claude', 'hermes']), distros: ['Ubuntu', 'Debian'] })
    $terminals.set([
      { auto: true, cwd: 'C:\\repo', id: 'term-1', kind: 'user', title: 'claude', wsl: { cli: 'claude', distro: 'Ubuntu' } }
    ])

    render(<TerminalRail />)

    await openMenu(screen.getByRole('button', { name: 'Terminal CLI: claude' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Debian' }))

    // Same CLI, new distro: the frozen target shape travels to the tab, which
    // the workspace keys on — the PTY restarts in the other distribution.
    expect($terminals.get()[0]?.wsl).toEqual({ cli: 'claude', distro: 'Debian' })
    expect($wslCliSelected.get()).toEqual({ cli: 'claude', distro: 'Debian' })
    expect($wslCliDistro.get()).toBe('Debian')
  })

  it('only records the distro preference while the active tab is the local shell', async () => {
    $wslCliProbe.set({ ...probeResult(['claude', 'hermes']), distros: ['Ubuntu', 'Debian'] })

    render(<TerminalRail />)

    await openMenu(screen.getByRole('button', { name: /Terminal CLI/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Debian' }))

    // The local tab is never dragged into WSL...
    expect($terminals.get()[0]?.wsl).toBeUndefined()
    expect($wslCliSelected.get()).toBeNull()
    // ...but the pick is remembered for the next CLI switch.
    expect($wslCliDistro.get()).toBe('Debian')
  })

  it('lands the next CLI pick in the preferred distribution', async () => {
    $wslCliProbe.set({ ...probeResult(['claude', 'hermes']), distros: ['Ubuntu', 'Debian'] })
    $wslCliDistro.set('Debian')

    render(<TerminalRail />)

    await openMenu(screen.getByRole('button', { name: /Terminal CLI/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'claude' }))

    expect($terminals.get()[0]?.wsl).toEqual({ cli: 'claude', distro: 'Debian' })
  })
})
