/**
 * Tests for electron/boot-timing.ts (P13 主进程启动埋点纯逻辑).
 *
 * Run with: vitest run --project electron  (include 覆盖 electron/**\/*.test.ts)
 */

import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  BOOT_TIMING_PREFIX,
  createBootTiming,
  formatBootMarkLine,
  formatBootMeasureLine,
  formatRendererBootMarkLine,
  isBootMarkName,
  isRendererBootMarkName,
  parseRendererBootMark
} from './boot-timing'

describe('format lines', () => {
  test('mark line carries the fixed grep prefix and name', () => {
    assert.equal(formatBootMarkLine('boot:spawn'), `${BOOT_TIMING_PREFIX} mark boot:spawn`)
  })

  test('renderer mark line appends the renderer epoch ms', () => {
    assert.equal(formatRendererBootMarkLine('boot:composer-ready', 1730000), `${BOOT_TIMING_PREFIX} mark boot:composer-ready t=1730000`)
  })

  test('measure line renders a ms number with one decimal and a ms unit', () => {
    assert.equal(formatBootMeasureLine('resolve', 536.2), `${BOOT_TIMING_PREFIX} measure resolve = 536.2ms`)
    assert.equal(formatBootMeasureLine('spawn→ready', 12), `${BOOT_TIMING_PREFIX} measure spawn→ready = 12ms`)
  })
})

describe('whitelist predicates', () => {
  test('accepts only the fixed main-process names', () => {
    assert.equal(isBootMarkName('boot:resolve:start'), true)
    assert.equal(isBootMarkName('boot:window-shown'), true)
    assert.equal(isBootMarkName('boot:composer-ready'), false)
    assert.equal(isBootMarkName(''), false)
    assert.equal(isBootMarkName(42), false)
    assert.equal(isBootMarkName(null), false)
  })

  test('accepts only the fixed renderer names', () => {
    assert.equal(isRendererBootMarkName('boot:html-parse'), true)
    assert.equal(isRendererBootMarkName('boot:react-mount'), true)
    assert.equal(isRendererBootMarkName('boot:composer-ready'), true)
    assert.equal(isRendererBootMarkName('boot:resolve:start'), false)
    assert.equal(isRendererBootMarkName('evil'), false)
  })
})

describe('parseRendererBootMark — narrow-channel guard', () => {
  test('accepts a whitelisted name with a finite number', () => {
    assert.deepEqual(parseRendererBootMark('boot:react-mount', 1234.6), { name: 'boot:react-mount', t: 1235 })
  })

  test('drops a non-whitelisted name (free text can never reach the log)', () => {
    assert.equal(parseRendererBootMark('boot:evil', 1), null)
    assert.equal(parseRendererBootMark('<script>alert(1)</script>', 1), null)
  })

  test('drops a non-numeric timestamp', () => {
    assert.equal(parseRendererBootMark('boot:react-mount', '1234'), null)
    assert.equal(parseRendererBootMark('boot:react-mount', null), null)
    assert.equal(parseRendererBootMark('boot:react-mount', undefined), null)
  })

  test('drops NaN and Infinity', () => {
    assert.equal(parseRendererBootMark('boot:react-mount', Number.NaN), null)
    assert.equal(parseRendererBootMark('boot:react-mount', Number.POSITIVE_INFINITY), null)
  })

  test('drops an overlong string name', () => {
    assert.equal(parseRendererBootMark('boot:react-mount'.padEnd(5000, 'x'), 1), null)
  })
})

