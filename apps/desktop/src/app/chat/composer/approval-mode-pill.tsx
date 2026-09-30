import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { Tip, TipKeybindLabel } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { Zap, ZapFilled } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $approvalModes,
  nextApprovalMode,
  setApprovalModeForProfile,
  syncApprovalModeForProfile
} from '@/store/approval-mode'
import { $gateway } from '@/store/gateway'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'

/**
 * The composer status-area's approval-mode indicator (R5): the current GLOBAL
 * `approvals.mode` for the active profile, rendered as a pill in the controls
 * row beside the model picker. Click cycles manual → smart → off; Shift+Tab
 * cycles through the shared keybind layer — the pill's tooltip surfaces that
 * chord via TipKeybindLabel so the two doors read as one control.
 *
 * SCOPE HONESTY (B13): the mode is a profile-level config key that every
 * session, the CLI, and cron obey. Every label and aria-string here comes from
 * `t.shell.approvalMode` — the same copy the statusbar menu uses — none of
 * which claims per-session scope.
 */
export function ApprovalModePill({ disabled = false }: { disabled?: boolean }) {
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const gateway = useStore($gateway)
  const profile = normalizeProfileKey(useStore($activeGatewayProfile))
  const modes = useStore($approvalModes)
  const mode = modes[profile] ?? 'smart'

  // Same sync contract as the statusbar menu: pull the authoritative value on
  // mount and on profile change, so the pill never shows a stale cache.
  useEffect(() => {
    if (!gateway) {
      return
    }

    void syncApprovalModeForProfile((method, params) => gateway.request(method, params), profile).catch(
      () => undefined
    )
  }, [gateway, profile])

  const labels = { manual: copy.manual, off: copy.off, smart: copy.smart } as const
  const label = labels[mode]

  const cycle = () => {
    if (!gateway) {
      return
    }

    void setApprovalModeForProfile((method, params) => gateway.request(method, params), profile, nextApprovalMode(mode)).catch(
      () => undefined
    )
  }

  return (
    <Tip
      label={
        <span className="grid gap-1">
          <span>
            {copy.title} · {label} — {copy[`${mode}Description`]}
          </span>
          <TipKeybindLabel actionId="composer.approvalMode" text={copy.title} />
        </span>
      }
    >
      <button
        aria-label={copy.ariaLabel(label)}
        className={cn(
          'flex h-(--composer-control-size) shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[0.6875rem] font-medium transition-colors',
          mode === 'off'
            ? 'bg-(--chrome-action-hover) text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
        disabled={disabled || !gateway}
        onClick={cycle}
        type="button"
      >
        {mode === 'off' ? <ZapFilled className="size-3" /> : <Zap className="size-3 opacity-70" />}
        <span className="max-w-16 truncate">{label}</span>
      </button>
    </Tip>
  )
}
