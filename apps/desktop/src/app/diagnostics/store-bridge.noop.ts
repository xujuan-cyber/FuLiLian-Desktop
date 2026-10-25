/**
 * Production stand-in for `store-bridge.ts`. `vite.config.ts` aliases the
 * `@/app/diagnostics/store-bridge` id to this module for any build that did
 * not opt in with `FULILIAN_DESKTOP_E2E_STORE_BRIDGE=1` — same rationale as
 * `src/debug/dev-only.noop.ts`: the diagnostics graph must never reach a
 * shipped renderer, and registration call sites additionally DCE away via
 * the `__FULILIAN_E2E_STORE_BRIDGE__` define.
 *
 * Keep this file free of imports and side effects. It must export the same
 * names/types as the real module so store files typecheck identically in
 * both alias modes.
 */

export type StoreSnapshotFn = () => unknown
export type DiagnosticsCounterFn = () => number

export type FulilianStoresRegistry = Readonly<Record<string, StoreSnapshotFn>>
export type FulilianStoreCountersRegistry = Readonly<Record<string, DiagnosticsCounterFn>>

export interface DiagnosticsRegistration {
  stores?: Record<string, StoreSnapshotFn>
  counters?: Record<string, DiagnosticsCounterFn>
}

export function isStoreBridgeEnabled(): boolean {
  return false
}

export function registerDiagnostics(_entry: DiagnosticsRegistration): void {
  // Intentionally empty — the bridge is switched off in this build mode.
}
