import type * as React from 'react'
import { lazy, type RefObject, Suspense, useRef } from 'react'

import type { CodeEditorApi } from '@/components/assistant-ui/code-editor'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

// Boot-path hygiene: this component is reached statically from the Skills MCP
// tab, which itself rides the entry chunk (sdk/index.ts's SkillsView re-export
// pins the page eagerly). A static CodeEditor import here therefore pinned the
// whole CodeMirror family onto the boot path. The lazy boundary defers the
// editor chunk until a JSON editor actually renders.
const CodeEditor = lazy(async () => ({
  default: (await import('@/components/assistant-ui/code-editor')).CodeEditor
}))

// Kept a string (not a shared CSS utility): the `size-5` prefix lets
// tailwind-merge override <Button size="icon">'s larger built-in size.
const ICON_BUTTON =
  'size-5 cursor-pointer rounded-[4px] text-muted-foreground/70 hover:bg-(--ui-control-active-background) hover:text-foreground'

interface JsonDocumentEditorProps {
  apiRef?: RefObject<CodeEditorApi | null>
  className?: string
  disabled?: boolean
  filePath?: string
  header?: React.ReactNode
  highlight?: null | { from: number; to: number }
  initialValue: string
  onChange: (value: string) => void
  onCursorChange?: (pos: number) => void
  onFormatJsonError: (error: string) => void
  onSave?: () => void
  remountKey?: number | string
  trailing?: React.ReactNode
}

/** In-memory JSON editor — not for on-disk file previews in the right rail. */
export function JsonDocumentEditor({
  apiRef,
  className,
  disabled,
  filePath = 'document.json',
  header,
  highlight,
  initialValue,
  onChange,
  onCursorChange,
  onFormatJsonError,
  onSave,
  remountKey,
  trailing
}: JsonDocumentEditorProps) {
  const { t } = useI18n()
  const localApi = useRef<CodeEditorApi | null>(null)
  const editorApi = apiRef ?? localApi

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        {header ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[0.68rem] text-(--ui-text-tertiary)">{header}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Tip label={t.common.formatJson}>
            <Button
              aria-label={t.common.formatJson}
              className={ICON_BUTTON}
              disabled={disabled}
              onClick={() => {
                const result = editorApi.current?.formatJson()

                if (result && !result.ok) {
                  onFormatJsonError(result.error)
                }
              }}
              size="icon"
              variant="ghost"
            >
              <Codicon name="json" size="0.8125rem" />
            </Button>
          </Tip>
          {trailing}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <CodeEditor
            apiRef={editorApi}
            disabled={disabled}
            filePath={filePath}
            formatJson
            highlight={highlight}
            initialValue={initialValue}
            key={remountKey}
            onChange={onChange}
            onCursorChange={onCursorChange}
            onFormatJsonError={onFormatJsonError}
            onSave={onSave}
          />
        </Suspense>
      </div>
    </div>
  )
}
