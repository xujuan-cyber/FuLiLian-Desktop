import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { SegmentedControl } from '@/components/ui/segmented-control'
import type { TerminalShellChoice } from '@/global'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { notifyError } from '@/store/notifications'
import { $terminalShellPref, loadTerminalShellPref, setTerminalShellPref } from '@/store/terminal-shell'
import { $wslCliProbe, probeWslClis } from '@/store/wsl-cli'

import { ListRow } from './primitives'

/**
 * Terminal command environment (step17): the local shell preference plus the
 * default WSL distro. Both persist in `userData/terminal-shell.json`; the
 * local choice feeds `terminalShellCommand()` (env override still wins) and
 * the distro feeds the terminal rail's distro picker as its initial value.
 *
 * The distro list reuses the wsl-cli probe's data flow — no probe, no picker
 * (a WSL-less or single-distro machine sees the section exactly as before).
 */
export function TerminalShellSetting() {
  const { t } = useI18n()
  const copy = t.settings.appearance.terminalShell
  const pref = useStore($terminalShellPref)
  const probe = useStore($wslCliProbe)
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    void loadTerminalShellPref()
    void probeWslClis()
  }, [])

  const distros = probe?.error == null ? (probe?.distros ?? []) : []

  async function update(patch: { local?: TerminalShellChoice; wslDistro?: null | string }) {
    const state = await setTerminalShellPref(patch)

    setSaveFailed(state === null)

    if (state === null) {
      notifyError(new Error(copy.saveFailed), copy.saveFailed)
    }
  }

  const shellOptions = [
    { id: 'auto', label: copy.shellAuto },
    { id: 'pwsh', label: copy.shellPwsh },
    { id: 'powershell', label: copy.shellPowershell },
    { id: 'cmd', label: copy.shellCmd }
  ]

  return (
    <ListRow
      below={
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1.5 px-0.5 text-[0.68rem] text-muted-foreground">{copy.localShellTitle}</p>
            <SegmentedControl
              onChange={id => {
                triggerHaptic('selection')
                void update({ local: id as TerminalShellChoice })
              }}
              options={shellOptions}
              value={pref?.local ?? 'auto'}
            />
          </div>
          {saveFailed ? (
            <p className="px-0.5 text-[0.68rem] text-amber-700 dark:text-amber-300">{copy.saveFailed}</p>
          ) : null}
          {distros.length > 1 ? (
            <div>
              <p className="mb-1.5 px-0.5 text-[0.68rem] text-muted-foreground">{copy.wslDistroTitle}</p>
              <div className="flex flex-wrap gap-1.5 px-0.5">
                {[
                  { label: copy.shellAuto, value: null },
                  ...distros.map(distro => ({ label: distro, value: distro }))
                ].map(({ label, value }) => {
                  const active = (pref?.wslDistro ?? null) === value

                  return (
                    <button
                      aria-pressed={active}
                      className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                        active
                          ? 'border-(--ui-stroke-primary) bg-(--chrome-action-hover) text-foreground'
                          : 'border-(--ui-stroke-quaternary) text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'
                      }`}
                      key={value ?? 'auto'}
                      onClick={() => {
                        triggerHaptic('selection')
                        void update({ wslDistro: value })
                      }}
                      type="button"
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 px-0.5 text-[0.68rem] text-muted-foreground">{copy.wslDistroHint}</p>
            </div>
          ) : null}
        </div>
      }
      description={copy.sectionDesc}
      title={copy.sectionTitle}
      wide
    />
  )
}
