// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestComposerFocus: vi.fn() }))

vi.mock('@/app/chat/composer/focus', () => ({ requestComposerFocus: mocks.requestComposerFocus }))

import { Intro } from './intro'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Intro (§5.1 home: greeting + quick chips + mode entry cards)', () => {
  it('renders a time-of-day greeting, the wordmark, quick chips and the three mode cards', () => {
    render(<Intro />)

    const greetings = ['Good morning', 'Good afternoon', 'Good evening']
    expect(greetings.some(greeting => screen.queryByText(greeting) !== null)).toBe(true)

    expect(screen.getByTestId('intro-chip-programming')).toBeTruthy()

    for (const key of ['forensics', 'ctf', 'idle']) {
      expect(screen.getByTestId(`intro-chip-placeholder-${key}`).getAttribute('aria-disabled')).toBe('true')
    }

    for (const key of ['forensics', 'ctf', 'project']) {
      expect(screen.getByTestId(`intro-mode-card-${key}`)).toBeTruthy()
    }
  })

  it('the programming chip performs the one real action: focusing the composer', () => {
    render(<Intro />)

    fireEvent.click(screen.getByTestId('intro-chip-programming'))
    expect(mocks.requestComposerFocus).toHaveBeenCalledWith('active')
  })

  it('placeholder chips never masquerade as buttons (honest until the kind data layer)', () => {
    render(<Intro />)

    for (const key of ['forensics', 'ctf', 'idle']) {
      const chip = screen.getByTestId(`intro-chip-placeholder-${key}`)
      expect(chip.tagName).toBe('SPAN')
      expect(chip.getAttribute('aria-disabled')).toBe('true')
    }

    // No fabricated creation flow text (no fake case numbers/challenge ids).
    expect(document.body.textContent).not.toMatch(/CASE-\d/)
  })
})
