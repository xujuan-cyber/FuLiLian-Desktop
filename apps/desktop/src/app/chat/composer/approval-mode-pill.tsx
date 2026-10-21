import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { Tip, TipKeybindLabel } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { ShieldCheck } from '@/lib/icons'
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
 * The composer's permission chip (R5): the current GLOBAL `approvals.mode` for
 * the active profile, rendered in the control row's LEFT zone beside the attach
 * (`+`) button — v3 §8.5's `[+] [只读 · 取证]` slot. Click cycles
 * manual → smart → off; Shift+Tab cycles through the shared keybind layer — the
 * chip's tooltip surfaces that chord via TipKeybindLabel so the two doors read
 * as one control.
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
        // v3 §8.5 left zone: the permission chip — 26px, radius 6, shield 13 +
        // label 12. It stays a plain toggle: click cycles, Shift+Tab cycles
        // through the shared keybind layer, and the tooltip carries both.
        className={cn(
          'flex h-[26px] shrink-0 cursor-pointer items-center gap-1 rounded-md border border-transparent px-1.5 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--v3-line-strong)',
          mode === 'off'
            ? 'bg-(--v3-hover) text-(--v3-ink)'
            : 'text-(--v3-ink-2) hover:bg-(--v3-hover) hover:text-(--v3-ink)'
        )}
        disabled={disabled || !gateway}
        onClick={cycle}
        type="button"
      >
        <ShieldCheck className="size-[13px] shrink-0" />
        <span className="max-w-16 truncate">{label}</span>
      </button>
    </Tip>
  )
}
