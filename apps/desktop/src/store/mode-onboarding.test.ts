import { beforeEach, describe, expect, it, vi } from 'vitest'

// Step 16 · T18-1: the three-mode first-use briefing store. The atom is
// module-level and seeded from localStorage, so tests reload the module (same
// convention as composer-popout-preference.test.ts) to exercise the "first use
// only" marker across an app re-entry.

const markerKey = (mode: string) => `fulilian-desktop-mode-onboarding-v1-${mode}`

const loadStore = () => import('./mode-onboarding')

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

describe('mode-onboarding store', () => {
  it('guides only forensics / ctf — project is a no-op', async () => {
    const store = await loadStore()

    store.requestModeOnboarding('project')
    expect(store.$modeOnboarding.get()).toEqual({ status: 'closed' })

    store.requestModeOnboarding('forensics')
    expect(store.$modeOnboarding.get()).toEqual({ acknowledged: false, mode: 'forensics', status: 'open' })
  })

  it('forensics confirm is gated on the explicit authorization acknowledgement', async () => {
    const store = await loadStore()

    store.requestModeOnboarding('forensics')

    // 显式确认闸门：未勾选时确认无效，也不写标记（无静默关闭路径）。
    expect(store.canConfirmModeOnboarding(store.$modeOnboarding.get())).toBe(false)
    store.confirmModeOnboarding()
    expect(store.$modeOnboarding.get().status).toBe('open')
    expect(window.localStorage.getItem(markerKey('forensics'))).toBeNull()

    store.setModeOnboardingAcknowledged(true)
    expect(store.canConfirmModeOnboarding(store.$modeOnboarding.get())).toBe(true)
    store.confirmModeOnboarding()
    expect(store.$modeOnboarding.get()).toEqual({ status: 'closed' })
    expect(window.localStorage.getItem(markerKey('forensics'))).toBe('1')
  })

  it('ctf confirms without the acknowledgement gate', async () => {
    const store = await loadStore()

    store.requestModeOnboarding('ctf')
    expect(store.canConfirmModeOnboarding(store.$modeOnboarding.get())).toBe(true)
    store.confirmModeOnboarding()

    expect(store.$modeOnboarding.get()).toEqual({ status: 'closed' })
    expect(window.localStorage.getItem(markerKey('ctf'))).toBe('1')
  })

  it('A5-① 首用只出现一次：置标记 ⇒ 重进不展示（正例）/ 未置标记 ⇒ 展示（反例）', async () => {
    const first = await loadStore()

    first.requestModeOnboarding('forensics')
    first.setModeOnboardingAcknowledged(true)
    first.confirmModeOnboarding()

    // 反例：CTF 尚未确认（无标记）⇒ 仍会展示。
    first.requestModeOnboarding('ctf')
    expect(first.$modeOnboarding.get().status).toBe('open')
    first.confirmModeOnboarding()

    // 正例：重进（模块重载）后两个已确认模式都不再展示。
    vi.resetModules()
    const reloaded = await loadStore()

    expect(reloaded.modeOnboardingSeen('forensics')).toBe(true)
    expect(reloaded.modeOnboardingSeen('ctf')).toBe(true)

    reloaded.requestModeOnboarding('forensics')
    expect(reloaded.$modeOnboarding.get()).toEqual({ status: 'closed' })
    reloaded.requestModeOnboarding('ctf')
    expect(reloaded.$modeOnboarding.get()).toEqual({ status: 'closed' })
  })

  it('localStorage read failure degrades to "not seen" — the guardrail never silently skips', async () => {
    const store = await loadStore()

    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(store.modeOnboardingSeen('forensics')).toBe(false)

    spy.mockRestore()
  })
})
