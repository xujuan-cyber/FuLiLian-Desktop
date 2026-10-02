import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { STATUS_DOT_STATE_CLASS, StatusDot, statusDotClassName } from './status-dot'

afterEach(cleanup)

describe('StatusDot states (DESIGN_PROPOSAL §3.5)', () => {
  it('maps the five states to their token vocabulary', () => {
    // Running = info blue; needs-input = warning amber + breathe; stalled =
    // hollow ring; background = grey; failed = red.
    expect(STATUS_DOT_STATE_CLASS.running).toContain('bg-info')
    expect(STATUS_DOT_STATE_CLASS['needs-input']).toContain('bg-warning')
    expect(STATUS_DOT_STATE_CLASS['needs-input']).toContain('status-dot-breathe')
    expect(STATUS_DOT_STATE_CLASS.stalled).toContain('border-[1.5px]')
    expect(STATUS_DOT_STATE_CLASS.background).toContain('bg-(--ui-text-tertiary)')
    expect(STATUS_DOT_STATE_CLASS.failed).toContain('bg-destructive')
  })

  it('renders the state class on the dot', () => {
    const { container } = render(<StatusDot state="running" data-testid="dot" />)

    const dot = container.querySelector('[data-testid="dot"]') as HTMLElement

    expect(dot.className).toContain('bg-info')
    expect(dot.className).toContain('size-1.5')
  })

  it('statusDotClassName mirrors the component mapping', () => {
    expect(statusDotClassName('failed')).toBe(STATUS_DOT_STATE_CLASS.failed)
  })

  it('keeps the legacy tone API working (out-of-set consumers)', () => {
    const { container } = render(<StatusDot tone="bad" data-testid="dot" />)

    expect((container.querySelector('[data-testid="dot"]') as HTMLElement).className).toContain('bg-destructive')
  })
})
