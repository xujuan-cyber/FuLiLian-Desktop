/**
 * Idle-time prefetch of lazy page chunks.
 *
 * Every full-page view (skills/messaging/artifacts/…) and every overlay view
 * (settings/agents/…) mounts through `lazy()`. On the FIRST navigation to a
 * page the user waits for chunk fetch + parse + eval before first paint — and
 * with `Suspense fallback={null}` in the route table that wait is a blank pane.
 * On a local Electron install the fetch is a disk read, but parse/eval of a
 * 200–600 KB page chunk still lands on the click's critical path as a long
 * task.
 *
 * After boot settles we chain the page modules through `requestIdleCallback`
 * (one module per idle slot, so no single long task forms). Importing a page
 * module evaluates it but mounts nothing; the later `lazy()` resolution finds
 * the module already in the module map and paints synchronously. Chunk identity
 * is unchanged — `@/app/skills` resolves to the same module the route table's
 * `import('../skills')` loads.
 *
 * Skipped in HUD/browser windows (no page navigation there) and under test
 * (jsdom must not pull the whole page graph into every test that imports the
 * controller).
 */

const PAGE_MODULES: Array<() => Promise<unknown>> = [
  () => import('@/app/agents'),
  () => import('@/app/artifacts'),
  () => import('@/app/case-timeline'),
  () => import('@/app/cases'),
  () => import('@/app/command-center'),
  () => import('@/app/cron'),
  () => import('@/app/messaging'),
  () => import('@/app/profiles'),
  () => import('@/app/settings'),
  () => import('@/app/skills'),
  () => import('@/app/starmap'),
  () => import('@/app/webhooks')
]

let started = false

export function prefetchPageChunks(): void {
  if (started || import.meta.env.MODE === 'test') {
    return
  }

  started = true

  const idle =
    typeof window.requestIdleCallback === 'function'
      ? (cb: () => void) => window.requestIdleCallback(() => cb(), { timeout: 4000 })
      : (cb: () => void) => window.setTimeout(cb, 1500)

  let index = 0

  const step = (): void => {
    if (index >= PAGE_MODULES.length) {
      return
    }

    const load = PAGE_MODULES[index]
    index += 1

    idle(() => {
      void load().catch(() => undefined)
      step()
    })
  }

  step()
}
