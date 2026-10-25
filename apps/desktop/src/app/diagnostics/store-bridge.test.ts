// Loading the first-batch store files exercises the exact chain the renderer
// uses: their `@/app/diagnostics/store-bridge` import resolves through the
// vite alias — noop module while the switch is off, real module under
// `FULILIAN_DESKTOP_E2E_STORE_BRIDGE=1`.
import '@/store/gateway'
import '@/store/gateway-switch'
import '@/store/settings-scope'

import { atom } from 'nanostores'
import { describe, expect, it } from 'vitest'

import { $busy, $sessions } from '@/store/session'
import type { SessionInfo } from '@/types/fulilian'

// Relative import = the REAL module in every mode (the alias only rewrites
// the bare `@/app/diagnostics/store-bridge` specifier).
import {
  type FulilianStoresRegistry,
  isStoreBridgeEnabled,
  registerDiagnostics
} from './store-bridge'

const host = window as unknown as {
  __fulilianStores?: FulilianStoresRegistry
  __fulilianStoreCounters?: { readonly [key: string]: () => number }
}

// A3 ① — the switch ships closed: with the build/test env NOT opting in,
// loading the first-batch store files must not install anything on window.
describe.skipIf(isStoreBridgeEnabled())('T-F3 store bridge default-off', () => {
  it('window.__fulilianStores stays undefined after the first-batch store files load', () => {
    expect(host.__fulilianStores).toBeUndefined()
    expect(host.__fulilianStoreCounters).toBeUndefined()
  })
})

// A3 ② — with the switch ON (run with FULILIAN_DESKTOP_E2E_STORE_BRIDGE=1),
// registered snapshots/counters answer and track state changes.
describe.skipIf(!isStoreBridgeEnabled())('T-F3 store bridge (flag=1)', () => {
  it('registers snapshots and counters through the real module', () => {
    const $probe = atom(0)

    registerDiagnostics({
      stores: { 'test.$probe': () => $probe.get() },
      counters: { 'test.$probe.value': () => $probe.get() }
    })

    expect(host.__fulilianStores).toBeDefined()
    expect(host.__fulilianStores!['test.$probe']()).toBe(0)
    expect(host.__fulilianStoreCounters!['test.$probe.value']()).toBe(0)

    $probe.set(2)

    expect(host.__fulilianStores!['test.$probe']()).toBe(2)
    expect(host.__fulilianStoreCounters!['test.$probe.value']()).toBe(2)
    expect(Object.isFrozen(host.__fulilianStores)).toBe(true)
  })

  it('exposes the first-batch domain stores with read-only snapshot functions', () => {
    const stores = host.__fulilianStores!

    for (const key of [
      'gateway.$activeGatewayRoute',
      'gateway.$gateway',
      'gateway-switch.$switching',
      'session.$activeSessionId',
      'session.$awaitingResponse',
      'session.$busy',
      'session.$connection',
      'session.$gatewayState',
      'settings.$settingsRequestProfile',
      'settings.$settingsScopeOverride',
      'settings.$settingsScopeProfile'
    ]) {
      expect(typeof stores[key], `missing snapshot: ${key}`).toBe('function')
    }
  })

  it('tracks session state: counter follows $sessions length, snapshot follows $busy', () => {
    const before = host.__fulilianStoreCounters!['session.$sessions.length']()

    $sessions.set([{ id: 'tf3-probe' } as unknown as SessionInfo])
    $busy.set(true)

    expect(host.__fulilianStoreCounters!['session.$sessions.length']()).toBe(before + 1)
    expect(host.__fulilianStores!['session.$busy']()).toBe(true)

    $busy.set(false)
    $sessions.set([])
  })
})
