import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  preventCloseButtonAutoFocus
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import {
  Download,
  Loader2,
  MessageQuestion,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  Users
} from '@/lib/icons'
import { confirm } from '@/store/confirm'
import { notify, notifyError } from '@/store/notifications'
import {
  deleteSubmodel,
  listSubmodels,
  listSubmodelTemplates,
  saveSubmodel,
  type SubmodelListEntry,
  type SubmodelProfile,
  type SubmodelTemplate
} from '@/store/submodels'

import { EmptyState, Pill, SectionHeading, SettingsContent, SettingsSkeleton } from './primitives'
import {
  canSaveEditorValue,
  editorValueFromProfile,
  profileFromEditorValue,
  SubmodelEditorForm,
  type SubmodelEditorValue
} from './submodel-editor-form'
import { SubmodelWizard } from './submodel-wizard'

// Submodel management page (step 21 · F1). List + create/edit/delete +
// import/export, with three creation paths: template, blank form, and the
// conversational wizard. Skeleton follows custom-endpoints-settings.

// The server masks provider.api_key in list responses (write-only secret);
// a masked echo must never ride back into a save or it would overwrite the
// real key with the mask. Stripped before every payload we send.
function isMaskedApiKey(key: unknown): boolean {
  if (typeof key !== 'string') {
    return false
  }

  return /^\*+$/.test(key) || /^\S{4}…\S{4}$/.test(key)
}

function stripVerdictFields(entry: SubmodelListEntry): SubmodelProfile {
  const { errors: _errors, valid: _valid, ...profile } = entry

  return profile
}

function exportableProfiles(profiles: SubmodelListEntry[]): SubmodelProfile[] {
  return profiles.map(profile => {
    const clean = stripVerdictFields(profile)

    if (clean.provider && isMaskedApiKey(clean.provider.api_key)) {
      clean.provider = { ...clean.provider, api_key: undefined }
    }

    return clean
  })
}

