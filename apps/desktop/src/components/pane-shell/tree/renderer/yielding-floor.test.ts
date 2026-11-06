import { describe, expect, it } from 'vitest'

import { yieldingFloor } from './track-model'

describe('yieldingFloor', () => {
  it('keeps an absent floor absent (a floor-less zone may shrink to 0)', () => {
    expect(yieldingFloor(undefined, ['22vw'])).toBeUndefined()
  })

  it('keeps the authored floor when nothing is reserved (wide-window byte-identical)', () => {
    expect(yieldingFloor('180px', [])).toBe('180px')
    expect(yieldingFloor('180px', [null, undefined])).toBe('180px')
  })

  it('relaxes against a reserved flex floor (main 22vw)', () => {
    expect(yieldingFloor('180px', ['22vw'])).toBe('min(180px, calc(100% - 22vw))')
  })

  it('reserves fixed floors to the left in declaration order', () => {
    expect(yieldingFloor('10rem', ['22vw', '180px'])).toBe('min(10rem, calc(100% - 22vw - 180px))')
  })

  it('reserves minimized rails (fixed 1.75rem strips)', () => {
    expect(yieldingFloor('160px', ['1.75rem'])).toBe('min(160px, calc(100% - 1.75rem))')
  })

  it('keeps composite floors intact inside min() (largest-tenant max())', () => {
    expect(yieldingFloor('max(237px, 10rem)', ['22vw'])).toBe(
      'min(max(237px, 10rem), calc(100% - 22vw))'
    )
  })

  // A tiny evaluator mirroring what the browser resolves for the emitted
  // expressions: min(floor, container - reserved), negatives clamped to 0 —
  // the CSS contract the relaxation leans on (no NaN, no negative track).
  const px = (part: string, container: number): number => {
    const n = Number.parseFloat(part)

    if (part.endsWith('vw')) {
      return (n / 100) * container
    }

    if (part.endsWith('rem')) {
      return n * 16
    }

    return n
  }

  const resolve = (css: string | undefined, container: number): number => {
    if (!css) {
      return 0
    }

    const relaxed = css.match(/^min\((.+), calc\(100% - (.+)\)\)$/)

    if (!relaxed) {
      return px(css, container)
    }

    const floor = px(relaxed[1], container)
    const reserved = relaxed[2].split(' - ').reduce((sum, part) => sum + px(part, container), 0)

    return Math.max(0, Math.min(floor, container - reserved))
  }

  describe('default row (sessions | main | files) — the 978059e overflow case', () => {
    // The controller's floors: sessions minWidth 180, main 22vw (flex — never
    // yields), files 10rem. Files yields first (rightmost), sessions after.
    const rowTotal = (container: number): number => {
      const main = resolve('22vw', container)
      const sessions = resolve(yieldingFloor('180px', ['22vw']), container)
      const files = resolve(yieldingFloor('10rem', ['22vw', '180px']), container)

      return main + sessions + files
    }

    it('is byte-identical on wide windows (floor stands above the reservation)', () => {
      // 794px window: 794 - 22vw(174.7) = 619.3 ≥ 180 → authored floor.
      expect(resolve(yieldingFloor('180px', ['22vw']), 794)).toBe(180)
      expect(resolve(yieldingFloor('10rem', ['22vw', '180px']), 794)).toBe(160)
      expect(rowTotal(794)).toBeCloseTo(180 + 174.68 + 160, 1)
    })

    it('telescopes to exactly the container once floors must yield', () => {
      // Floors yield below ~436px (0.22C + 180 + 160 = C); there the relaxed
      // floors fill the container exactly — zero overflow, zero dead space.
      for (const width of [400, 421, 430]) {
        expect(rowTotal(width)).toBeCloseTo(width, 1)
      }
    })

    it('stays under the container with full floors when space is plentiful', () => {
      for (const width of [560, 640, 794]) {
        expect(rowTotal(width)).toBeLessThanOrEqual(width)
      }
    })

    it('never goes negative or NaN at extreme widths (min window 400 and below)', () => {
      for (const width of [400, 350, 268, 200, 100, 1]) {
        const total = rowTotal(width)

        expect(Number.isFinite(total)).toBe(true)
        expect(total).toBeLessThanOrEqual(width + 0.001)
        expect(total).toBeGreaterThanOrEqual(0)
      }
    })

    it('yields the right rail first, the sidebar floor last', () => {
      // At 400px: main keeps 88, sessions keeps its 180 floor, files absorbs
      // the whole deficit down to 132 — matching the product's yield order.
      expect(resolve(yieldingFloor('10rem', ['22vw', '180px']), 400)).toBeCloseTo(132, 1)
      expect(resolve(yieldingFloor('180px', ['22vw']), 400)).toBeCloseTo(180, 1)
    })
  })
})
