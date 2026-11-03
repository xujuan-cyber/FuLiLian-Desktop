import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { SegmentedControl } from '@/components/ui/segmented-control'
import type { TerminalShellChoice } from '@/global'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { notifyError } from '@/store/notifications'
import { $terminalShellPref, loadTerminalShellPref, setTerminalShellPref } from '@/store/terminal-shell'

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
 *  - the startup side readout, which the main process resolves for the
 *    effective environment new sessions spawn into.
 */
export function TerminalShellSetting() {
  const { t } = useI18n()
  const copy = t.settings.appearance.terminalShell
  const pref = useStore($terminalShellPref)
  const [saveFailed, setSaveFailed] = useState(false)

  // Preference load is a local JSON read in the main process — no process is
  // spawned.
  useEffect(() => {
    void loadTerminalShellPref()
  }, [])

  const resolved = pref?.resolvedShell ?? null

  const shellChoices: Record<TerminalShellChoice, string> = {
    auto: copy.shellAuto,
    cmd: copy.shellCmd,
    powershell: copy.shellPowershell,
    pwsh: copy.shellPwsh
  }

  const effectiveShell = resolved?.name ?? (pref ? shellChoices[pref.local] : null)

  async function update(patch: { local?: TerminalShellChoice }) {
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
            <p className="px-0.5 text-xs text-foreground">{copy.envSideWindows}</p>
          </div>
          {saveFailed ? (
            <p className="px-0.5 text-[0.68rem] text-amber-700 dark:text-amber-300">{copy.saveFailed}</p>
          ) : null}
        </div>
      }
      description={copy.sectionDesc}
      title={copy.sectionTitle}
      wide
    />
  )
}
