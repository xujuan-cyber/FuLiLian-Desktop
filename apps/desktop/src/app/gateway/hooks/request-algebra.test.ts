import { describe, expect, it } from 'vitest'

import { createRequestAlgebra } from './request-algebra'

describe('createRequestAlgebra', () => {
  it('issues strictly increasing generations', () => {
    const algebra = createRequestAlgebra()

    expect(algebra.issue()).toBe(1)
    expect(algebra.issue()).toBe(2)
    expect(algebra.issue()).toBe(3)
  })

  it('accepts only the newest generation as latest', () => {
    const algebra = createRequestAlgebra()

    const first = algebra.issue()

    expect(algebra.isLatest(first)).toBe(true)

    const second = algebra.issue()

    expect(algebra.isLatest(first)).toBe(false)
    expect(algebra.isLatest(second)).toBe(true)
  })

  it('issuing a new generation invalidates every earlier one at once', () => {
    const algebra = createRequestAlgebra()

    const a = algebra.issue()
    const b = algebra.issue()
    const c = algebra.issue()

    expect(algebra.isLatest(a)).toBe(false)
    expect(algebra.isLatest(b)).toBe(false)
    expect(algebra.isLatest(c)).toBe(true)

    algebra.issue()

    expect(algebra.isLatest(c)).toBe(false)
  })

  it('current() mirrors the newest issued generation and starts at zero', () => {
    const algebra = createRequestAlgebra()

    expect(algebra.current()).toBe(0)

    const second = algebra.issue()

    expect(algebra.current()).toBe(second)
    expect(algebra.isLatest(algebra.current())).toBe(true)
  })

  it('instances are independent', () => {
    const a = createRequestAlgebra()
    const b = createRequestAlgebra()

    a.issue()

    expect(b.current()).toBe(0)
    expect(b.isLatest(a.current())).toBe(false)
  })
})
