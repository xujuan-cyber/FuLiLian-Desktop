import { describe, expect, it } from 'vitest'

import { DEFAULT_PREPAINT_BACKGROUND, chromeBackground } from './chrome-background'
// The RUNTIME derivation — deliberately imported here so the generated values
// are checked against what context.tsx actually paints, not against a second
// copy of the same formula. This is the anti-drift mechanism: presets.ts stays
// the only hand-edited source (its header notes hand edits drift silently),
// and any divergence between the build-time candidates and the runtime paint
// turns this file red.
import { getBaseColors } from './context'
import { DEFAULT_SKIN_NAME } from './presets'

describe('pre-paint background single-sourcing', () => {
  it.each(['light', 'dark'] as const)('derives the %s candidate exactly as the runtime paints it', mode => {
    const runtime = chromeBackground(getBaseColors(DEFAULT_SKIN_NAME, mode).background, mode === 'dark')

    expect(DEFAULT_PREPAINT_BACKGROUND[mode]).toBe(runtime)
  })

  it('emits plain lowercase 6-digit hex for both candidates (meta + inline script form)', () => {
    expect(DEFAULT_PREPAINT_BACKGROUND.light).toMatch(/^#[0-9a-f]{6}$/)
    expect(DEFAULT_PREPAINT_BACKGROUND.dark).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('keeps both candidates distinct surfaces of the default skin (a collapsed pair hides one mode)', () => {
    expect(DEFAULT_PREPAINT_BACKGROUND.light).not.toBe(DEFAULT_PREPAINT_BACKGROUND.dark)
  })
})
