// @vitest-environment jsdom
// Regression guards for the Capabilities page's UI-debt cleanup (派发单
// 20261105 §T2/T5/T6). Each case is DISCRIMINATIVE on purpose: it fails if the
// fix is reverted to the pre-cleanup form, so a later refactor can't silently
// reintroduce the hardcoded English badge, the raw palette status dot, or the
// forever-blank hub frame.
import { describe, expect, it } from 'vitest'

import { en } from '@/i18n/en'

// Vitest's brokered fs shim rejects `new URL(..., import.meta.url)` (it wants a
// file: URL, the runner hands it an http-ish one). Read siblings off cwd —
// vitest runs with the package root as cwd.
const readSource = async (file: string): Promise<string> => {
  const { readFileSync } = await import('node:fs')

  return readFileSync(`src/app/skills/${file}`, 'utf8')
}

describe('T2 — skill provenance badge reads the i18n map', () => {
  it('exposes the labels the list row and the detail pane both consume', () => {
    // skillSubtitle() now takes t.skills.provenance and renders .agent/.hub.
    // Pin the map the component reads so a rename can't leave a raw literal.
    expect(en.skills.provenance.agent).toBe('Learned')
    expect(en.skills.provenance.hub).toBe('Hub')
  })

  it('has no hardcoded lowercase badge literals left in the source', async () => {
    const src = await readSource('index.tsx')

    // The old code rendered bare `learned` / `hub` text nodes.
    expect(src).not.toMatch(/>\s*learned\s*</)
    expect(src).not.toMatch(/>\s*hub\s*</)
    // And it must route through the shared map.
    expect(src).toContain('t.skills.provenance')
  })
})

describe('T5 — MCP probe status colours come from semantic tokens', () => {
  it('never paints a server status with a raw Tailwind palette colour', async () => {
    const src = await readSource('mcp-tab.tsx')

    // The STATUS_DOT table used bg-emerald-500 / bg-red-500 / bg-amber-500.
    expect(src).not.toContain('bg-emerald-500')
    expect(src).not.toContain('bg-red-500')
    expect(src).not.toContain('bg-amber-500')
    expect(src).not.toContain('text-emerald-400')
    // The semantic replacements are what must be there instead.
    expect(src).toContain("ok: 'bg-success'")
    expect(src).toContain("error: 'bg-destructive'")
    expect(src).toContain("'needs-auth': 'bg-warning'")
  })
})

describe('T7 — MCP parse errors are codes, not English prose', () => {
  it('throws stable codes the UI can localise', async () => {
    const mod = await import('./mcp-tab')

    expect(mod.MCP_DOC_INVALID_JSON).toBe('mcp-doc-invalid-json')
    expect(mod.MCP_DOC_OBJECT_REQUIRED).toBe('mcp-doc-object-required')
    expect(mod.MCP_DOC_UNNAMED_SERVER).toBe('mcp-doc-unnamed-server')
  })

  it('maps each code to the localised sentence and passes other errors through', async () => {
    const { mcpDocErrorText } = await import('./mcp-tab')
    const m = en.settings.mcp

    expect(mcpDocErrorText(new Error('mcp-doc-invalid-json'), m)).toBe(m.invalidJson)
    expect(mcpDocErrorText(new Error('mcp-doc-object-required'), m)).toBe(m.objectRequired)
    expect(mcpDocErrorText(new Error('mcp-doc-unnamed-server'), m)).toBe(m.docUnnamedServer)

    // A genuine backend failure keeps its own (readable) message.
    expect(mcpDocErrorText(new Error('ECONNREFUSED'), m)).toBe('ECONNREFUSED')
    expect(mcpDocErrorText('plain string', m)).toBe('plain string')
  })

  it('has no raw English throw literals left in the parser', async () => {
    const src = await readSource('mcp-tab.tsx')

    expect(src).not.toContain("throw new Error('Expected a JSON object')")
    expect(src).not.toContain('throw new Error(\'Wrap the server in')
  })
})

describe('T6 — hub frame failure card', () => {
  it('ships the localized copy and a retry affordance the picker renders', () => {
    expect(en.skills.hub.loadFailed).toBeTruthy()
    expect(en.skills.hub.loadFailedHint).toBeTruthy()
    expect(en.skills.hub.retry).toBeTruthy()
  })

  it('guards the iframe with a load timeout instead of a forever-blank frame', async () => {
    const src = await readSource('embedded-hub-picker.tsx')

    // The deadline + the failure state are the whole fix.
    expect(src).toContain('HUB_LOAD_TIMEOUT_MS')
    expect(src).toContain('setHubFailed(true)')
    // Load/error handlers on the frame, and a remount key for Retry.
    expect(src).toContain('onLoad={() => setHubFailed(false)}')
    expect(src).toContain('onError={() => setHubFailed(true)}')
    expect(src).toContain('key={reloadKey}')
    // The failure branch must actually be reachable in the JSX.
    expect(src).toContain('hubFailed ?')
  })
})
