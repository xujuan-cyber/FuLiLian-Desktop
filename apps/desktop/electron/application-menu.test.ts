/**
 * Unit tests for the extracted application-menu module (T12 second cut).
 *
 * main.ts assembles the menu at boot with `Menu.setApplicationMenu`; the
 * template contract here (top-level order, labels, accelerators, roles, click
 * dispatch) must stay stable. Everything Electron-specific is faked — the
 * template assertions run on pure data, and the builder is driven through an
 * injected fake `Menu.buildFromTemplate`, so no Electron runtime is booted.
 */

import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  buildApplicationMenuTemplate,
  createApplicationMenuBuilder,
  type ApplicationMenuDeps,
  type ApplicationMenuWindowLike
} from './application-menu'
import { DEFAULT_ZOOM_LEVEL, ZOOM_STEP } from './zoom'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeWindow(zoomLevel = 0): ApplicationMenuWindowLike {
  return {
    isDestroyed: () => false,
    webContents: { getZoomLevel: () => zoomLevel }
  }
}

interface DepsCalls {
  aboutPanel: number
  openUpdates: number
  newInstance: number
  openFolder: number
  closePreview: number
  previewNav: string[]
  devTools: unknown[]
  zoomSet: Array<{ level: number; window: unknown }>
}

function makeDeps(window: ApplicationMenuWindowLike | null = makeWindow()) {
  const calls: DepsCalls = {
    aboutPanel: 0,
    openUpdates: 0,
    newInstance: 0,
    openFolder: 0,
    closePreview: 0,
    previewNav: [],
    devTools: [],
    zoomSet: []
  }

  const deps: ApplicationMenuDeps = {
    platform: 'darwin',
    appName: 'Fulilian',
    getMainWindow: () => window,
    showAboutPanelFresh: () => {
      calls.aboutPanel++
    },
    sendOpenUpdatesRequested: () => {
      calls.openUpdates++
    },
    createInstanceWindow: () => {
      calls.newInstance++
    },
    sendOpenFolderRequested: () => {
      calls.openFolder++
    },
    sendClosePreviewRequested: () => {
      calls.closePreview++
    },
    sendPreviewNavCommand: command => {
      calls.previewNav.push(command)
    },
    toggleDevTools: target => {
      calls.devTools.push(target)
    },
    setAndPersistZoomLevel: (target, level) => {
      calls.zoomSet.push({ level, window: target })
    }
  }

  return { calls, deps, window }
}

/** Loose accessors — the template is Electron's open-ended shape here. */
type AnyItem = Record<string, any>

function findMenu(template: AnyItem[], label: string): AnyItem {
  const found = template.find(item => item.label === label)

  assert.ok(found, `top-level menu "${label}" missing`)

  return found
}

// ---------------------------------------------------------------------------
// Structure — macOS (the only platform where the menu is actually set)
// ---------------------------------------------------------------------------

describe('buildApplicationMenuTemplate — darwin structure', () => {
  const { deps } = makeDeps()
  const template = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]

  test('top-level order: app menu, File, Edit, View, Window, Help', () => {
    assert.deepEqual(
      template.map(item => item.label ?? item.role),
      ['Fulilian', 'File', 'Edit', 'View', 'Window', 'Help']
    )
  })

  test('app menu: About + Check for Updates + separator/role skeleton', () => {
    const appMenu = findMenu(template, 'Fulilian')
    const submenu = appMenu.submenu as AnyItem[]

    assert.equal(submenu[0].label, 'About Fulilian')
    assert.equal(submenu[1].label, 'Check for Updates…')
    assert.equal(submenu[2].type, 'separator')
    assert.equal(submenu[3].role, 'services')
    assert.equal(submenu[4].type, 'separator')
    assert.equal(submenu[5].role, 'hide')
    assert.equal(submenu[6].role, 'hideOthers')
    assert.equal(submenu[7].role, 'unhide')
    assert.equal(submenu[8].type, 'separator')
    assert.equal(submenu[9].role, 'quit')
    assert.equal(submenu.length, 10)
  })

  test('File menu: New Window + Open Folder… (both no accelerator) + separator + Close', () => {
    const file = findMenu(template, 'File')
    const submenu = file.submenu as AnyItem[]

    assert.equal(submenu[0].label, 'New Window')
    assert.equal(submenu[0].accelerator, undefined)
    assert.equal(submenu[1].label, 'Open Folder…')
    assert.equal(submenu[1].accelerator, undefined)
    assert.equal(submenu[2].type, 'separator')
    assert.equal(submenu[3].label, 'Close')
    assert.equal(submenu[3].accelerator, undefined)
    assert.equal(submenu.length, 4)
  })

  test('Edit menu: exact role sequence incl. pasteAndMatchStyle strip', () => {
    const edit = findMenu(template, 'Edit')

    assert.deepEqual(
      (edit.submenu as AnyItem[]).map(item => item.role ?? item.type),
      ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']
    )
  })

  test('View menu: Reload click (NOT role:reload) + forceReload + devtools + zoom + fullscreen', () => {
    const view = findMenu(template, 'View')
    const submenu = view.submenu as AnyItem[]

    // Reload is a click item, not the hard-reload role (see in-source comment).
    assert.equal(submenu[0].label, 'Reload')
    assert.equal(submenu[0].role, undefined)
    assert.equal(submenu[0].accelerator, undefined)
    assert.equal(submenu[1].role, 'forceReload')
    assert.equal(submenu[2].label, 'Toggle Developer Tools')
    assert.equal(submenu[2].accelerator, 'Alt+Cmd+I')
    assert.equal(submenu[3].type, 'separator')
    assert.equal(submenu[4].label, 'Actual Size')
    assert.equal(submenu[4].accelerator, 'CommandOrControl+0')
    assert.equal(submenu[5].label, 'Zoom In')
    assert.equal(submenu[5].accelerator, 'CommandOrControl+Plus')
    assert.equal(submenu[6].label, 'Zoom Out')
    assert.equal(submenu[6].accelerator, 'CommandOrControl+-')
    assert.equal(submenu[7].type, 'separator')
    assert.equal(submenu[8].role, 'togglefullscreen')
    assert.equal(submenu.length, 9)
  })

  test('Window menu (mac): minimize, zoom, front', () => {
    const win = findMenu(template, 'Window')

    assert.deepEqual((win.submenu as AnyItem[]).map(item => item.role), ['minimize', 'zoom', 'front'])
  })

  test('Help menu: role help + single Check for Updates entry', () => {
    const help = findMenu(template, 'Help')

    assert.equal(help.role, 'help')
    assert.equal((help.submenu as AnyItem[]).length, 1)
    assert.equal((help.submenu as AnyItem[])[0].label, 'Check for Updates…')
  })

  test('Check for Updates is the SAME object in the app menu and Help menu (shared item)', () => {
    const appMenu = findMenu(template, 'Fulilian')
    const help = findMenu(template, 'Help')

    assert.equal((appMenu.submenu as AnyItem[])[1], (help.submenu as AnyItem[])[0])
  })
})

