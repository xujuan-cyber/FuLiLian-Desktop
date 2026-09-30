import { beforeEach, describe, expect, it } from 'vitest'

import { skinPref, textInkPref, textScalePref, type TextInkTier, type TextScaleTier } from './context'

// R10 typography tiers share the per-profile pref contract with skin/mode.
// Same shape as profile-theme.test.ts's Pref harness.
interface Pref {
  resolve: (profile: string) => string
  assign: (profile: string, value: string) => void
}

const cases = [
  {
    fallback: 'default' satisfies TextScaleTier,
    junk: 'huge',
    name: 'text scale',
    pref: textScalePref as unknown as Pref,
    valid: ['compact', 'default', 'large', 'xlarge'] as const
  },
  {
    fallback: 'default' satisfies TextInkTier,
    junk: 'chartreuse',
    name: 'text ink',
    pref: textInkPref as unknown as Pref,
    valid: ['default', 'graphite', 'ink', 'sepia'] as const
  }
]

describe.each(cases)('per-profile $name (R10)', ({ pref, fallback, valid, junk }) => {
  beforeEach(() => window.localStorage.clear())

  it('boots to the default tier when unassigned (boot 兜底)', () => {
    expect(pref.resolve('default')).toBe(fallback)
    expect(pref.resolve('work')).toBe(fallback)
  })

  it('keeps each profile on its own tier', () => {
    pref.assign('work', valid[0])
    pref.assign('default', valid[2])

    expect(pref.resolve('work')).toBe(valid[0])
    expect(pref.resolve('default')).toBe(valid[2])
  })

  it('lets unassigned profiles inherit the default profile as the global fallback', () => {
    pref.assign('default', valid[3])

    expect(pref.resolve('never-themed')).toBe(valid[3])
  })

  it('normalizes an unknown stored value back to the default tier', () => {
    pref.assign('work', junk)

    expect(pref.resolve('work')).toBe(fallback)
  })
})

describe('R10 typography tiers survive skin switches (A7)', () => {
  beforeEach(() => window.localStorage.clear())

  it('assigning a skin never touches the scale/ink keys', () => {
    textScalePref.assign('work', 'large')
    textInkPref.assign('work', 'sepia')

    skinPref.assign('work', 'ember')

    expect(textScalePref.resolve('work')).toBe('large')
    expect(textInkPref.resolve('work')).toBe('sepia')
  })
})
