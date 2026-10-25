import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// N-5 A3 red-proof: the settings page's DEFAULT tab chunk (config:model →
// ./config-settings) must be warmed by the idle prefetch. Runtime observability
// is impossible under happy-dom (requestIdleCallback never fires and the lazy
// module map is invisible — same reasoning as settings/index.test.tsx's lazy
// note), so this pins the wiring by source text: deleting the
// `import('@/app/settings/config-settings')` line from PAGE_MODULES turns this
// red.
describe('prefetch-page-chunks', () => {
  it('warms the settings page AND its default config tab chunk', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/prefetch-page-chunks.ts'), 'utf8')

    const settingsEntry = src.indexOf("() => import('@/app/settings')")
    const configTab = src.indexOf("() => import('@/app/settings/config-settings')")

    expect(settingsEntry).toBeGreaterThan(-1)
    expect(configTab).toBeGreaterThan(-1)
    // Same idle chain: the page module resolves before its default tab's chunk
    // is warmed, so the deeper chunk never overtakes the page shell.
    expect(configTab).toBeGreaterThan(settingsEntry)
  })
})
