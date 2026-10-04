import { refreshActiveProfile } from '@/store/profile'

/**
 * Fire the profile-list refresh OUTSIDE the desktop boot window.
 *
 * `/api/profiles` runs the backend's `list_profiles()`, which walks the skills
 * tree once per profile — the first call after a backend start costs seconds on
 * a profile-heavy install. The renderer fires a burst of read-only calls the
 * moment the gateway opens (config / sessions / model), and they all share one
 * serialized `fulilian:api` channel with this read. Dispatching the profiles
 * walk mid-boot lets it contend with — and delay — the calls that actually gate
 * the first frame / composer availability.
 *
 * The rail renders progressively from `$profiles` (empty → populated; it stays
 * hidden while the list is empty, never an error state), so a post-boot arrival
 * is fine. Post-boot callers (profile / connection switches, focus refreshes)
 * fire immediately; only a call made while the boot is still running is held
 * until `completeDesktopBoot()` lands.
 *
 * `@/store/boot` is loaded LAZILY and on purpose: this helper is imported by
 * widely-shared modules (notably use-background-sync, which store/gateway-switch
 * pulls into most of the renderer's graph), and a static edge to @/store/boot
 * would drag its @/i18n dependency into every one of them — including modules
 * whose tests partially mock @/i18n.
 */
let bootRefreshPending = false

export function refreshActiveProfileAfterBoot(): void {
  void import('@/store/boot')
    .then(({ $desktopBoot }) => {
      if (!$desktopBoot.get().running) {
        void refreshActiveProfile()

        return
      }

      // Collapse several boot-window callers (the gateway-open effect fires once
      // per boot) into one deferred refresh.
      if (bootRefreshPending) {
        return
      }

      bootRefreshPending = true

      const unsubscribe = $desktopBoot.listen(state => {
        if (state.running) {
          return
        }

        unsubscribe()
        bootRefreshPending = false
        void refreshActiveProfile()
      })
    })
    .catch(() => {
      // Boot state unavailable (a partially mocked @/i18n in a test): fall back
      // to the eager refresh so the rail still populates.
      void refreshActiveProfile()
    })
}
