import { useStore } from '@nanostores/react'

import { useI18n } from '@/i18n'
import { $closeToTray, setCloseToTray } from '@/store/tray-state'

import { ToggleRow } from './primitives'

/**
 * Tray — the "minimize to tray when closing the main window" switch.
 *
 * The renderer owns the preference (a settings-facing atom, default ON) and
 * mirrors every change to the main process, which owns the actual close
 * interception and keeps its own persisted copy so a cold launch obeys the
 * setting before Settings has ever been opened. The switch takes effect
 * immediately — no restart (step 16 · T6-14).
 */
export function TraySettings() {
  const { t } = useI18n()
  const tray = t.settings.tray
  const closeToTray = useStore($closeToTray)

  return (
    <ToggleRow
      checked={closeToTray}
      description={tray.enabledDesc}
      label={tray.enabledTitle}
      onChange={on => setCloseToTray(on)}
    />
  )
}
