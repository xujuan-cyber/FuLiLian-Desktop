import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { notify, notifyError } from '@/store/notifications'

import { runSecurityAuditFromPalette } from './security-audit-action'

// Step 16 · T8 动作区「导出审计」: the palette runs the REAL security-audit
// ops action and tails it. Mocked at the API seam; notifications are the
// observable outcome (no fabricated export — the audit-store export has no
// data layer, and this test pins that the row never pretends otherwise).

vi.mock('@/fulilian', () => ({
  runSecurityAudit: vi.fn(),
  getActionStatus: vi.fn()
}))

vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

import { getActionStatus, runSecurityAudit } from '@/fulilian'

const mockRun = vi.mocked(runSecurityAudit)
const mockStatus = vi.mocked(getActionStatus)
const mockNotify = vi.mocked(notify)
const mockNotifyError = vi.mocked(notifyError)

describe('runSecurityAuditFromPalette (T8 动作区)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockRun.mockReset()
    mockStatus.mockReset()
    mockNotify.mockClear()
    mockNotifyError.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tails the started action and notifies success on a clean exit', async () => {
    mockRun.mockResolvedValue({ name: 'security_audit', ok: true, pid: 1 })
    mockStatus.mockResolvedValue({ exit_code: 0, lines: [], name: 'security_audit', pid: 1, running: false })

    const done = runSecurityAuditFromPalette()

    await vi.advanceTimersByTimeAsync(1300)
    await done

    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockStatus).toHaveBeenCalledWith('security_audit', 180)
    expect(mockNotifyError).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })

  it('surfaces a non-zero exit through notifyError instead of a fake success', async () => {
    mockRun.mockResolvedValue({ name: 'security_audit', ok: true, pid: 1 })
    mockStatus.mockResolvedValue({ exit_code: 1, lines: ['boom'], name: 'security_audit', pid: 1, running: false })

    const done = runSecurityAuditFromPalette()

    await vi.advanceTimersByTimeAsync(1300)
    await done

    expect(mockNotify).not.toHaveBeenCalled()
    expect(mockNotifyError).toHaveBeenCalledTimes(1)
  })

  it('never rejects when the launch itself fails', async () => {
    mockRun.mockRejectedValue(new Error('gateway down'))

    await expect(runSecurityAuditFromPalette()).resolves.toBeUndefined()

    expect(mockNotifyError).toHaveBeenCalledTimes(1)
  })
})