// ---------------------------------------------------------------------------
// Structure — non-mac (main sets the menu to null there, builder stays honest)
// ---------------------------------------------------------------------------

describe('buildApplicationMenuTemplate — non-darwin structure', () => {
  const { deps } = makeDeps()
  const template = buildApplicationMenuTemplate({ ...deps, platform: 'win32' }) as unknown as AnyItem[]

  test('no app menu; File/Close becomes role:quit; Window loses zoom/front', () => {
    assert.deepEqual(
      template.map(item => item.label ?? item.role),
      ['File', 'Edit', 'View', 'Window', 'Help']
    )

    assert.equal((findMenu(template, 'File').submenu as AnyItem[])[3].role, 'quit')
    assert.deepEqual((findMenu(template, 'Window').submenu as AnyItem[]).map(item => item.role), [
      'minimize',
      'close'
    ])
  })

  test('DevTools accelerator switches to the Ctrl variant', () => {
    assert.equal((findMenu(template, 'View').submenu as AnyItem[])[2].accelerator, 'Ctrl+Shift+I')
  })
})

// ---------------------------------------------------------------------------
// Click dispatch
// ---------------------------------------------------------------------------

describe('buildApplicationMenuTemplate — click dispatch', () => {
  test('Check for Updates → sendOpenUpdatesRequested (app menu and Help entry)', () => {
    const { calls, deps } = makeDeps()
    const template = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]

    ;(findMenu(template, 'Fulilian').submenu as AnyItem[])[1].click()
    ;(findMenu(template, 'Help').submenu as AnyItem[])[0].click()

    assert.equal(calls.openUpdates, 2)
  })

  test('About → showAboutPanelFresh', () => {
    const { calls, deps } = makeDeps()
    const template = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]

    ;(findMenu(template, 'Fulilian').submenu as AnyItem[])[0].click()

    assert.equal(calls.aboutPanel, 1)
  })

  test('New Window → createInstanceWindow; Open Folder… → sendOpenFolderRequested', () => {
    const { calls, deps } = makeDeps()
    const template = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]
    const fileSubmenu = findMenu(template, 'File').submenu as AnyItem[]

    fileSubmenu[0].click()
    fileSubmenu[1].click()

    assert.equal(calls.newInstance, 1)
    assert.equal(calls.openFolder, 1)
  })

  test('File → Close (mac) → sendClosePreviewRequested', () => {
    const { calls, deps } = makeDeps()
    const template = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]

    ;(findMenu(template, 'File').submenu as AnyItem[])[3].click()

    assert.equal(calls.closePreview, 1)
  })

  test('View → Reload → sendPreviewNavCommand("reload")', () => {
    const { calls, deps } = makeDeps()
    const template = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]

    ;(findMenu(template, 'View').submenu as AnyItem[])[0].click()

    assert.deepEqual(calls.previewNav, ['reload'])
  })

  test('Toggle Developer Tools forwards the event-provided window, else the main window', () => {
    const mainWindow = makeWindow()
    const { calls, deps } = makeDeps(mainWindow)
    const template = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]
    const item = (findMenu(template, 'View').submenu as AnyItem[])[2]

    item.click()
    assert.equal(calls.devTools.length, 1)
    assert.equal(calls.devTools[0], mainWindow)

    const focused = makeWindow()
    item.click(undefined, focused as never)
    assert.equal(calls.devTools.length, 2)
    assert.equal(calls.devTools[1], focused)
  })

  test('Actual Size resets to DEFAULT_ZOOM_LEVEL on the live main window', () => {
    const { calls, deps, window } = makeDeps()
    const template = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]

    ;(findMenu(template, 'View').submenu as AnyItem[])[4].click()

    assert.equal(calls.zoomSet.length, 1)
    assert.equal(calls.zoomSet[0].window, window)
    assert.equal(calls.zoomSet[0].level, DEFAULT_ZOOM_LEVEL)
  })

  test('Zoom In/Out step the live zoom level by ZOOM_STEP', () => {
    const { calls, deps } = makeDeps(makeWindow(0.5))
    const template = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]
    const viewSubmenu = findMenu(template, 'View').submenu as AnyItem[]

    viewSubmenu[5].click()
    viewSubmenu[6].click()

    assert.equal(calls.zoomSet.length, 2)
    assert.equal(calls.zoomSet[0].level, 0.5 + ZOOM_STEP)
    assert.equal(calls.zoomSet[1].level, 0.5 - ZOOM_STEP)
  })

  test('Zoom In/Out are no-ops without a window or with a destroyed window', () => {
    const { calls, deps } = makeDeps(null)
    const viewSubmenu = findMenu(buildApplicationMenuTemplate(deps) as unknown as AnyItem[], 'View')
      .submenu as AnyItem[]

    viewSubmenu[5].click()
    viewSubmenu[6].click()
    assert.equal(calls.zoomSet.length, 0)

    const destroyed = makeWindow()
    destroyed.isDestroyed = () => true
    const second = makeDeps(destroyed)
    const secondSubmenu = findMenu(buildApplicationMenuTemplate(second.deps) as unknown as AnyItem[], 'View')
      .submenu as AnyItem[]

    secondSubmenu[5].click()
    assert.equal(second.calls.zoomSet.length, 0)
  })

  test('zoom clicks resolve the main window at INVOCATION time (recreated window wins)', () => {
    // The menu is built once at boot; if the main window is recreated later,
    // zoom clicks must hit the NEW window, not the one alive at build time.
    // This pins the getter-per-click contract against a template-time capture.
    let current = makeWindow(0.25)
    const { calls, deps } = makeDeps()
    deps.getMainWindow = () => current
    const viewSubmenu = findMenu(buildApplicationMenuTemplate(deps) as unknown as AnyItem[], 'View')
      .submenu as AnyItem[]

    viewSubmenu[5].click()
    assert.equal(calls.zoomSet[0].window, current)
    assert.equal(calls.zoomSet[0].level, 0.25 + ZOOM_STEP)

    current = makeWindow(-1)
    viewSubmenu[5].click()
    assert.equal(calls.zoomSet[1].window, current)
    assert.equal(calls.zoomSet[1].level, -1 + ZOOM_STEP)
  })
})

