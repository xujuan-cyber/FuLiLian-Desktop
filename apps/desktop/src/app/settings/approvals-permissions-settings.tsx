import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { CheckCircle2 } from '@/lib/icons'

import { ListRow, SectionHeading, SettingsContent, SettingsSkeleton } from './primitives'
import { useConfigDraft } from './use-config-draft'

export const APPROVALS_MODE_KEY = 'approvals.mode'

// Canonical modes (fulilian_cli/approval_mode.py VALID_APPROVAL_MODES). The
// mode row is the same config.yaml key the Safety page edits — a second entry
// point per DESIGN_PROPOSAL §5.5, not a second source of truth.
export const APPROVALS_MODE_OPTIONS = ['manual', 'smart', 'off'] as const

export const HIGH_RISK_COMMANDS_KEY = 'security.high_risk_commands'

// Guardrail defaults (DESIGN_PROPOSAL §4.4): the list is configuration for the
// future interception layer (P1 行为面, not built this round) — no bypass path
// lives in this page.
export const HIGH_RISK_COMMANDS_DEFAULT = ['rm -rf', 'dd', 'mkfs', 'shred']

export function ApprovalsPermissionsSettings() {
  const { t } = useI18n()
  const s = t.security.approvals
  const { failed, ready, refetch, update, value } = useConfigDraft()

  if (failed) {
    return (
      <SettingsContent>
        <SectionHeading icon={CheckCircle2} title={s.title} />
        <ListRow
          action={
            <Button onClick={refetch} size="sm">
              {t.skills.refresh}
            </Button>
          }
          description={t.settings.config.failedLoad}
          title={s.title}
        />
      </SettingsContent>
    )
  }

  if (!ready) {
    return <SettingsSkeleton sections={[{ heading: true, rows: 3 }]} />
  }

  const mode = value<string>(APPROVALS_MODE_KEY, '')
  const highRisk = value<string[]>(HIGH_RISK_COMMANDS_KEY, HIGH_RISK_COMMANDS_DEFAULT)

  return (
    <SettingsContent>
      <SectionHeading icon={CheckCircle2} title={s.title} />
      <p className="mb-2 max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {s.intro}
      </p>

      <ListRow
        action={
          <SegmentedControl
            onChange={next => update(APPROVALS_MODE_KEY, next)}
            options={APPROVALS_MODE_OPTIONS.map(id => ({
              id,
              label: id === 'manual' ? s.modeManual : id === 'smart' ? s.modeSmart : s.modeOff
            }))}
            value={mode}
          />
        }
        description={s.modeDesc}
        title={s.mode}
      />

      {/* 「完全访问」badge: the one orange signal this page may carry
          (DESIGN_PROPOSAL §2 原则 4 whitelist, class 1). */}
      <ListRow
        action={
          mode === 'off' ? (
            <span className="inline-flex items-center rounded-full border border-(--ui-stroke-tertiary) px-2 py-0.5 text-[10.5px] font-semibold text-accent-bright">
              {s.fullAccessBadge}
            </span>
          ) : null
        }
        description={s.fullAccessNote}
        title={s.fullAccessTitle}
      />

      <ListRow
        action={
          <input
            aria-label={s.highRiskCommands}
            className="w-full rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) px-3 py-1.5 font-mono text-[length:var(--conversation-caption-font-size)] outline-none focus:border-(--ui-stroke-secondary)"
            onChange={event =>
              update(
                HIGH_RISK_COMMANDS_KEY,
                event.target.value
                  .split(',')
                  .map(part => part.trim())
                  .filter(Boolean)
              )
            }
            spellCheck={false}
            value={highRisk.join(', ')}
          />
        }
        description={s.highRiskCommandsDesc}
        title={s.highRiskCommands}
        wide
      />
    </SettingsContent>
  )
}