export function SubmodelsSettings() {
  const { t } = useI18n()
  const m = t.settings.submodels

  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [profiles, setProfiles] = useState<SubmodelListEntry[]>([])
  const [templates, setTemplates] = useState<SubmodelTemplate[]>([])

  const [deleting, setDeleting] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  const [editor, setEditor] = useState<{ hadApiKey: boolean; value: SubmodelEditorValue } | null>(null)
  const [saving, setSaving] = useState(false)

  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [wizard, setWizard] = useState<{ profile: SubmodelListEntry | null } | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [list, tpl] = await Promise.all([listSubmodels(), listSubmodelTemplates()])

        if (!cancelled) {
          setProfiles(list)
          setTemplates(tpl)
          setLoadFailed(false)
        }
      } catch {
        if (!cancelled) {
          setLoadFailed(true)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [refreshToken])

  const refresh = async () => {
    try {
      setProfiles(await listSubmodels())
    } catch (err) {
      notifyError(err, m.loadFailed)
    }
  }

  // Toolset suggestions: the union across known profiles and built-in
  // templates. There is no full-registry RPC, so the input stays free-text
  // (noted in the field hint) for custom/MCP toolset names.
  const knownToolsets = useMemo(() => {
    const names = new Set<string>()

    for (const profile of profiles) {
      for (const toolset of profile.toolsets ?? []) {
        names.add(toolset)
      }
    }

    for (const template of templates) {
      for (const toolset of template.toolsets ?? []) {
        names.add(toolset)
      }
    }

    return [...names].sort()
  }, [profiles, templates])

  const takenIds = useMemo(() => profiles.map(profile => profile.id), [profiles])

  const openEditor = (value: SubmodelEditorValue, hadApiKey = false) => {
    setEditor({ hadApiKey, value })
  }

  const openEditProfile = (profile: SubmodelListEntry) => {
    const hadApiKey = Boolean(profile.provider?.api_key)
    const value = editorValueFromProfile(profile)

    // Never echo even the masked key into the field — blank starts the edit.
    value.providerApiKey = ''
    openEditor(value, hadApiKey)
  }

  const startFromTemplate = (template: SubmodelTemplate) => {
    setTemplatesOpen(false)
    const value = editorValueFromProfile(template)
    value.id = template.id.replace(/^tpl-/, '')
    openEditor(value, false)
  }

  const saveEditor = async () => {
    if (!editor || saving) {
      return
    }

    const entry = profileFromEditorValue(editor.value)

    if (entry.provider && isMaskedApiKey(entry.provider.api_key)) {
      entry.provider.api_key = undefined
    }

    // Stored keys cannot be read back; saving an edited profile without a
    // re-entered key drops the provider auth. Make that explicit.
    if (editor.hadApiKey && !entry.provider?.api_key) {
      const ok = await confirm({
        confirmLabel: t.common.confirm,
        description: m.providerKeyLostDesc,
        title: m.providerKeyLostTitle
      })

      if (!ok) {
        return
      }
    }

    setSaving(true)

    try {
      await saveSubmodel(entry)
      notify({ kind: 'success', message: m.saved })
      triggerHaptic('success')
      setEditor(null)
      await refresh()
    } catch (err) {
      notifyError(err, m.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (profile: SubmodelListEntry) => {
    setToggling(profile.id)

    try {
      const entry = stripVerdictFields(profile)

      if (entry.provider && isMaskedApiKey(entry.provider.api_key)) {
        entry.provider.api_key = undefined
        notify({ kind: 'warning', message: m.maskedKeyWarning })
      }

      await saveSubmodel({ ...entry, enabled: !profile.enabled })
      await refresh()
    } catch (err) {
      notifyError(err, m.saveFailed)
    } finally {
      setToggling(null)
    }
  }

  const removeProfile = async (profile: SubmodelListEntry) => {
    if (!(await confirm({ confirmLabel: t.common.delete, destructive: true, title: m.deleteTitle(profile.name) }))) {
      return
    }

    setDeleting(profile.id)

    try {
      await deleteSubmodel(profile.id)
      triggerHaptic('success')
      await refresh()
    } catch (err) {
      notifyError(err, m.deleteFailed)
    } finally {
      setDeleting(null)
    }
  }

  const exportProfiles = () => {
    try {
      const blob = new Blob([JSON.stringify(exportableProfiles(profiles), null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'fulilian-submodels.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      notifyError(err, m.exportFailed)
    }
  }

  const applyImport = async () => {
    if (importing) {
      return
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(importText)
    } catch {
      notify({ kind: 'warning', message: m.importInvalid })

      return
    }

    const entries = Array.isArray(parsed) ? parsed : [parsed]

    const objects = entries.filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
    )

    if (objects.length === 0) {
      notify({ kind: 'warning', message: m.importInvalid })

      return
    }

    setImporting(true)

    try {
      let imported = 0

      for (const object of objects) {
        try {
          await saveSubmodel(object as unknown as SubmodelProfile)
          imported += 1
        } catch {
          // One bad entry must not abort the batch; count and continue.
        }
      }

      notify({ kind: imported > 0 ? 'success' : 'warning', message: m.importDone(imported) })
      setImportOpen(false)
      setImportText('')
      await refresh()
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return <SettingsSkeleton sections={[{ heading: true, rows: 3 }]} />
  }

  if (loadFailed) {
    return (
      <SettingsContent>
        <EmptyState description={m.loadFailed} title={m.title} />
        <div className="flex justify-center">
          <Button onClick={() => setRefreshToken(token => token + 1)} variant="outline">
            {t.common.retry}
          </Button>
        </div>
      </SettingsContent>
    )
  }

  return (
    <SettingsContent>
      <div className="space-y-6">
        <section>
          <SectionHeading
            aside={
              // Five controls ride the heading row; `flex-wrap` keeps them from
              // pushing past the pane's right edge on narrow windows (P2-9).
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button onClick={() => setImportOpen(true)} size="icon-sm" title={m.importLabel} variant="ghost">
                  <Upload />
                </Button>
                <Button
                  disabled={profiles.length === 0}
                  onClick={exportProfiles}
                  size="icon-sm"
                  title={m.exportLabel}
                  variant="ghost"
                >
                  <Download />
                </Button>
                <Button onClick={() => setWizard({ profile: null })} size="sm" variant="outline">
                  <MessageQuestion />
                  {m.newViaChat}
                </Button>
                <Button onClick={() => setTemplatesOpen(true)} size="sm" variant="outline">
                  <Users />
                  {m.newFromTemplate}
                </Button>
                <Button onClick={() => openEditor({ ...EMPTY_EDITOR })} size="sm">
                  <Plus />
                  {m.newBlank}
                </Button>
              </div>
            }
            icon={Users}
            meta={`${profiles.length}`}
            title={m.title}
          />
          <p className="mb-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{m.intro}</p>

          <div className="divide-y divide-border/40 rounded-md border border-border/50">
            {profiles.length ? (
              profiles.map(profile => (
                <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={profile.id}>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{profile.name}</span>
                      <Pill tone={profile.enabled === false ? 'muted' : 'primary'}>
                        {profile.enabled === false ? m.fieldEnabledOff : m.fieldEnabledOn}
                      </Pill>
                      {profile.valid === false && <Pill tone="warn">{m.invalidPill}</Pill>}
                    </div>
                    {profile.description && (
                      <div className="mt-1 line-clamp-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                        {profile.description}
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono text-[0.7rem]">{profile.model || m.inheritModel}</span>
                      {(profile.toolsets?.length ?? 0) > 0 && <span>{profile.toolsets?.join(', ')}</span>}
                    </div>
                    {profile.valid === false && (profile.errors?.length ?? 0) > 0 && (
                      <div className="mt-1 text-[0.65rem] text-destructive">{m.invalidHint} {profile.errors?.join('; ')}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <Button
                      onClick={() => setWizard({ profile })}
                      size="icon-sm"
                      title={m.refineWithAi}
                      variant="ghost"
                    >
                      <MessageQuestion />
                    </Button>
                    <Button onClick={() => openEditProfile(profile)} size="icon-sm" title={m.edit} variant="ghost">
                      <Pencil />
                    </Button>
                    <Button
                      className="hover:text-destructive"
                      disabled={deleting === profile.id}
                      onClick={() => void removeProfile(profile)}
                      size="icon-sm"
                      title={t.common.delete}
                      variant="ghost"
                    >
                      {deleting === profile.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState description={m.emptyDesc} title={m.emptyTitle} />
            )}
          </div>
        </section>
      </div>

      {/* Template picker */}
      <Dialog onOpenChange={setTemplatesOpen} open={templatesOpen}>
        <DialogContent className="max-w-lg" onOpenAutoFocus={preventCloseButtonAutoFocus}>
          <DialogHeader>
            <DialogTitle>{m.templatesTitle}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {templates.map(template => (
              <button
                className="rounded-lg border border-(--ui-stroke-tertiary) px-3 py-2 text-left transition-colors hover:bg-(--ui-bg-tertiary)"
                key={template.id}
                onClick={() => startFromTemplate(template)}
                type="button"
              >
                <div className="text-sm font-medium text-foreground">{template.name}</div>
                <div className="mt-0.5 line-clamp-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                  {template.description}
                </div>
              </button>
            ))}
            {templates.length === 0 && (
              <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                {m.templatesUnavailable}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Editor */}
      <Dialog onOpenChange={next => !next && setEditor(null)} open={editor !== null}>
        <DialogContent bodyClassName="dt-portal-scrollbar" className="max-w-2xl" onOpenAutoFocus={preventCloseButtonAutoFocus}>
          <DialogHeader>
            <DialogTitle>{editor?.value.id ? m.editorTitleEdit(editor.value.name || editor.value.id) : m.editorTitleNew}</DialogTitle>
          </DialogHeader>
          {editor && (
            <SubmodelEditorForm knownToolsets={knownToolsets} onChange={value => setEditor({ ...editor, value })} value={editor.value} />
          )}
          <DialogFooter>
            <Button onClick={() => setEditor(null)} variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={!editor || !canSaveEditorValue(editor.value) || saving} onClick={() => void saveEditor()}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import */}
      <Dialog onOpenChange={setImportOpen} open={importOpen}>
        <DialogContent className="max-w-lg" onOpenAutoFocus={preventCloseButtonAutoFocus}>
          <DialogHeader>
            <DialogTitle>{m.importTitle}</DialogTitle>
            <DialogDescription>{m.importDesc}</DialogDescription>
          </DialogHeader>
          <Textarea
            className="min-h-40 font-mono text-[0.7rem]"
            onChange={event => setImportText(event.target.value)}
            value={importText}
          />
          <DialogFooter>
            <Button onClick={() => setImportOpen(false)} variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={importing || !importText.trim()} onClick={() => void applyImport()}>
              {importing ? <Loader2 className="animate-spin" /> : <Upload />}
              {m.importApply}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conversational wizard — mounted only while open so its state
          re-initializes per session. */}
      {wizard && (
        <SubmodelWizard
          existingProfile={wizard.profile}
          knownToolsets={knownToolsets}
          onOpenChange={open => {
            if (!open) {
              setWizard(null)
            }
          }}
          onSaved={() => {
            void refresh()
          }}
          takenIds={takenIds}
        />
      )}
    </SettingsContent>
  )
}

const EMPTY_EDITOR: SubmodelEditorValue = {
  description: '',
  enabled: true,
  id: '',
  maxIterations: '',
  model: '',
  name: '',
  providerApiKey: '',
  providerApiMode: '',
  providerBaseUrl: '',
  systemPromptExtra: '',
  temperature: '',
  toolsets: []
}
