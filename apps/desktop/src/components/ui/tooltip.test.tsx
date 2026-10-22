import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { suppressNonKeyboardFocusOpen, Tip } from './tooltip'

// Radix opens tooltips on ANY trigger focus; menus/dialogs restore focus to
// their trigger on close, which left tips stuck open after a mouse pick (e.g.
// the composer model pill). The trigger's focus handler must preventDefault —
// which Radix's composed handler honors — for non-keyboard focus only.
//
// The regression these guard: `:focus-visible` on its own says "true" for a
// mouse pick out of a Radix menu, because the menu's autofocus/arrow-key
// navigation puts Chromium in keyboard modality before focus returns to the
// trigger. Only the last real input device separates the two cases.

const focusEvent = (matchesImpl: (selector: string) => boolean) => {
  const preventDefault = vi.fn()

  return {
    event: {
      currentTarget: { matches: matchesImpl } as unknown as HTMLElement,
      preventDefault
    } as unknown as React.FocusEvent<HTMLElement>,
    preventDefault
  }
}

const focusVisible = (selector: string) => selector === ':focus-visible'
const notFocusVisible = (selector: string) => selector !== ':focus-visible'

describe('suppressNonKeyboardFocusOpen', () => {
  it('suppresses the focus-open when a mouse pick restores focus to the trigger', () => {
    // The menu leaves Chromium in keyboard modality, so :focus-visible matches
    // even though the user clicked — this is the model-pill bug.
    const { event, preventDefault } = focusEvent(focusVisible)

    suppressNonKeyboardFocusOpen(event, 'pointer')

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('suppresses the focus-open when focus is not keyboard-visible', () => {
    const { event, preventDefault } = focusEvent(notFocusVisible)

    suppressNonKeyboardFocusOpen(event, 'pointer')

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('keeps the focus-open for keyboard (Tab) focus — a11y path', () => {
    const { event, preventDefault } = focusEvent(focusVisible)

    suppressNonKeyboardFocusOpen(event, 'keyboard')

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('still suppresses a programmatic focus that is not focus-visible in keyboard modality', () => {
    const { event, preventDefault } = focusEvent(notFocusVisible)

    suppressNonKeyboardFocusOpen(event, 'keyboard')

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('falls back to the modality when :focus-visible is unsupported', () => {
    const unsupported = () => {
      throw new Error('unsupported selector')
    }

    const keyboard = focusEvent(unsupported)

    suppressNonKeyboardFocusOpen(keyboard.event, 'keyboard')

    expect(keyboard.preventDefault).not.toHaveBeenCalled()

    const pointer = focusEvent(unsupported)

    suppressNonKeyboardFocusOpen(pointer.event, 'pointer')

    expect(pointer.preventDefault).toHaveBeenCalledOnce()
  })
})

// P2-1: `Tip` puts the trigger props (incl. `aria-describedby`, which Radix
// supplies as `undefined` while closed) on its child via `asChild`. A Fragment
// cannot carry props — React drops the whole set and warns
// "Invalid prop `aria-describedby` supplied to `React.Fragment`", which means
// the description silently never reaches the accessibility tree.
afterEach(cleanup)

describe('Tip trigger target', () => {
  it('attaches the trigger to a real element when the child is a Fragment', () => {
    const errors: string[] = []

    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })

    try {
      const { container } = render(
        <Tip label="hint">
          <>
            <span data-testid="inline-a" />
            <span data-testid="inline-b" />
          </>
        </Tip>
      )

      expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeTruthy()
      expect(container.querySelector('[data-testid="inline-a"]')).toBeTruthy()
      expect(errors.join('\n')).not.toContain('React.Fragment')
      expect(errors.join('\n')).not.toContain('aria-describedby')
    } finally {
      spy.mockRestore()
    }
  })
})
