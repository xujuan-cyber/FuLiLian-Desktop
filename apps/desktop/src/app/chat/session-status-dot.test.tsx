import { describe, expect, it } from 'vitest'

import { sessionDotClassName } from './session-status-dot'

// REV-15 P1-1: the needs-input dot must paint from the design token
// (`--color-warning`, whose documented use is exactly this status dot) rather
// than a raw Tailwind amber utility. Discriminative on purpose — the tamper
// check flips `bg-warning` back to `bg-amber-500` and this turns red.
describe('sessionDotClassName (needs-input token)', () => {
  it('uses the warning token and never a raw amber utility', () => {
    const className = sessionDotClassName('needs-input')

    expect(className).toContain('bg-warning')
    expect(className).not.toContain('bg-amber-500')
  })
})
