import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { WslCliProbeEntry } from '@/global'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { AlertTriangle, Loader2, RefreshCw } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import { $wslCliOptin, $wslCliProbe, loadWslCliOptin, probeWslClis, setWslCliOptin } from '@/store/wsl-cli'

import { ListRow, Pill } from './primitives'

/**
 * WSL CLI opt-in list (step09 R1/R2). Detects which CLIs exist inside the WSL
 * distro and lets the user opt them into the terminal switcher.
 *
 * Degraded-state rule (contract §四 A/D): `probe.error !== null` means the probe
 * could not run, so availability is UNKNOWN — rows read "Unknown" and stay
 * toggleable (the user is expressing a preference, and their selection is never
 * discarded), never "Unavailable". A successful probe that reports a CLI missing
 * is a fact, and THAT row is disabled.
 */
export function WslCliPanel() {
  const { t } = useI18n()
  const copy = t.settings.toolsets.wslCli
  const probe = useStore($wslCliProbe)
  const optin = useStore($wslCliOptin)
  const [busy, setBusy] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)

  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      setBusy(true)

      try {
        await loadWslCliOptin()
        await probeWslClis(options)
      } catch (err) {
        notifyError(err, copy.failedProbe)
      } finally {
        setBusy(false)
        setLoadedOnce(true)
      }
    },
    [copy.failedProbe]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleToggle(name: WslCliProbeEntry['name'], next: boolean) {
    // Merge write: only the changed key travels, matching the frozen payload.
    const state = await setWslCliOptin({ [name]: next })

    if (!state) {
      notifyError(new Error(copy.failedOptin(name)), copy.failedOptin(name))
    }
  }

  const degraded = probe?.error != null

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <span className="text-[0.72rem] font-medium">{copy.sectionTitle}</span>
        <Button
          aria-label={copy.reprobe}
          disabled={busy}
          onClick={() => void refresh({ force: true })}
          size="sm"
          variant="text"
        >
          <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
        </Button>
      </div>

      <p className="px-0.5 text-[0.68rem] text-muted-foreground">{copy.hint}</p>

      {busy && !probe ? (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {copy.loading}
        </div>
      ) : null}

      {!busy && loadedOnce && !probe ? (
        <p className="px-0.5 text-[0.68rem] text-muted-foreground">{copy.bridgeUnavailable}</p>
      ) : null}

      {degraded ? (
        <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[0.68rem] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>
            <span className="font-medium">{copy.probeFailedTitle}</span> {copy.probeFailedBody(probe?.error ?? '')}
          </span>
        </div>
      ) : null}

      {probe?.entries.map((entry: WslCliProbeEntry) => {
        const label = degraded ? copy.unknown : entry.available ? copy.available : copy.unavailable
        const tone = degraded ? 'warn' : entry.available ? 'primary' : 'muted'
        // Unknown availability keeps the toggle live; a confirmed-missing CLI is
        // disabled (there is nothing to opt into).
        const disabled = optin === null || (!degraded && !entry.available)
        const summary = degraded ? '' : (entry.version ?? entry.posixPath ?? '')

        return (
          <ListRow
            action={
              <Switch
                aria-label={entry.name}
                checked={optin?.optin[entry.name] ?? false}
                disabled={disabled}
                onCheckedChange={on => {
                  triggerHaptic('selection')
                  void handleToggle(entry.name, on)
                }}
              />
            }
            description={summary || undefined}
            key={entry.name}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span>{entry.name}</span>
                <Pill tone={tone}>{label}</Pill>
              </span>
            }
          />
        )
      })}
    </div>
  )
}
