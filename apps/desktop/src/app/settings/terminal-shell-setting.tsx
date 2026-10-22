import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { TerminalShellChoice } from '@/global'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { notifyError } from '@/store/notifications'
import { $terminalShellPref, loadTerminalShellPref, setTerminalShellPref } from '@/store/terminal-shell'
import { $wslCliProbe, probeWslClis } from '@/store/wsl-cli'

import { ListRow } from './primitives'

/**
 * Terminal command environment (step17 + N1/N2).
 *
 * Two independent things live here:
 *
 *  - the LOCAL shell preference, which is what new terminals spawn, plus the
 *    resolved answer the main process reports back (`resolvedShell`) so the
 *    page can show the REAL binary path and an explicit warning when the
 *    requested shell is not installed (R-4);
 *  - the default WSL distro (step17).
 *
 * N1: mounting no longer probes WSL. The probe runs one `wsl.exe -l -q` plus one
 * `wsl.exe -d … -e bash -lc …` per distro, so it used to fire merely by opening
 * this section — the exact startup-adjacent WSL touch the Windows-side default
 * removes. It is now behind the "detect" button.
 */
export function TerminalShellSetting() {
  const { t } = useI18n()
  const copy = t.settings.appearance.terminalShell
  const pref = useStore($terminalShellPref)
  const probe = useStore($wslCliProbe)
  const [saveFailed, setSaveFailed] = useState(false)
  const [probing, setProbing] = useState(false)

  // Preference load is a local JSON read in the main process — no process is
  // spawned. The WSL probe deliberately does NOT run here (N1).
  useEffect(() => {
    void loadTerminalShellPref()
  }, [])

  const distros = probe && probe.error == null ? probe.distros : []
  const resolved = pref?.resolvedShell ?? null
  const envSide = pref?.envSide ?? 'windows'

  const shellChoices: Record<TerminalShellChoice, string> = {
    auto: copy.shellAuto,
    cmd: copy.shellCmd,
    powershell: copy.shellPowershell,
    pwsh: copy.shellPwsh
  }

  const effectiveShell = resolved?.name ?? (pref ? shellChoices[pref.local] : null)

  async function update(patch: { local?: TerminalShellChoice; wslDistro?: null | string }) {
    const state = await setTerminalShellPref(patch)

    setSaveFailed(state === null)

    if (state === null) {
      notifyError(new Error(copy.saveFailed), copy.saveFailed)
    }
  }

  async function detectDistros() {
    setProbing(true)

    try {
      await probeWslClis()
    } finally {
      setProbing(false)
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
          {/* R-4: what actually runs, and where it lives. */}
          <div>
            <p className="mb-1 px-0.5 text-[0.68rem] text-muted-foreground">{copy.effectiveShellTitle}</p>
            <p className="px-0.5 text-xs text-foreground">{effectiveShell ?? '—'}</p>
            {resolved?.path ? (
              <p className="mt-0.5 break-all px-0.5 font-mono text-[0.62rem] text-(--ui-text-tertiary)">
                {resolved.path}
              </p>
            ) : null}
            {resolved?.degraded ? (
              <p className="mt-1 px-0.5 text-[0.68rem] text-amber-700 dark:text-amber-300">
                {copy.shellFallbackPwsh}
              </p>
            ) : null}
          </div>
          {/* N1: which side new sessions start on. */}
          <div>
            <p className="mb-1 px-0.5 text-[0.68rem] text-muted-foreground">{copy.envSideTitle}</p>
            <p className="px-0.5 text-xs text-foreground">
              {envSide === 'wsl' ? copy.envSideWsl : copy.envSideWindows}
            </p>
          </div>
          {saveFailed ? (
            <p className="px-0.5 text-[0.68rem] text-amber-700 dark:text-amber-300">{copy.saveFailed}</p>
          ) : null}
          <div>
            <p className="mb-1.5 px-0.5 text-[0.68rem] text-muted-foreground">{copy.wslDistroTitle}</p>
            {!probe ? (
              <div className="px-0.5">
                <p className="mb-1.5 text-[0.68rem] text-muted-foreground">{copy.wslDetectHint}</p>
                <Button
                  className="h-7 rounded-md px-2.5 text-[0.7rem]"
                  disabled={probing}
                  onClick={() => void detectDistros()}
                  type="button"
                  variant="secondary"
                >
                  {copy.wslDetectAction}
                </Button>
              </div>
            ) : distros.length > 1 ? (
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
            ) : (
              <p className="px-0.5 text-[0.68rem] text-muted-foreground">{copy.wslDetectEmpty}</p>
            )}
            {distros.length > 1 ? (
              <p className="mt-1.5 px-0.5 text-[0.68rem] text-muted-foreground">{copy.wslDistroHint}</p>
            ) : null}
          </div>
        </div>
      }
      description={copy.sectionDesc}
      title={copy.sectionTitle}
      wide
    />
  )
}
