/**
 * E2E/diagnostics store bridge — READ-ONLY mirror of registered domain
 * nanostores, parked on `window.__fulilianStores` (snapshot functions) and
 * `window.__fulilianStoreCounters` (numeric gauges: list lengths, bucket
 * counts) so devtools, console probes, and future e2e harnesses can pull
 * state without holding store instances.
 *
 * Switch discipline — independent variable, never reusing an existing
 * test/dev env flag (VITE_PERF_PROBE, NODE_ENV, …):
 *
 *   FULILIAN_DESKTOP_E2E_STORE_BRIDGE=1
 *
 * Two gates keep a default build free of this code (T-F3 acceptance):
 *
 *  1. `vite.config.ts` injects `__FULILIAN_E2E_STORE_BRIDGE__` via `define`
 *     (compile-time boolean; false unless the env var was set at build
 *     time). Store files guard their registration call behind it, so a
 *     default build DCEs the calls — and the snapshot closures with them.
 *  2. `vite.config.ts` ALSO aliases this module id to
 *     `store-bridge.noop.ts` whenever the flag is off, mirroring the
 *     `@/debug/dev-only` precedent: a static import cannot be relied on to
 *     tree-shake, so the whole graph is swapped out instead.
 *
 * Read-only contract: the registry exposes snapshot FUNCTIONS
 * (`() => value`), never store instances. The published registry objects
 * are frozen; the exported types contain no setters; nothing in this
 * module or its registrants calls `.set()` through the bridge.
 */

export type StoreSnapshotFn = () => unknown
export type DiagnosticsCounterFn = () => number

/** `window.__fulilianStores` — flat map of `<domain>.$<store>` → snapshot. */
export type FulilianStoresRegistry = Readonly<Record<string, StoreSnapshotFn>>

/** `window.__fulilianStoreCounters` — flat map of `<name>` → numeric gauge. */
export type FulilianStoreCountersRegistry = Readonly<Record<string, DiagnosticsCounterFn>>

export interface DiagnosticsRegistration {
  stores?: Record<string, StoreSnapshotFn>
  counters?: Record<string, DiagnosticsCounterFn>
}

// Compile-time switch injected by vite `define` (see
// `src/app/diagnostics/e2e-bridge-flag.d.ts`). `typeof` guard keeps unknown
// runners (bare node, future harnesses without the define) from crashing on
// an undeclared identifier.
declare const __FULILIAN_E2E_STORE_BRIDGE__: boolean | undefined

export function isStoreBridgeEnabled(): boolean {
  return typeof __FULILIAN_E2E_STORE_BRIDGE__ !== 'undefined' && __FULILIAN_E2E_STORE_BRIDGE__ === true
}

const snapshots = new Map<string, StoreSnapshotFn>()
const counters = new Map<string, DiagnosticsCounterFn>()

// Re-publish on every registration (store files evaluate in import order)
// so the frozen snapshot always reflects everything registered so far.
function republish(): void {
  if (typeof window === 'undefined') {
    return
  }

  const host = window as unknown as {
    __fulilianStores?: FulilianStoresRegistry
    __fulilianStoreCounters?: FulilianStoreCountersRegistry
  }

  host.__fulilianStores = Object.freeze(Object.fromEntries(snapshots))
  host.__fulilianStoreCounters = Object.freeze(Object.fromEntries(counters))
}

/**
 * Register read-only snapshot functions (and optional numeric counters) for
 * a store file. One call per store file, guarded by
 * `__FULILIAN_E2E_STORE_BRIDGE__` at the call site; no-op when the compile-
 * time switch is off. Idempotent per key (HMR re-eval overwrites).
 */
export function registerDiagnostics(entry: DiagnosticsRegistration): void {
  if (!isStoreBridgeEnabled()) {
    return
  }

  for (const [name, fn] of Object.entries(entry.stores ?? {})) {
    snapshots.set(name, fn)
  }

  for (const [name, fn] of Object.entries(entry.counters ?? {})) {
    counters.set(name, fn)
  }

  republish()
}
