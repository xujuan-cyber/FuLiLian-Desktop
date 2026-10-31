import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  $sidebarWidth,
  CHAT_SIDEBAR_PANE_ID,
  setSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH
} from './layout'
import { clearPaneWidthOverride } from './panes'

const CONTROLLER_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../app/contrib/controller.tsx'),
  'utf8'
)

beforeEach(() => {
  clearPaneWidthOverride(CHAT_SIDEBAR_PANE_ID)
})

describe('the sidebar rail width', () => {
  it('opens at the shipped width, which sits inside the draggable range', () => {
    expect(SIDEBAR_DEFAULT_WIDTH).toBe(237)
    expect(SIDEBAR_MIN_WIDTH).toBe(180)
    expect(SIDEBAR_MAX_WIDTH).toBe(640)
    expect($sidebarWidth.get()).toBe(SIDEBAR_DEFAULT_WIDTH)
  })

  it('shrinks BELOW the default width — the floor is the min, not the default', () => {
    setSidebarWidth(200)

    expect($sidebarWidth.get()).toBe(200)
  })

  it('clamps a too-narrow request to the min', () => {
    setSidebarWidth(100)

    expect($sidebarWidth.get()).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('clamps a too-wide request to the max', () => {
    setSidebarWidth(9999)

    expect($sidebarWidth.get()).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('keeps a width already inside the range untouched', () => {
    setSidebarWidth(420)

    expect($sidebarWidth.get()).toBe(420)
  })
})

// The store clamp above is only half the story: the sash never calls
// `setSidebarWidth` — it reads the pane's declared `minWidth`/`maxWidth` back
// off the zone wrapper's computed style (tree-split.tsx) and uses that as its
// drag floor/cap. A literal here silently wins over the store bounds, which is
// exactly how the rail ended up grow-only (`minWidth: '240px'`, above the 237
// default). Assert the WIRING, not the absence of a number: `width: '240px'`
// is still legitimately in this file.
describe('the sessions pane declares the store bounds', () => {
  it('wires the sash floor to SIDEBAR_MIN_WIDTH', () => {
    expect(CONTROLLER_SOURCE).toMatch(/minWidth:\s*`\$\{SIDEBAR_MIN_WIDTH\}px`/)
  })

  it('wires the sash cap to SIDEBAR_MAX_WIDTH', () => {
    expect(CONTROLLER_SOURCE).toMatch(/maxWidth:\s*`\$\{SIDEBAR_MAX_WIDTH\}px`/)
  })
})
