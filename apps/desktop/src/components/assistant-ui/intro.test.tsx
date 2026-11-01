// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestComposerFocus: vi.fn() }))

vi.mock('@/app/chat/composer/focus', () => ({ requestComposerFocus: mocks.requestComposerFocus }))

import { en } from '@/i18n/en'

import { Intro } from './intro'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const GREETINGS = [en.home.greeting.morning, en.home.greeting.afternoon, en.home.greeting.evening]

describe('Intro (v3 empty state: left axis greeting, lede, quick chips, entry cards)', () => {
  it('renders the time-of-day greeting and the single shared lede', () => {
    render(<Intro />)

    const shownGreeting = GREETINGS.filter(greeting => screen.queryByText(greeting) !== null)
    expect(shownGreeting).toHaveLength(1)
    expect(screen.getByText(en.home.lede)).toBeTruthy()
  })

  it('keeps every element on one left axis (no centred container, no centred text)', () => {
    const { container } = render(<Intro />)

    const root = container.querySelector('[data-slot="aui_intro"]') as HTMLElement
    expect(root).toBeTruthy()
    expect(root.className).not.toContain('items-center')
    expect(root.className).not.toContain('text-center')

    // Every text node lives under the single content column, and no element in
    // the block re-centres its own copy or floats a paragraph with mx-auto.
    expect(root.querySelector('.v3-column')).toBeTruthy()
    for (const node of Array.from(root.querySelectorAll('*'))) {
      const className = node.getAttribute('class') ?? ''
      expect(className).not.toContain('text-center')
      expect(className).not.toContain('mx-auto')
    }
  })

  it('renders quick chips left-aligned: one real action plus honest placeholders', () => {
    render(<Intro />)

    const chipRow = screen.getByTestId('intro-chips')
    expect(chipRow.className).toContain('flex-wrap')
    expect(chipRow.className).not.toContain('justify-center')

    const action = screen.getByTestId('intro-chip-programming')
    expect(action.tagName).toBe('BUTTON')
    expect(action.getAttribute('title')).toBe(en.home.chips.programmingTip)
    // §6: no green chip — the accent is reserved for verified states.
    expect(action.className).not.toContain('accent')

    const placeholder = screen.getByTestId('intro-chip-placeholder-idle')
    expect(placeholder.tagName).toBe('SPAN')
    expect(placeholder.getAttribute('aria-disabled')).toBe('true')
    expect(placeholder.className).toContain('opacity-60')
    expect(placeholder.getAttribute('title')).toBe(en.home.chips.placeholderTip)
  })

  it('the quick-action chip performs the one real action: focusing the composer', () => {
    render(<Intro />)

    fireEvent.click(screen.getByTestId('intro-chip-programming'))
    expect(mocks.requestComposerFocus).toHaveBeenCalledWith('active')
  })

  it('lists the entry card in a grid with a clamped description', () => {
    const { container } = render(<Intro />)

    const card = screen.getByTestId('intro-mode-card-project')

    expect(card.className).toContain('min-h-28')
    expect(card.className).toContain('rounded-xl')
    expect(card.className).toContain('p-4')

    // Description is clamped to three lines, so a longer translation can never
    // push the card out of alignment.
    for (const node of Array.from(container.querySelectorAll('[data-testid^="intro-mode-card-"] > div:last-child'))) {
      expect(node.className).toContain('line-clamp-3')
    }

    const grid = card.parentElement as HTMLElement
    expect(grid.className).toContain('sm:grid-cols-3')
    expect(grid.className).toContain('gap-3')

    expect(screen.getByText(en.home.section.title)).toBeTruthy()
  })

  it('never renders developer-facing copy on the canvas', () => {
    render(<Intro />)

    const text = document.body.textContent ?? ''
    // The retired chipsNote key stays in the catalog but is no longer rendered.
    expect(text).not.toContain(en.home.chipsNote)
    expect(text).not.toMatch(/kind|data layer|static placeholder/i)
    // No fabricated case numbers / challenge ids.
    expect(text).not.toMatch(/CASE-\d/)
  })
})
