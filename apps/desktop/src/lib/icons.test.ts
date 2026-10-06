/**
 * Tests for src/lib/icons.ts — icon single-source exports (step 16 · T17, 清单 B3).
 *
 * Anchors the 8 business-icon outlets added by T17-1 so a future rename/removal
 * of the Tabler source icons fails loudly here instead of at an unrelated call site.
 */

import { describe, expect, test } from 'vitest'

import {
  FileReport,
  Fingerprint,
  Flag,
  History,
  Hourglass,
  Lock,
  ShieldCheck,
  Timeline,
  Vault
} from './icons'

describe('T17 icon outlets', () => {
  test('the 8 added business icons are exported as defined components', () => {
    for (const icon of [
      ShieldCheck,
      Fingerprint,
      Vault,
      Timeline,
      FileReport,
      Flag,
      Hourglass,
      History
    ]) {
      expect(icon).toBeDefined()
      expect(icon).not.toBeNull()
    }
  })

  test('Vault (IconShieldLock) stays distinct from Lock (IconLock)', () => {
    // DESIGN_PROPOSAL §3.6 字面写 IconVault，但 Tabler 3.44.0 无此导出；
    // 本轮取 IconShieldLock as Vault（受控偏离）——须与既有 IconLock as Lock 分离。
    expect(Vault).not.toBe(Lock)
  })
})
