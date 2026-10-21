import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { X } from '@/lib/icons'
import type { SubmodelListEntry, SubmodelProfile } from '@/store/submodels'

// Editor form for one submodel profile. Purely controlled (value + onChange)
// so the settings page's edit dialog and the conversational wizard's
// draft-confirm step render the exact same fields — the wizard prefills the
// draft and the user fine-tunes before `submodels.save` fires.
//
// Number-ish fields (max turns, temperature) ride as strings while editing and
// are parsed by `profileFromEditorValue`, mirroring custom-endpoints-settings.

export interface SubmodelEditorValue {
  description: string
  enabled: boolean
  id: string
  maxIterations: string
  model: string
  name: string
  providerApiKey: string
  providerApiMode: string
  providerBaseUrl: string
  systemPromptExtra: string
  temperature: string
  toolsets: string[]
}

export const EMPTY_SUBMODEL_EDITOR: SubmodelEditorValue = {
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

export function editorValueFromProfile(profile: Partial<SubmodelListEntry> | SubmodelTemplateLike): SubmodelEditorValue {
  return {
    description: profile.description ?? '',
    enabled: profile.enabled !== false,
    id: profile.id ?? '',
    maxIterations: profile.max_iterations != null ? String(profile.max_iterations) : '',
    model: profile.model ?? '',
    name: profile.name ?? '',
    providerApiKey: profile.provider?.api_key ?? '',
    providerApiMode: profile.provider?.api_mode ?? '',
    providerBaseUrl: profile.provider?.base_url ?? '',
    systemPromptExtra: profile.system_prompt_extra ?? '',
    temperature: profile.params?.temperature != null ? String(profile.params.temperature) : '',
    toolsets: [...(profile.toolsets ?? [])]
  }
}

// Structural twin of SubmodelProfile for template/draft objects whose exact
// typing arrives as `Record<string, unknown>` over the wire.
export interface SubmodelTemplateLike {
  description?: string
  enabled?: boolean
  id?: string
  max_iterations?: number
  model?: string
  name?: string
  params?: { temperature?: number } | null
  provider?: { api_key?: string; api_mode?: string; base_url?: string } | null
  system_prompt_extra?: string
  toolsets?: string[]
}

export function profileFromEditorValue(value: SubmodelEditorValue): SubmodelProfile {
  const maxIterations = Number.parseInt(value.maxIterations, 10)
  const temperature = Number.parseFloat(value.temperature)

  const provider: SubmodelProfile['provider'] =
    value.providerBaseUrl.trim() || value.providerApiKey.trim() || value.providerApiMode.trim()
      ? {
          api_key: value.providerApiKey.trim() || undefined,
          api_mode: value.providerApiMode.trim() || undefined,
          base_url: value.providerBaseUrl.trim() || undefined
        }
      : undefined

  return {
    description: value.description.trim(),
    enabled: value.enabled,
    id: value.id.trim(),
    max_iterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : undefined,
    model: value.model.trim(),
    name: value.name.trim(),
    params: Number.isFinite(temperature) ? { temperature } : undefined,
    provider,
    system_prompt_extra: value.systemPromptExtra,
    toolsets: value.toolsets
  }
}

/** Minimal `provider:model` shape check — the server re-validates. */
export function looksLikeProviderModel(model: string): boolean {
  const trimmed = model.trim()

  return !trimmed || (trimmed.includes(':') && trimmed.split(':')[0].trim().length > 0)
}

export function canSaveEditorValue(value: SubmodelEditorValue): boolean {
  return Boolean(value.id.trim() && value.name.trim() && looksLikeProviderModel(value.model))
}

export function SubmodelEditorForm({
  knownToolsets,
  onChange,
  value
}: {
  knownToolsets: string[]
  onChange: (next: SubmodelEditorValue) => void
  value: SubmodelEditorValue
}) {
  const { t } = useI18n()
  const m = t.settings.submodels
  // Uncommitted toolset input — local to the form; Enter adds the chip.
  const [toolsetDraft, setToolsetDraft] = useState('')

  const patch = (partial: Partial<SubmodelEditorValue>) => onChange({ ...value, ...partial })

  const addToolset = (raw: string) => {
    const name = raw.trim()

    if (!name || value.toolsets.includes(name)) {
      return
    }

    patch({ toolsets: [...value.toolsets, name] })
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {m.fieldId}
          <Input
            onChange={event => patch({ id: event.target.value })}
            placeholder="code-reviewer"
            value={value.id}
          />
          <span className="text-[0.65rem] leading-snug">{m.fieldIdHint}</span>
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {m.fieldName}
          <Input onChange={event => patch({ name: event.target.value })} value={value.name} />
        </label>
      </div>

      <label className="grid gap-1.5 text-xs text-muted-foreground">
        {m.fieldDescription}
        <Textarea
          className="min-h-16"
          onChange={event => patch({ description: event.target.value })}
          value={value.description}
        />
        <span className="text-[0.65rem] leading-snug">{m.fieldDescriptionHint}</span>
      </label>

      <div className="grid gap-1.5 text-xs text-muted-foreground">
        {m.fieldToolsets}
        {value.toolsets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.toolsets.map(toolset => (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-(--ui-bg-tertiary) px-2 py-0.5 text-[0.7rem] text-foreground"
                key={toolset}
              >
                {toolset}
                <button
                  aria-label={`${m.toolsetRemove}: ${toolset}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => patch({ toolsets: value.toolsets.filter(entry => entry !== toolset) })}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <Input
          list="submodel-toolset-options"
          onChange={event => setToolsetDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addToolset(toolsetDraft)
              setToolsetDraft('')
            }
          }}
          placeholder={m.toolsetAdd}
          value={toolsetDraft}
        />
        <datalist id="submodel-toolset-options">
          {knownToolsets.map(toolset => (
            <option key={toolset} value={toolset} />
          ))}
        </datalist>
        <span className="text-[0.65rem] leading-snug">{m.fieldToolsetsHint}</span>
      </div>

      <label className="grid gap-1.5 text-xs text-muted-foreground">
        {m.fieldModel}
        <Input
          onChange={event => patch({ model: event.target.value })}
          placeholder="provider:model"
          value={value.model}
        />
        <span className="text-[0.65rem] leading-snug">{m.fieldModelHint}</span>
      </label>

      <div className="grid gap-1.5 text-xs text-muted-foreground">
        {m.providerHeading}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            {m.fieldBaseUrl}
            <Input
              onChange={event => patch({ providerBaseUrl: event.target.value })}
              placeholder="https://…/v1"
              value={value.providerBaseUrl}
            />
          </label>
          <label className="grid gap-1.5">
            {m.fieldApiMode}
            <Input
              onChange={event => patch({ providerApiMode: event.target.value })}
              placeholder="openai-completions"
              value={value.providerApiMode}
            />
          </label>
        </div>
        <label className="grid gap-1.5">
          {m.fieldApiKey}
          <Input
            onChange={event => patch({ providerApiKey: event.target.value })}
            placeholder={m.fieldApiKeyHint}
            type="password"
            value={value.providerApiKey}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {m.fieldMaxIterations}
          <Input
            inputMode="numeric"
            onChange={event => patch({ maxIterations: event.target.value })}
            placeholder="12"
            value={value.maxIterations}
          />
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {m.fieldTemperature}
          <Input
            inputMode="decimal"
            onChange={event => patch({ temperature: event.target.value })}
            placeholder="0.3"
            step="0.1"
            type="number"
            value={value.temperature}
          />
        </label>
      </div>

      <label className="grid gap-1.5 text-xs text-muted-foreground">
        {m.fieldSystemPromptExtra}
        <Textarea
          className="min-h-16"
          onChange={event => patch({ systemPromptExtra: event.target.value })}
          value={value.systemPromptExtra}
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={value.enabled} onCheckedChange={checked => patch({ enabled: checked })} />
        {m.fieldEnabled}
      </label>
    </div>
  )
}
