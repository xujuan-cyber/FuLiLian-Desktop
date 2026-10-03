import { useI18n } from '@/i18n'
import { Terminal } from '@/lib/icons'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { ListRow, SectionHeading, SettingsContent, SettingsSkeleton } from './primitives'
import { useConfigDraft } from './use-config-draft'

export const CTF_FLAG_REGEX_KEY = 'ctf.flag_regex'
export const CTF_FLAG_REGEX_DEFAULT = 'flag\\{[^}]+\\}'

export const CTF_DEFAULT_TIMEZONE_KEY = 'ctf.default_timezone'
export const CTF_DEFAULT_TIMEZONE_DEFAULT = 'UTC'

export const CTF_SUBMIT_RETRY_LIMIT_KEY = 'ctf.submit_retry_limit'
export const CTF_SUBMIT_RETRY_LIMIT_DEFAULT = 3

export function CtfSettings() {
  const { t } = useI18n()
  const s = t.settings.group.ctf
  const { failed, ready, refetch, update, value } = useConfigDraft()

  if (failed) {
    return (
      <SettingsContent>
        <SectionHeading icon={Terminal} title={s.title} />
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

  const retryLimit = value<number>(CTF_SUBMIT_RETRY_LIMIT_KEY, CTF_SUBMIT_RETRY_LIMIT_DEFAULT)

  return (
    <SettingsContent>
      <SectionHeading icon={Terminal} title={s.title} />
      <p className="mb-2 max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {s.intro}
      </p>

      <ListRow
        action={
          <Input
            aria-label={s.flagRegex}
            className="w-64 font-mono"
            onChange={event => update(CTF_FLAG_REGEX_KEY, event.target.value)}
            placeholder={CTF_FLAG_REGEX_DEFAULT}
            spellCheck={false}
            value={value<string>(CTF_FLAG_REGEX_KEY, CTF_FLAG_REGEX_DEFAULT)}
          />
        }
        description={s.flagRegexDesc}
        title={s.flagRegex}
      />

      <ListRow
        action={
          <Input
            aria-label={s.defaultTimezone}
            className="w-44 font-mono"
            onChange={event => update(CTF_DEFAULT_TIMEZONE_KEY, event.target.value)}
            placeholder={CTF_DEFAULT_TIMEZONE_DEFAULT}
            spellCheck={false}
            value={value<string>(CTF_DEFAULT_TIMEZONE_KEY, CTF_DEFAULT_TIMEZONE_DEFAULT)}
          />
        }
        description={s.defaultTimezoneDesc}
        title={s.defaultTimezone}
      />

      <ListRow
        action={
          <Input
            aria-label={s.submitRetryLimit}
            className="w-20"
            inputMode="numeric"
            min={0}
            onChange={event => {
              const next = Number(event.target.value)

              if (!Number.isNaN(next)) {
                update(CTF_SUBMIT_RETRY_LIMIT_KEY, next)
              }
            }}
            type="number"
            value={String(retryLimit)}
          />
        }
        description={s.submitRetryLimitDesc}
        title={s.submitRetryLimit}
      />
    </SettingsContent>
  )
}
