import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { Clock, Download, Trash2 } from '@/lib/icons'

import { ListRow, SectionHeading, SettingsContent, SettingsSkeleton, ToggleRow } from './primitives'
import { useConfigDraft } from './use-config-draft'

export const AUDIT_ENABLED_KEY = 'security.audit_enabled'
export const AUDIT_RETENTION_KEY = 'security.audit_retention_days'

// 0 = keep forever (永久). Default 90 days per DESIGN_PROPOSAL §9.
export const AUDIT_RETENTION_OPTIONS = ['30', '90', '365', '0'] as const
export const AUDIT_RETENTION_DEFAULT = '90'

export function AuditSettings() {
  const { t } = useI18n()
  const s = t.security.audit
  const { failed, ready, refetch, update, value } = useConfigDraft()

  if (failed) {
    return (
      <SettingsContent>
        <SectionHeading icon={Clock} title={s.title} />
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

  const retention = String(value<string>(AUDIT_RETENTION_KEY, AUDIT_RETENTION_DEFAULT))

  return (
    <SettingsContent>
      <SectionHeading icon={Clock} title={s.title} />
      <p className="mb-2 max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {s.intro}
      </p>

      <ToggleRow
        checked={value(AUDIT_ENABLED_KEY, true)}
        description={s.enabledDesc}
        label={s.enabled}
        onChange={on => update(AUDIT_ENABLED_KEY, on)}
      />

      <ListRow
        action={
          <Select
            onValueChange={next => update(AUDIT_RETENTION_KEY, Number(next))}
            value={retention}
          >
            <SelectTrigger aria-label={s.retention} className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIT_RETENTION_OPTIONS.map(option => (
                <SelectItem key={option} value={option}>
                  {option === '0' ? s.retentionPermanent : option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        description={s.retentionDesc}
        title={s.retention}
      />

      {/* Export/clear operate on the audit store, which is data-layer work
          (later round — 方案 §1 不做清单). Honest disabled affordances instead
          of dead buttons that pretend to work. */}
      <ListRow
        action={
          <div className="flex items-center gap-2">
            <Button disabled size="sm" variant="outline">
              <Download className="size-3.5" />
              {s.export}
            </Button>
            <Button disabled size="sm" variant="outline">
              <Trash2 className="size-3.5" />
              {s.clear}
            </Button>
          </div>
        }
        description={s.dataLayerNote}
        title={s.exportTitle}
      />
    </SettingsContent>
  )
}
