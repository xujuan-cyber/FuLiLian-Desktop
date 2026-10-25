/**
 * Ambient declaration for the compile-time E2E store-bridge switch.
 * `vite.config.ts` injects the actual value via `define`:
 *
 *   __FULILIAN_E2E_STORE_BRIDGE__ = (env.FULILIAN_DESKTOP_E2E_STORE_BRIDGE === '1')
 *
 * Default builds (env var unset) bake `false`, which dead-code-eliminates
 * every `if (__FULILIAN_E2E_STORE_BRIDGE__) registerDiagnostics(...)` call
 * site in the store files.
 */
declare const __FULILIAN_E2E_STORE_BRIDGE__: boolean | undefined
