import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { LocalFilePreview } from '@/app/chat/right-rail/preview-file'
import { useSessionView } from '@/app/chat/session-view'
import { useI18n } from '@/i18n'
import { MonitorPlay } from '@/lib/icons'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { previewName } from '@/lib/preview-targets'
import { notifyError } from '@/store/notifications'
import { $previewTabSources, closePreviewForSource, openPreview, type PreviewRecordSource } from '@/store/preview'
import type { PreviewTarget } from '@/store/preview'

export function PreviewAttachment({ source = 'manual', target }: { source?: PreviewRecordSource; target: string }) {
  const { t } = useI18n()
  // This link lives in one session's transcript; resolve it against THAT
  // session's cwd, not the primary chat's.
  const cwd = useStore(useSessionView().$cwd)
  const openSources = useStore($previewTabSources)
  const [opening, setOpening] = useState(false)
  // R9 inline preview: click-to-expand, never auto (no-hijack). The target is
  // resolved lazily on first expand — one async stat per EXPANDED card, not
  // per rendered card, so a long transcript pays nothing for folded previews.
  const [inlineOpen, setInlineOpen] = useState(false)
  const [inlineTarget, setInlineTarget] = useState<PreviewTarget | null>(null)
  const [inlineFailed, setInlineFailed] = useState(false)
  const cwdRef = useRef(cwd)
  const mountedRef = useRef(false)
  const requestTokenRef = useRef(0)
  const targetRef = useRef(target)
  const name = previewName(target)
  const isActive = openSources.includes(target)
  const canInline = inlinePreviewCapable(target)

  cwdRef.current = cwd
  targetRef.current = target

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      requestTokenRef.current += 1
    }
  }, [])

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    requestTokenRef.current += 1
    setOpening(false)
    setInlineOpen(false)
    setInlineTarget(null)
    setInlineFailed(false)
  }, [cwd, target])

  async function togglePreview() {
    if (opening) {
      return
    }

    if (isActive) {
      closePreviewForSource(target)

      return
    }

    const requestToken = ++requestTokenRef.current
    const requestTarget = target
    const requestCwd = cwd

    setOpening(true)

    try {
      const preview = await normalizeOrLocalPreviewTarget(requestTarget, requestCwd || undefined)

      if (
        !mountedRef.current ||
        requestTokenRef.current !== requestToken ||
        targetRef.current !== requestTarget ||
        cwdRef.current !== requestCwd
      ) {
        return
      }

      if (!preview) {
        throw new Error(`Could not open preview target: ${requestTarget}`)
      }

      openPreview(preview, source)
    } catch (error) {
      if (
        !mountedRef.current ||
        requestTokenRef.current !== requestToken ||
        targetRef.current !== requestTarget ||
        cwdRef.current !== requestCwd
      ) {
        return
      }

      notifyError(error, t.preview.unavailable)
    } finally {
      if (mountedRef.current && requestTokenRef.current === requestToken) {
        setOpening(false)
      }
    }
  }

  async function toggleInline() {
    if (inlineOpen) {
      setInlineOpen(false)

      return
    }

    setInlineOpen(true)

    if (inlineTarget || inlineFailed) {
      return
    }

    const requestToken = ++requestTokenRef.current

    try {
      const preview = await normalizeOrLocalPreviewTarget(target, cwd || undefined)

      if (!mountedRef.current || requestTokenRef.current !== requestToken || targetRef.current !== target) {
        return
      }

      setInlineTarget(preview)
    } catch {
      if (mountedRef.current && requestTokenRef.current === requestToken) {
        setInlineFailed(true)
      }
    }
  }

  // A resolved target the inline pane honestly can't carry (binary / oversized)
  // degrades to the rail: the expanded area says so and the existing rail
  // button does the opening. No "preview anyway" inside the transcript.
  const inlineUnavailable =
    inlineTarget !== null && (inlineTarget.kind !== 'file' || Boolean(inlineTarget.binary) || Boolean(inlineTarget.large))

  return (
    <div className="flex w-full flex-col items-stretch gap-0">
      <div className="flex w-full max-w-160 items-center gap-2 rounded-lg border border-(--ui-stroke-tertiary) bg-card/55 px-2.5 py-1.5 text-sm">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted/55 text-muted-foreground/85">
          <MonitorPlay className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.78rem] font-medium text-foreground/90" title={target}>
          {name}
        </span>
        {canInline && (
          <button
            aria-expanded={inlineOpen}
            className="shrink-0 rounded-md border border-(--ui-stroke-tertiary) bg-background/40 px-2 py-1 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:bg-accent/55 hover:text-foreground"
            onClick={() => void toggleInline()}
            type="button"
          >
            {t.preview.inlinePreview}
          </button>
        )}
        <button
          className="shrink-0 rounded-md border border-(--ui-stroke-tertiary) bg-background/40 px-2 py-1 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:bg-accent/55 hover:text-foreground disabled:opacity-50"
          disabled={opening}
          onClick={() => void togglePreview()}
          type="button"
        >
          {opening ? t.preview.opening : isActive ? t.preview.hide : t.preview.openPreview}
        </button>
      </div>
      {inlineOpen && (
        // Click-to-expand only: the mount of this region is the user's click,
        // never a stream event. Capped height keeps the transcript scroll owned
        // by the reader; the same shared renderer the right rail consumes paints
        // the content (single render path, two consumers).
        <div className="mt-1 h-80 max-w-160 overflow-hidden rounded-lg border border-(--ui-stroke-tertiary) bg-background/40">
          {inlineFailed ? (
            <InlineUnavailable label={t.preview.unavailable} />
          ) : inlineUnavailable ? (
            <InlineUnavailable actionLabel={t.preview.openPreview} label={t.preview.inlineTooLarge(name)} onOpen={() => void togglePreview()} />
          ) : inlineTarget ? (
            <LocalFilePreview reloadKey={0} target={inlineTarget} />
          ) : null}
        </div>
      )}
    </div>
  )
}

function InlineUnavailable({ actionLabel, label, onOpen }: { actionLabel?: string; label: string; onOpen?: () => void }) {
  return (
    <div className="grid h-full place-items-center px-4 text-center">
      <div className="grid gap-2">
        <div className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {label}
        </div>
        {actionLabel && onOpen && (
          <button
            className="mx-auto rounded-md border border-(--ui-stroke-tertiary) bg-background/60 px-2.5 py-1 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:bg-accent/55 hover:text-foreground"
            onClick={onOpen}
            type="button"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

// U3 first batch: image / markdown / source / html / csv / pdf — exactly the
// shapes `localPreviewTarget` maps to image/text/html/pdf. Office binary
// containers and archives have no inline render path and stay OUT of the
// first batch (U3: DOCX 不做) — they don't even get the toggle, rather than a
// toggle that always degrades. PDF is NOT here: it renders inline via the
// existing `previewKind: 'pdf'` path.
const INLINE_EXTENSION_DENYLIST = new Set([
  '.7z',
  '.doc',
  '.docm',
  '.docx',
  '.odp',
  '.ods',
  '.odt',
  '.ppt',
  '.pptm',
  '.pptx',
  '.rar',
  '.rtf',
  '.xls',
  '.xlsb',
  '.xlsm',
  '.xlsx',
  '.zip'
])

function inlinePreviewCapable(target: string): boolean {
  const clean = target.split(/[?#]/, 1)[0] || target
  const dot = clean.lastIndexOf('.')

  const extension = dot >= 0 ? clean.slice(dot).toLowerCase() : ''

  return extension !== '' && !INLINE_EXTENSION_DENYLIST.has(extension)
}
