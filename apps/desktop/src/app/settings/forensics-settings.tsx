import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { FileText } from '@/lib/icons'

import { ListRow, SectionHeading, SettingsContent, SettingsSkeleton, ToggleRow } from './primitives'
import { useConfigDraft } from './use-config-draft'

export const CASE_NO_TEMPLATE_KEY = 'forensics.case_no_template'
export const CASE_NO_TEMPLATE_DEFAULT = 'CASE-YYYY-NNN'

export const REPORT_SECTIONS_KEY = 'forensics.report_sections'
export const REPORT_SECTIONS: readonly { id: string }[] = [
  { id: 'overview' },
  { id: 'evidence' },
  { id: 'analysis' },
  { id: 'conclusion' },
  { id: 'appendix' }
]
export const REPORT_SECTIONS_DEFAULT = REPORT_SECTIONS.map(section => section.id)

export const TIMELINE_SOURCES_KEY = 'forensics.timeline_sources'
export const TIMELINE_SOURCES: readonly { id: string }[] = [{ id: 'mirror' }, { id: 'logs' }, { id: 'pcap' }]
export const TIMELINE_SOURCES_DEFAULT = TIMELINE_SOURCES.map(source => source.id)

export function ForensicsSettings() {
  const { t } = useI18n()
  const s = t.settings.group.forensics
  const { failed, ready, refetch, update, value } = useConfigDraft()

  if (failed) {
    return (
      <SettingsContent>
        <SectionHeading icon={FileText} title={s.title} />
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

  const sections = value<string[]>(REPORT_SECTIONS_KEY, REPORT_SECTIONS_DEFAULT)
  const sources = value<string[]>(TIMELINE_SOURCES_KEY, TIMELINE_SOURCES_DEFAULT)

  const toggleInList = (list: string[], id: string) =>
    list.includes(id) ? list.filter(entry => entry !== id) : [...list, id]

  return (
    <SettingsContent>
      <SectionHeading icon={FileText} title={s.title} />
      <p className="mb-2 max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {s.intro}
      </p>

      <ListRow
        action={
          <Input
            aria-label={s.caseNoTemplate}
            className="w-56 font-mono"
            onChange={event => update(CASE_NO_TEMPLATE_KEY, event.target.value)}
            placeholder={CASE_NO_TEMPLATE_DEFAULT}
            spellCheck={false}
            value={value<string>(CASE_NO_TEMPLATE_KEY, CASE_NO_TEMPLATE_DEFAULT)}
          />
        }
        description={s.caseNoTemplateDesc}
        title={s.caseNoTemplate}
      />

      {/* Report section template: the checkbox structure only. Draft
          generation itself is P2 scope (方案 §1 不做清单) — stated plainly
          instead of a dead "generate" button. */}
      <ListRow
        below={
          <div className="mt-3 grid gap-1">
            {REPORT_SECTIONS.map(section => (
              <ToggleRow
                checked={sections.includes(section.id)}
                description={s.reportSectionDescs[section.id]}
                key={section.id}
                label={s.reportSectionNames[section.id]}
                onChange={() => update(REPORT_SECTIONS_KEY, toggleInList(sections, section.id))}
              />
            ))}
          </div>
        }
        description={s.reportSectionsDesc}
        title={s.reportSections}
        wide
      />

      <ListRow
        below={
          <div className="mt-3 grid gap-1">
            {TIMELINE_SOURCES.map(source => (
              <ToggleRow
                checked={sources.includes(source.id)}
                description={s.timelineSourceDescs[source.id]}
                key={source.id}
                label={s.timelineSourceNames[source.id]}
                onChange={() => update(TIMELINE_SOURCES_KEY, toggleInList(sources, source.id))}
              />
            ))}
          </div>
        }
        description={s.timelineSourcesDesc}
        title={s.timelineSources}
        wide
      />
    </SettingsContent>
  )
}