describe('createBootTiming', () => {
  const collect = () => {
    const lines: string[] = []
    let clock = 0
    const timing = createBootTiming({
      now: () => clock,
      sink: line => lines.push(line)
    })

    return {
      lines,
      timing,
      advance: (ms: number) => {
        clock += ms
      }
    }
  }

  test('emits a mark line then a measure once both endpoints arrive', () => {
    const { lines, timing, advance } = collect()

    advance(1000)
    timing.mark('boot:resolve:start')
    advance(536.2)
    timing.mark('boot:resolve:end')

    assert.deepEqual(lines, [
      `${BOOT_TIMING_PREFIX} mark boot:resolve:start`,
      `${BOOT_TIMING_PREFIX} mark boot:resolve:end`,
      `${BOOT_TIMING_PREFIX} measure resolve = 536.2ms`
    ])
  })

  test('chains resolve→spawn→ready→window-shown in order', () => {
    const { lines, timing, advance } = collect()

    timing.mark('boot:resolve:start')
    advance(500)
    timing.mark('boot:resolve:end')
    advance(10)
    timing.mark('boot:spawn')
    advance(3000)
    timing.mark('boot:ready')
    advance(200)
    timing.mark('boot:window-shown')

    assert.deepEqual(lines, [
      `${BOOT_TIMING_PREFIX} mark boot:resolve:start`,
      `${BOOT_TIMING_PREFIX} mark boot:resolve:end`,
      `${BOOT_TIMING_PREFIX} measure resolve = 500ms`,
      `${BOOT_TIMING_PREFIX} mark boot:spawn`,
      `${BOOT_TIMING_PREFIX} measure resolve→spawn = 10ms`,
      `${BOOT_TIMING_PREFIX} mark boot:ready`,
      `${BOOT_TIMING_PREFIX} measure spawn→ready = 3000ms`,
      `${BOOT_TIMING_PREFIX} mark boot:window-shown`,
      `${BOOT_TIMING_PREFIX} measure ready→window-shown = 200ms`,
      `${BOOT_TIMING_PREFIX} measure resolve→window-shown = 3710ms`
    ])
  })

  test('does NOT emit spawn→ready / ready→window-shown when ready never happens', () => {
    const { lines, timing, advance } = collect()

    timing.mark('boot:resolve:start')
    advance(500)
    timing.mark('boot:resolve:end')
    advance(10)
    timing.mark('boot:spawn')
    advance(7000)
    timing.mark('boot:window-shown')

    const measures = lines.filter(line => line.includes('measure'))
    assert.deepEqual(measures, [
      `${BOOT_TIMING_PREFIX} measure resolve = 500ms`,
      `${BOOT_TIMING_PREFIX} measure resolve→spawn = 10ms`,
      `${BOOT_TIMING_PREFIX} measure resolve→window-shown = 7510ms`
    ])
    assert.equal(timing.has('boot:ready'), false)
  })

  test('records only the first occurrence per name (no repeat spam)', () => {
    const { lines, timing, advance } = collect()

    timing.mark('boot:resolve:start')
    advance(100)
    timing.mark('boot:resolve:start')
    advance(100)
    timing.mark('boot:resolve:end')

    assert.deepEqual(lines, [
      `${BOOT_TIMING_PREFIX} mark boot:resolve:start`,
      `${BOOT_TIMING_PREFIX} mark boot:resolve:end`,
      `${BOOT_TIMING_PREFIX} measure resolve = 200ms`
    ])
  })

  test('乱序序列：真机顺序（window-shown 早于 resolve）仍顺序无关地产出，且不产出负值', () => {
    const { lines, timing, advance } = collect()

    timing.mark('boot:app-start')
    advance(2000)
    timing.mark('boot:window-shown')
    advance(6400)
    timing.mark('boot:resolve:start')
    advance(905.1)
    timing.mark('boot:resolve:end')
    advance(50)
    timing.mark('boot:spawn')
    advance(3000)
    timing.mark('boot:ready')

    const measures = lines.filter(line => line.includes('measure'))
    assert.deepEqual(measures, [
      `${BOOT_TIMING_PREFIX} measure app-start→window-shown = 2000ms`,
      `${BOOT_TIMING_PREFIX} measure window-shown→resolve:start = 6400ms`,
      `${BOOT_TIMING_PREFIX} measure resolve = 905.1ms`,
      `${BOOT_TIMING_PREFIX} measure resolve→spawn = 50ms`,
      `${BOOT_TIMING_PREFIX} measure spawn→ready = 3000ms`
    ])

    // 负值 / 倒挂组合绝不产出（本机实测 window-shown 早于 resolve:start）。
    assert.equal(measures.some(line => /=\s*-/.test(line)), false)
    for (const line of measures) {
      const ms = Number(line.slice(line.lastIndexOf('= ') + 2, -2))
      assert.ok(ms >= 0, `measure must not be negative: ${line}`)
    }
    assert.equal(lines.includes(`${BOOT_TIMING_PREFIX} measure resolve→window-shown = -6400ms`), false)
    assert.equal(lines.includes(`${BOOT_TIMING_PREFIX} measure ready→window-shown = -10355ms`), false)
  })

  test('正序序列：app-start → resolve → spawn → ready → window-shown 正常产出', () => {
    const { lines, timing, advance } = collect()

    timing.mark('boot:app-start')
    advance(50)
    timing.mark('boot:resolve:start')
    advance(500)
    timing.mark('boot:resolve:end')
    advance(10)
    timing.mark('boot:spawn')
    advance(3000)
    timing.mark('boot:ready')
    advance(200)
    timing.mark('boot:window-shown')

    const measures = lines.filter(line => line.includes('measure'))
    assert.deepEqual(measures, [
      `${BOOT_TIMING_PREFIX} measure resolve = 500ms`,
      `${BOOT_TIMING_PREFIX} measure resolve→spawn = 10ms`,
      `${BOOT_TIMING_PREFIX} measure spawn→ready = 3000ms`,
      `${BOOT_TIMING_PREFIX} measure ready→window-shown = 200ms`,
      `${BOOT_TIMING_PREFIX} measure resolve→window-shown = 3710ms`,
      `${BOOT_TIMING_PREFIX} measure app-start→window-shown = 3760ms`
    ])
    assert.equal(measures.some(line => /=\s*-/.test(line)), false)
  })
})
