// Application menu builder (step 16 · T12 second cut).
//
// The native application menu (File / Edit / View / Window / Help) that only
// exists on macOS — main.ts sets it with `Menu.setApplicationMenu` on darwin
// and `null` elsewhere (see #77845). That assembly and its boot timing stay in
// main.ts; this module only owns the template.
//
// Extracted verbatim from main.ts: structure, labels, accelerators, comments
// and click dispatch are equivalent to the pre-extraction implementation.
// Labels are English by design — the main process has no i18n runtime (same
// posture as the T6 tray, see tray.ts's copy section).
//
// Injectable like ./tray and ./notifications: every action is an injected dep,
// the Electron `Menu` surface defaults to the real one and can be faked in
// tests, and `buildApplicationMenuTemplate` is pure data (no Electron call),
// so the template's structure can be asserted without booting a BrowserWindow.

import { Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { DEFAULT_ZOOM_LEVEL, ZOOM_STEP } from './zoom'

/** Minimal window surface the template's click handlers touch. */
export interface ApplicationMenuWindowLike {
  isDestroyed(): boolean
  webContents: { getZoomLevel(): number }
}

export interface ApplicationMenuDeps {
  /** `process.platform` — drives the DevTools accelerator variant. */
  platform: string
  /** App display name (macOS app-menu heading + About item). */
  appName: string
  /** Live getter: the main window is a mutable binding in main.ts, so the
   *  click handlers must resolve it at invocation time, not template time. */
  getMainWindow: () => ApplicationMenuWindowLike | null
  showAboutPanelFresh: () => void
  sendOpenUpdatesRequested: () => void
  createInstanceWindow: () => void
  sendOpenFolderRequested: () => void
  sendClosePreviewRequested: () => void
  sendPreviewNavCommand: (command: 'back' | 'forward' | 'reload') => void
  toggleDevTools: (window: unknown) => void
  setAndPersistZoomLevel: (window: ApplicationMenuWindowLike | null, zoomLevel: number) => void
  /** Injectable Electron surface — tests pass a fake. */
  menu?: { buildFromTemplate(template: MenuItemConstructorOptions[]): unknown }
}

const DEFAULT_MENU = {
  buildFromTemplate: (template: MenuItemConstructorOptions[]) => Menu.buildFromTemplate(template)
}

/**
 * The application menu as data. Order and content are the contract — this is
 * the verbatim template `main.ts` used to build inline, with every action
 * routed through the injected deps.
 */
export function buildApplicationMenuTemplate(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  const { appName, platform } = deps
  const isMac = platform === 'darwin'
  const template: MenuItemConstructorOptions[] = []

  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    click: () => deps.sendOpenUpdatesRequested()
  }

  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { label: `About ${appName}`, click: () => deps.showAboutPanelFresh() },
        checkForUpdatesItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: 'File',
    submenu: [
      // No accelerator: ⌘⇧N is a rebindable renderer keybind (session.newWindow);
      // a menu accelerator would fight the rebind panel and (on macOS) be
      // swallowed before the renderer sees it. Here purely for discoverability.
      { click: () => deps.createInstanceWindow(), label: 'New Window' },
      // Same no-accelerator rationale: ⌘O is the rebindable renderer keybind
      // (workspace.openFolder). Clicking runs the same open-folder-as-project
      // flow through the renderer.
      { click: () => deps.sendOpenFolderRequested(), label: 'Open Folder…' },
      { type: 'separator' },
      isMac
        ? {
            // NO accelerator: on macOS a registered ⌘W is consumed by the OS
            // menu before the web contents ever sees it (and registerAccelerator
            // false is a no-op on mac — electron#18295). Leaving it off lets the
            // `before-input-event` handler below intercept ⌘W and route it to the
            // renderer's close-active-tab. Clicking the item still closes the tab
            // (or window) via the same request.
            click: () => deps.sendClosePreviewRequested(),
            label: 'Close'
          }
        : { role: 'quit' }
    ]
  })
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      // ⌘⇧V is only wired up by this item existing: an accelerator with no menu
      // entry is never translated into an editor command, so the chord was a
      // no-op in every input in the app. The composer inserts plain text on
      // every paste anyway, so this is the same result as ⌘V there — it's the
      // terminal, preview, and other editable surfaces that need the strip.
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' }
    ]
  })
  template.push({
    label: 'View',
    submenu: [
      // Not `role: 'reload'`: that hard-reloads the RENDERER (every pane, the
      // whole shell) and a focused in-app browser needs ⌘R to mean "reload
      // this page", the way it does in every other browser. ⇧⌘R
      // (`forceReload`) below stays the unconditional escape hatch.
      //
      // No accelerator: ⌘R is claimed in `installPreviewShortcut`, which works
      // on every platform (this menu exists only on macOS). Declaring it here
      // too would fire the item and the input hook for one keypress.
      { click: () => deps.sendPreviewNavCommand('reload'), label: 'Reload' },
      { role: 'forceReload' },
      {
        label: 'Toggle Developer Tools',
        accelerator: platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
        click: (_menuItem, browserWindow) => deps.toggleDevTools(browserWindow || deps.getMainWindow())
      },
      { type: 'separator' },
      {
        label: 'Actual Size',
        accelerator: 'CommandOrControl+0',
        click: () => {
          deps.setAndPersistZoomLevel(deps.getMainWindow(), DEFAULT_ZOOM_LEVEL)
        }
      },
      {
        label: 'Zoom In',
        accelerator: 'CommandOrControl+Plus',
        click: () => {
          const mainWindow = deps.getMainWindow()

          if (mainWindow && !mainWindow.isDestroyed()) {
            deps.setAndPersistZoomLevel(mainWindow, mainWindow.webContents.getZoomLevel() + ZOOM_STEP)
          }
        }
      },
      {
        label: 'Zoom Out',
        accelerator: 'CommandOrControl+-',
        click: () => {
          const mainWindow = deps.getMainWindow()

          if (mainWindow && !mainWindow.isDestroyed()) {
            deps.setAndPersistZoomLevel(mainWindow, mainWindow.webContents.getZoomLevel() - ZOOM_STEP)
          }
        }
      },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  })
  template.push({
    label: 'Window',
    submenu: isMac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'close' }]
  })
  template.push({
    label: 'Help',
    role: 'help',
    submenu: [checkForUpdatesItem]
  })

  return template
}

/**
 * Build the real application menu. main.ts calls this once at boot and hands
 * the result to `Menu.setApplicationMenu` — the builder itself is stateless
 * and the deps resolve the live main window at click time.
 */
export function createApplicationMenuBuilder(
  deps: ApplicationMenuDeps
): () => ReturnType<typeof Menu.buildFromTemplate> {
  const menu = deps.menu ?? DEFAULT_MENU

  return () =>
    menu.buildFromTemplate(buildApplicationMenuTemplate(deps)) as ReturnType<typeof Menu.buildFromTemplate>
}
