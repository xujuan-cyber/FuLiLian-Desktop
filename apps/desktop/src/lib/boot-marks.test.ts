/**
 * Tests for src/lib/boot-marks.ts (P13 渲染层启动埋点).
 */

import { afterEach, describe, expect, test, vi } from 'vitest'

import { RENDERER_BOOT_MARK_NAMES, reportBootMark, resetBootMarksForTest } from './boot-marks'

afterEach(() => {
  resetBootMarksForTest()
})

describe('reportBootMark', () => {
  test('forwards a whitelisted name with an absolute epoch-ms timestamp', () => {
    const spy = vi.fn()
    reportBootMark('boot:react-mount', { reportBootMark: spy })

    expect(spy).toHaveBeenCalledTimes(1)
    const [name, t] = spy.mock.calls[0]
    expect(name).toBe('boot:react-mount')
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeGreaterThan(0)
  })

  test('reports each name exactly once', () => {
    const spy = vi.fn()
    reportBootMark('boot:composer-ready', { reportBootMark: spy })
    reportBootMark('boot:composer-ready', { reportBootMark: spy })

    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('a missing bridge is a silent no-op', () => {
    expect(() => reportBootMark('boot:html-parse', undefined)).not.toThrow()
  })

  test('a throwing bridge is swallowed', () => {
    const bridge = {
      reportBootMark: () => {
        throw new Error('boom')
      }
    }
    expect(() => reportBootMark('boot:html-parse', bridge)).not.toThrow()
  })

  test('all declared renderer marks are forwarded', () => {
    const spy = vi.fn()
    for (const name of RENDERER_BOOT_MARK_NAMES) {
      reportBootMark(name, { reportBootMark: spy })
    }

    expect(spy.mock.calls.map(call => call[0])).toEqual([...RENDERER_BOOT_MARK_NAMES])
  })
})
