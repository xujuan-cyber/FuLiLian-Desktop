import { useEffect, useRef, useState } from 'react'

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
import { Loader2, Send } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import {
  saveSubmodel,
  type SubmodelListEntry,
  type SubmodelWizardMessage,
  submodelWizardTurn
} from '@/store/submodels'

import {
  canSaveEditorValue,
  editorValueFromProfile,
  profileFromEditorValue,
  SubmodelEditorForm,
  type SubmodelEditorValue,
  type SubmodelTemplateLike
} from './submodel-editor-form'

// Conversational setup wizard (D3: in-settings Dialog). The frontend owns the
// full conversation history — the backend's `submodels.wizard_turn` is a
// stateless one-shot call whose LAST message must have role 'user'. A response
// without a draft means "keep talking"; a draft switches the dialog into the
// shared draft form for fine-tuning before `submodels.save`. Cancelling at any
// point persists nothing.
//
// The parent mounts this component only while it is open, so state
// initialization below doubles as the per-open reset (no reset effect needed).

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'submodel'
}

function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) {
    return base
  }

  for (let n = 2; ; n += 1) {
    if (!taken.includes(`${base}-${n}`)) {
      return `${base}-${n}`
    }
  }
}

function editorValueFromDraft(draft: Record<string, unknown>, takenIds: string[]): SubmodelEditorValue {
  const value = editorValueFromProfile(draft as SubmodelTemplateLike)

  if (!value.id.trim()) {
    value.id = uniqueId(slugify(value.name || 'submodel'), takenIds)
  }

  return value
}

export function SubmodelWizard({
  existingProfile = null,
  knownToolsets,
  onOpenChange,
  onSaved,
  takenIds
}: {
  /** When set, the wizard edits an existing profile: its JSON rides as a
   *  hidden preamble user message so the assistant can modify in place. */
  existingProfile?: SubmodelListEntry | null
  knownToolsets: string[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  takenIds: string[]
}) {
  const { t } = useI18n()
  const m = t.settings.submodels

  const [messages, setMessages] = useState<SubmodelWizardMessage[]>(() => {
    if (!existingProfile) {
      return []
    }

    // Hidden preamble: context the backend sees but the chat surface doesn't
    // render (a raw JSON blob adds nothing to the conversation view).
    const context: Record<string, unknown> = { ...existingProfile }
    delete context.valid
    delete context.errors

    return [{ content: `${m.wizardEditContext}\n${JSON.stringify(context, null, 2)}`, role: 'user' }]
  })

  const hiddenCount = existingProfile ? 1 : 0

  const [draft, setDraft] = useState<SubmodelEditorValue | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement | null>(null)

  const visibleMessages = messages.slice(hiddenCount)

  useEffect(() => {
    const node = chatRef.current

    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [visibleMessages.length, busy])

  const send = async () => {
    const text = input.trim()

    if (!text || busy) {
      return
    }

    const history = [...messages, { content: text, role: 'user' } as const]
    setMessages(history)
    setInput('')
    setBusy(true)
    setError(null)

    try {
      const result = await submodelWizardTurn(history)
      setMessages([...history, { content: result.reply, role: 'assistant' }])

      if (result.draft) {
        setDraft(editorValueFromDraft(result.draft, takenIds))
      }
    } catch {
      setError(m.wizardError)
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = async () => {
    if (!draft || saving) {
      return
    }

    setSaving(true)

    try {
      await saveSubmodel(profileFromEditorValue(draft))
      notify({ kind: 'success', message: m.saved })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      notifyError(err, m.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent bodyClassName="dt-portal-scrollbar" className="max-w-2xl" onOpenAutoFocus={preventCloseButtonAutoFocus}>
        <DialogHeader>
          <DialogTitle>{existingProfile ? m.wizardTitleEdit(existingProfile.name) : m.wizardTitle}</DialogTitle>
          <DialogDescription>{m.wizardIntro}</DialogDescription>
        </DialogHeader>

        {draft === null ? (
          <div className="space-y-3">
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-3" ref={chatRef}>
              {visibleMessages.length === 0 && !busy && (
                <p className="py-4 text-center text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                  {m.wizardPlaceholder}
                </p>
              )}
              {visibleMessages.map((message, index) => (
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg px-3 py-1.5 text-[length:var(--conversation-caption-font-size)] whitespace-pre-wrap',
                    message.role === 'user'
                      ? 'self-end bg-(--ui-accent-secondary) text-(--ui-accent-secondary-foreground)'
                      : 'self-start border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) text-foreground'
                  )}
                  key={`${index}-${message.role}`}
                >
                  {message.content}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 self-start text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                  <Loader2 className="size-3.5 animate-spin" />
                  {m.wizardWorking}
                </div>
              )}
            </div>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[length:var(--conversation-caption-font-size)] text-destructive">
                {error}
              </p>
            )}

            <div className="flex items-end gap-2">
              <Textarea
                className="min-h-10 flex-1"
                disabled={busy}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                placeholder={m.wizardPlaceholder}
                value={input}
              />
              <Button aria-label={m.wizardSend} disabled={busy || !input.trim()} onClick={() => void send()} size="icon">
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded-lg border border-(--ui-accent-secondary)/30 bg-(--ui-accent-secondary)/10 px-3 py-2 text-[length:var(--conversation-caption-font-size)] text-foreground">
              {m.wizardDraftReady}
            </p>
            <SubmodelEditorForm knownToolsets={knownToolsets} onChange={setDraft} value={draft} />
          </div>
        )}

        <DialogFooter>
          {draft !== null && (
            <Button disabled={busy} onClick={() => setDraft(null)} variant="ghost">
              {m.wizardBackToChat}
            </Button>
          )}
          <Button disabled={busy || saving} onClick={() => onOpenChange(false)} variant="outline">
            {t.common.cancel}
          </Button>
          {draft !== null && (
            <Button disabled={!canSaveEditorValue(draft) || saving} onClick={() => void saveDraft()}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {m.wizardSave}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
