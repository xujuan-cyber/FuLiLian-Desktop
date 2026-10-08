/**
 * Source-text guards for the step17 P9b first-frame split.
 *
 * A `lazy()` boundary is not observable at runtime under happy-dom + a
 * synchronous `vi.mock` (the mocked dynamic import resolves on the same tick),
 * so the boundary is pinned by reading the modules — the same reason a render
 * assertion cannot catch a regression back to a static import. These assertions
 * are the red/green evidence for the A4 tamper experiment.
 *
 * The modules asserted here:
 *   - `controller.tsx`               → deferred BrowserPopoutShell / SessionChangesPanel
 *   - `chat/preview-tile.tsx`        → deferred right-rail/preview body
 *   - `chat/browser-popout-shell.tsx`→ deferred right-rail/preview body
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

const controller = read('src/app/contrib/controller.tsx')
const previewTile = read('src/app/chat/preview-tile.tsx')
const browserPopout = read('src/app/chat/browser-popout-shell.tsx')

describe('step17 P9b — controller chat edges load on demand', () => {
  it('lazy-loads BrowserPopoutShell and SessionChangesPanel behind Suspense', () => {
    expect(controller.match(/\blazy\(/g)).toHaveLength(2)
    expect(controller).toMatch(/const BrowserPopoutShell = lazy\(/)
    expect(controller).toMatch(/const SessionChangesPanel = lazy\(/)
    expect(controller).toMatch(
      /<Suspense fallback=\{null\}>[\s\S]*?<BrowserPopoutShell \/>[\s\S]*?<\/Suspense>/
    )
    expect(controller).toMatch(
      /<Suspense fallback=\{null\}>[\s\S]*?<SessionChangesPanel \/>[\s\S]*?<\/Suspense>/
    )
  })

  it('no longer statically imports either module body', () => {
    expect(controller).not.toMatch(
      /^import \{ BrowserPopoutShell \} from '\.\.\/chat\/browser-popout-shell'$/m
    )
    expect(controller).not.toMatch(
      /^import \{ SessionChangesPanel \} from '\.\.\/chat\/right-rail\/session-changes'$/m
    )
  })
})

describe('step17 P9b — the preview body is deferred off the entry graph', () => {
  it('preview-tile lazy-loads right-rail/preview behind Suspense', () => {
    expect(previewTile.match(/\blazy\(/g)).toHaveLength(1)
    expect(previewTile).toMatch(/const PreviewTilePane = lazy\(/)
    expect(previewTile).not.toMatch(/^import \{ PreviewTilePane \} from '\.\/right-rail\/preview'$/m)
    expect(previewTile).toMatch(
      /<Suspense fallback=\{null\}>[\s\S]*?<PreviewTilePane tabId=\{tabId\} \/>[\s\S]*?<\/Suspense>/
    )
  })

  it('browser-popout-shell lazy-loads right-rail/preview behind Suspense', () => {
    expect(browserPopout.match(/\blazy\(/g)).toHaveLength(1)
    expect(browserPopout).toMatch(/const PreviewTilePane = lazy\(/)
    expect(browserPopout).not.toMatch(/^import \{ PreviewTilePane \} from '\.\/right-rail\/preview'$/m)
    expect(browserPopout).toMatch(
      /<Suspense fallback=\{null\}>[\s\S]*?<PreviewTilePane tabId=\{tabId\} \/>[\s\S]*?<\/Suspense>/
    )
  })
})
