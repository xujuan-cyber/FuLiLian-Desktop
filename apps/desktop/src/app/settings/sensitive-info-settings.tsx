import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { EyeOff } from '@/lib/icons'

import { ListRow, SectionHeading, SettingsContent, SettingsSkeleton, ToggleRow } from './primitives'
import { useConfigDraft } from './use-config-draft'

// Redaction of detected secrets rides the EXISTING `security.redact_secrets`
// key (same one the Safety page lists). The flag/custom additions and the
// reveal-audit preference are new keys on the same config channel.
export const REDACT_SECRETS_KEY = 'security.redact_secrets'
export const REDACT_FLAGS_KEY = 'security.redact_flags'
export const REDACT_CUSTOM_REGEX_KEY = 'security.redact_custom_regex'
export const REVEAL_AUDITED_KEY = 'security.reveal_audited'

export function SensitiveInfoSettings() {
  const { t } = useI18n()
  const s = t.security.sensitive
  const { failed, ready, refetch, update, value } = useConfigDraft()

  if (failed) {
    return (
      <SettingsContent>
        <SectionHeading icon={EyeOff} title={s.title} />
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
    return <SettingsSkeleton sections={[{ heading: true, rows: 4 }]} />
  }

  return (
    <SettingsContent>
      <SectionHeading icon={EyeOff} title={s.title} />
      <p className="mb-2 max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {s.intro}
      </p>

      <ToggleRow
        checked={value(REDACT_SECRETS_KEY, true)}
        description={s.redactSecretsDesc}
        label={s.redactSecrets}
        onChange={on => update(REDACT_SECRETS_KEY, on)}
      />
      <ToggleRow
        checked={value(REDACT_FLAGS_KEY, true)}
        description={s.redactFlagsDesc}
        label={s.redactFlags}
        onChange={on => update(REDACT_FLAGS_KEY, on)}
      />
      <ListRow
        action={
          <Input
            aria-label={s.customRegex}
            className="w-64 font-mono"
            onChange={event => update(REDACT_CUSTOM_REGEX_KEY, event.target.value)}
            placeholder={s.customRegexPlaceholder}
            spellCheck={false}
            value={value<string>(REDACT_CUSTOM_REGEX_KEY, '')}
          />
        }
        description={s.customRegexDesc}
        title={s.customRegex}
      />
      <ToggleRow
        checked={value(REVEAL_AUDITED_KEY, true)}
        description={s.revealAuditedDesc}
        label={s.revealAudited}
        onChange={on => update(REVEAL_AUDITED_KEY, on)}
      />
    </SettingsContent>
  )
}