// ---------------------------------------------------------------------------
// Builder wiring
// ---------------------------------------------------------------------------

describe('createApplicationMenuBuilder', () => {
  test('passes the template to the injected Menu surface and returns its result', () => {
    const { deps } = makeDeps()
    const templates: unknown[] = []
    const sentinel = { fakeMenu: true }
    const menu = {
      buildFromTemplate: (template: never) => {
        templates.push(template)

        return sentinel
      }
    }

    const build = createApplicationMenuBuilder({ ...deps, menu })

    assert.equal(templates.length, 0)

    const built = build()

    assert.equal(templates.length, 1)
    assert.equal(built, sentinel as never)

    // The handed-over template carries the module's structure. Click handlers
    // are fresh closures per build, so compare the inert shape, not identity.
    const handed = templates[0] as AnyItem[]
    const expected = buildApplicationMenuTemplate(deps) as unknown as AnyItem[]

    assert.equal(handed.length, expected.length)
    assert.deepEqual(
      handed.map(item => item.label ?? item.role),
      expected.map(item => item.label ?? item.role)
    )
    for (const [index, item] of handed.entries()) {
      assert.deepEqual(
        (item.submenu as AnyItem[]).map((sub: AnyItem) => sub.label ?? sub.role ?? sub.type),
        (expected[index].submenu as AnyItem[]).map((sub: AnyItem) => sub.label ?? sub.role ?? sub.type)
      )
    }
  })

  test('every builder invocation re-derives a fresh template through the injected surface', () => {
    const { deps } = makeDeps()
    const templates: unknown[] = []
    const menu = {
      buildFromTemplate: (template: never) => {
        templates.push(template)

        return { fakeMenu: templates.length }
      }
    }

    const build = createApplicationMenuBuilder({ ...deps, menu })
    const first = build() as unknown as { fakeMenu: number }
    const second = build() as unknown as { fakeMenu: number }

    assert.equal(templates.length, 2)
    assert.equal(first.fakeMenu, 1)
    assert.equal(second.fakeMenu, 2)
  })
})
