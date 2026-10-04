import { useEffect } from 'react'

import { refreshActiveProfile } from '@/store/profile'

/**
 * Re-pull the running profile + list on mount, and again whenever the window
 * regains focus/visibility -- a profile created, deleted, or renamed by
 * another surface (Manage Profiles, another window, the CLI) leaves the
 * rail's cached $profiles stale until something re-fetches it. Without this,
 * a deleted profile's square lingers in the rail until the user happens to
 * open Manage Profiles (whose own refresh() call was the only other reader).
 *
 * Cheap and best-effort, matching the focus/visibilitychange refresh pattern
 * used elsewhere in the sidebar (see refreshProjects/refreshProjectTree).
 * Extracted into its own hook (rather than left inline in ProfileRail) so the
 * focus/visibility wiring is unit-testable without rendering the whole rail.
 *
 * `enabled` (default true) lets ProfileRail gate the refresh off until the
 * desktop boot has settled, keeping the heavy /api/profiles walk out of the
 * boot window. Ignored (refreshes fire) by default so the extracted wiring and
 * its tests keep their mount-time behavior.
 */
export function useProfileRailRefreshOnActive(enabled = true): void {
  useEffect(() => {
    // `enabled` is false while the desktop boot is still running: the rail
    // mounts under the boot overlay, and its mount refresh would otherwise
    // dispatch the backend's seconds-long /api/profiles skills walk into the
    // boot burst on the serialized fulilian:api channel. The caller flips it
    // true once the boot settles, which re-runs this effect and performs the
    // (now post-boot) refresh.
    if (enabled) {
      void refreshActiveProfile()
    }

    const onActive = () => {
      if (document.visibilityState === 'hidden' || !enabled) {
        return
      }

      void refreshActiveProfile()
    }

    window.addEventListener('focus', onActive)
    document.addEventListener('visibilitychange', onActive)

    return () => {
      window.removeEventListener('focus', onActive)
      document.removeEventListener('visibilitychange', onActive)
    }
  }, [enabled])
}
