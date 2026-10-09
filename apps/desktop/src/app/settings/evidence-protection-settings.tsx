import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { FolderOpen } from '@/lib/icons'
import { confirm } from '@/store/confirm'

import { ListRow, SectionHeading, SettingsContent, SettingsSkeleton, ToggleRow } from './primitives'
import { useConfigDraft } from './use-config-draft'

export const EVIDENCE_READONLY_KEY = 'security.evidence_readonly'
export const EVIDENCE_VERIFY_ON_REFERENCE_KEY = 'security.evidence_verify_on_reference'
export const EVIDENCE_ARCHIVE_WRITE_LOCK_KEY = 'security.archive_write_lock'

// Guardrail defaults (DESIGN_PROPOSAL §4.4): all three protections default ON,
// and the read-only mount can never be dropped silently — turning it off goes
// through an explicit confirmation. This page only persists the preferences;
// the enforcement layer (write wrapper / hash re-verify) lands with the data
// layer in a later round.
export const EVIDENCE_GUARDRAIL_DEFAULTS = {
  archiveWriteLock: true,
  readOnly: true,
  verifyOnReference: true
} as const

export function EvidenceProtectionSettings() {
  const { t } = useI18n()
  const s = t.security.evidence
  const { failed, ready, refetch, update, value } = useConfigDraft()

  if (failed) {
    return (
      <SettingsContent>
        <SectionHeading icon={FolderOpen} title={s.title} />
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

  const readOnly = value(EVIDENCE_READONLY_KEY, EVIDENCE_GUARDRAIL_DEFAULTS.readOnly)

  const setReadOnly = (on: boolean) => {
    if (on) {
      update(EVIDENCE_READONLY_KEY, true)

      return
    }

    // Not silently dismissible: dropping a read-only guardrail requires an
    // explicit, destructive-styled confirmation (DESIGN_PROPOSAL §9).
    void confirm({ destructive: true, title: s.disableConfirmTitle }).then(ok => {
      if (ok) {
        update(EVIDENCE_READONLY_KEY, false)
      }
    })
  }

  return (
    <SettingsContent>
      <SectionHeading icon={FolderOpen} title={s.title} />
      <p className="mb-2 max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {s.intro}
      </p>

      <ToggleRow
        checked={readOnly}
        description={s.readOnlyDesc}
        label={s.readOnly}
        onChange={setReadOnly}
      />
      <ToggleRow
        checked={value(EVIDENCE_VERIFY_ON_REFERENCE_KEY, EVIDENCE_GUARDRAIL_DEFAULTS.verifyOnReference)}
        description={s.verifyOnReferenceDesc}
        label={s.verifyOnReference}
        onChange={on => update(EVIDENCE_VERIFY_ON_REFERENCE_KEY, on)}
      />
      <ToggleRow
        checked={value(EVIDENCE_ARCHIVE_WRITE_LOCK_KEY, EVIDENCE_GUARDRAIL_DEFAULTS.archiveWriteLock)}
        description={s.archiveLockDesc}
        label={s.archiveLock}
        onChange={on => update(EVIDENCE_ARCHIVE_WRITE_LOCK_KEY, on)}
      />
    </SettingsContent>
  )
}
