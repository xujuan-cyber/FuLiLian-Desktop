import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $terminalTakeover, setTerminalTakeover } from '@/app/right-sidebar/store'
import { group, split } from '@/components/pane-shell/tree/model'
import { applyLayoutPreset } from '@/components/pane-shell/tree/presets'
import {
  $dismissedPanes,
  $hiddenTreePanes,
  $layoutTree,
  bindToolPaneCollapse,
  isPaneVisible
} from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'

// Ground truth for "the terminal-left preset put the terminal somewhere else /
// applying it left the terminal hidden". The preset itself lives inline in
// controller.tsx (loading that module in a test drags in the whole app graph),
// so the source text is pinned the same way controller.test.tsx pins its
// lazy() boundaries, while the RUNTIME half drives the real store functions —
// applyLayoutPreset + bindToolPaneCollapse — with the controller's wiring
// shape: the takeover atom IS the terminal's toggle store.

const disposers: (() => void)[] = []

beforeEach(() => {
  window.localStorage.clear()
  $dismissedPanes.set(new Set())
  $hiddenTreePanes.set(new Set())
  $terminalTakeover.set(false)

  for (const [id, data] of [
    ['workspace', { placement: 'main', uncloseable: true }],
    ['sessions', { placement: 'left', collapsible: true }],
    ['terminal', { placement: 'bottom', revealOnPreset: true }],
    ['review', { placement: 'right' }],
    ['files', { placement: 'right' }]
  ] as const) {
    disposers.push(registry.register({ area: 'panes', data, id, render: () => null, title: id }))
  }
})

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  window.localStorage.clear()
})

/** The preset's tree, in the shape controller.tsx declares it. */
const terminalLeftTree = () =>
  split(
    'row',
    [
      group(['terminal'], { id: 'grp-terminal-left' }),
      group(['sessions'], { id: 'grp-sessions' }),
      group(['workspace'], { id: 'grp-main' }),
      split(
        'row',
        [group(['review'], { id: 'grp-review' }), group(['files'], { id: 'grp-files' })],
        [1, 1.2],
        'spl-rail'
      )
    ],
    [1, 1, 3.4, 1.25],
    'spl-root-left'
  )

describe('the terminal-left preset registration', () => {
  // Source-text guard: the registration and the tree shape live inline in
  // controller.tsx, whose module graph is too heavy to import here.
  const controller = () => readFileSync(resolve(process.cwd(), 'src/app/contrib/controller.tsx'), 'utf8')

  it('registers a terminal-left preset ordered between terminal-deck and quad', () => {
    const source = controller()

    expect(source).toMatch(/id: 'terminal-left', area: 'layouts', title: 'Terminal left', order: 25/)
  })

  it('declares the terminal column as the first child of the root row', () => {
    const source = controller()
    const tree = source.match(/const TERMINAL_LEFT_TREE = split\([\s\S]*?\n\)/)

    expect(tree).not.toBeNull()

    const body = tree![0]
    const terminalAt = body.indexOf("'grp-terminal-left'")
    const sessionsAt = body.indexOf("'grp-sessions'")
    const mainAt = body.indexOf("'grp-main'")

    // First column AND the same left-tier order as the other presets.
    expect(terminalAt).toBeGreaterThanOrEqual(0)
    expect(terminalAt).toBeLessThan(sessionsAt)
    expect(sessionsAt).toBeLessThan(mainAt)
  })

  it('keeps revealOnPreset on the terminal pane so the preset can turn takeover on', () => {
    expect(controller()).toMatch(/revealOnPreset: true/)
  })
})

describe('applying the terminal-left preset', () => {
  it('puts the terminal in the first column of the root row, visible with takeover on', () => {
    // Production wiring (controller.tsx): the takeover atom IS the terminal's
    // toggle store; the closer/opener write it back.
    bindToolPaneCollapse(
      'terminal',
      $terminalTakeover,
      () => setTerminalTakeover(false),
      () => setTerminalTakeover(true)
    )

    applyLayoutPreset('terminal-left', terminalLeftTree())

    const tree = $layoutTree.get()

    expect(tree?.type).toBe('split')

    if (tree?.type === 'split') {
      expect(tree.orientation).toBe('row')

      const first = tree.children[0]

      expect(first.type).toBe('group')
      expect(first.type === 'group' ? first.panes : []).toContain('terminal')
    }

    // revealOnPreset routes through the bound opener — the preset must leave
    // the terminal actually ON SCREEN, not collapsed behind the ⌃` toggle.
    expect($terminalTakeover.get()).toBe(true)
    expect(isPaneVisible('terminal')).toBe(true)
  })
})
