import { getActionStatus, runSecurityAudit } from '@/fulilian'
import { translateNow } from '@/i18n'
import { notify, notifyError } from '@/store/notifications'

// Poll window mirrors store/system-actions.ts: ~36s of 1.2s ticks before
// giving up on the tail. The spawn keeps running server-side either way.
const POLL_ATTEMPTS = 30
const POLL_INTERVAL_MS = 1200
const STATUS_TIMEOUT_S = 180

/**
 * Palette 「导出审计」 action (step 16 · T8, 方案 §3-T8 动作区) — honest
 * landing: the audit-store EXPORT has no data layer this round (the Settings
 * audit row renders disabled buttons for exactly that reason), so the palette
 * runs the REAL ops action that exists today — `fulilian security-audit` via
 * `runSecurityAudit` — and tails it to completion like the maintenance panel
 * does. Self-contained, never rejects, safe behind a plain `void`.
 */
export async function runSecurityAuditFromPalette(): Promise<void> {
  const title = translateNow('commandCenter.maintenance.securityAudit')

  try {
    const started = await runSecurityAudit()

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

      const status = await getActionStatus(started.name, STATUS_TIMEOUT_S)

      if (status.running) {
        continue
      }

      if (status.exit_code != null && status.exit_code !== 0) {
        throw new Error(status.lines.at(-1) || title)
      }

      notify({ kind: 'success', message: translateNow('commandCenter.actionDone'), title })

      return
    }
  } catch (err) {
    notifyError(err, `${title}: ${translateNow('commandCenter.actionFailed')}`)
  }
}
