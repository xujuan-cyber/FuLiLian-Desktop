import { beforeEach, describe, expect, it, vi } from 'vitest'

const { refreshActiveProfile } = vi.hoisted(() => ({
  refreshActiveProfile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/store/profile', () => ({ refreshActiveProfile }))

import { $desktopBoot } from '@/store/boot'

import { refreshActiveProfileAfterBoot } from './refresh-active-profile-after-boot'

function setBootRunning(running: boolean): void {
  $desktopBoot.set({ ...$desktopBoot.get(), running })
}

// The helper loads @/store/boot through a dynamic import, so drain the module
// promise + microtask queue before asserting.
async function flush(): Promise<void> {
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('refreshActiveProfileAfterBoot', () => {
  beforeEach(async () => {
    // Flush any listener a previous case left pending, then start a fresh boot
    // window. (The deferral flag is module-scoped by design.)
    setBootRunning(false)
    await flush()
    refreshActiveProfile.mockClear()
    setBootRunning(true)
  })

  it('holds the refresh while the desktop boot is still running', async () => {
    refreshActiveProfileAfterBoot()
    await flush()

    expect(refreshActiveProfile).not.toHaveBeenCalled()
  })

  it('runs the refresh once the boot settles', async () => {
    refreshActiveProfileAfterBoot()
    await flush()
    expect(refreshActiveProfile).not.toHaveBeenCalled()

    setBootRunning(false)
    await flush()

    expect(refreshActiveProfile).toHaveBeenCalledTimes(1)
  })

  it('runs the refresh immediately when the boot has already settled', async () => {
    setBootRunning(false)
    await flush()

    refreshActiveProfileAfterBoot()
    await flush()

    expect(refreshActiveProfile).toHaveBeenCalledTimes(1)
  })

  it('collapses several boot-window callers into a single deferred refresh', async () => {
    refreshActiveProfileAfterBoot()
    refreshActiveProfileAfterBoot()
    refreshActiveProfileAfterBoot()
    await flush()

    setBootRunning(false)
    await flush()

    expect(refreshActiveProfile).toHaveBeenCalledTimes(1)
  })
})
