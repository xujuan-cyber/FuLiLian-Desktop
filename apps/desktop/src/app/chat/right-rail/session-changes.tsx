import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { FileDiffPanel } from '@/components/assistant-ui/diff-lines'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { EmptyState } from '@/components/ui/empty-state'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { ChatMessage } from '@/lib/chat-messages'
import { desktopFileDiff, desktopGitRoot } from '@/lib/desktop-fs'
import { isExcludedPath } from '@/lib/excluded-paths'
import { cn } from '@/lib/utils'
import { $currentCwd } from '@/store/session'
import { $focusedRuntimeId, $sessionStates } from '@/store/session-states'
import { $workspaceChangeTick, toolChangedPath, toolMayMutateFiles } from '@/store/workspace-events'

// SESSION CHANGES (step14 R2) — the session-scoped aggregate review view:
// every file the conversation's tool calls touched, each expanding to its
// working-tree-vs-HEAD diff through the SAME channel the file preview uses
// (preview-file.tsx: desktopGitRoot + desktopFileDiff) rendered with the SAME
// FileDiffPanel primitive. No second diff renderer.
//
// Data-source decision (T0, recorded in the step14 receipt): there is no
// session⇄changed-file ownership channel — the review pane's list is
// repo/cwd-scoped (`git status`), and the preview diff is per-file. So the
// aggregate is built from the transcript: mutating tool calls with a path
// argument (the same extractors workspace-events.ts uses for refresh
// targeting). The header says so plainly: "files this session touched".

interface SessionChangedFile {
  /** Absolute when the session cwd could anchor it, else as reported. */
  path: string
  /** First tool that touched it (display hint). */
  tool: string
}

const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')

const isAbsoluteish = (value: string): boolean => value.startsWith('/') || /^[a-z]:[/\\]/i.test(value)

function joinCwd(cwd: string, relative: string): string {
  const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '')

  return `${base}/${normalizePath(relative)}`
}

/**
 * Files a transcript's mutating tool calls touched, newest first, deduped by
 * normalized path. Pure and exported for tests (A6).
 */
export function sessionChangedFiles(messages: readonly ChatMessage[], cwd: null | string): SessionChangedFile[] {
  const byPath = new Map<string, SessionChangedFile>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool-call') {
        continue
      }

      const result = (part.result ?? null) as Record<string, unknown> | null

      if (!toolMayMutateFiles({ inline_diff: result?.inline_diff, name: part.toolName })) {
        continue
      }

      const reported = toolChangedPath({ args: part.args })

      if (!reported || isExcludedPath(reported)) {
        continue
      }

      const path = isAbsoluteish(reported) ? normalizePath(reported) : cwd ? joinCwd(cwd, reported) : normalizePath(reported)
      const key = normalizePath(path)

      // A later call re-dates the file; the map preserves newest-last order,
      // which the panel reads newest-first.
      byPath.delete(key)
      byPath.set(key, { path, tool: part.toolName })
    }
  }

  return [...byPath.values()].reverse()
}

type DiffState =
  | { diff: string; kind: 'ready' }
  | { kind: 'error'; message?: string }
  | { kind: 'loading' }
  | { kind: 'nodiff' }

/**
 * The pane body. Renders inside a dedicated right-side pane (see
 * contrib/controller.tsx); scope = the FOCUSED session, the same session the
 * statusbar usage figures follow.
 */
export function SessionChangesPanel() {
  const { t } = useI18n()
  const r = t.sessionChanges
  const focusedRuntimeId = useStore($focusedRuntimeId)
  const sessionMessages = useStore($sessionStates)
  const cwd = useStore($currentCwd)
  const messages = focusedRuntimeId ? (sessionMessages[focusedRuntimeId]?.messages ?? []) : []

  const files = useMemo(() => sessionChangedFiles(messages, cwd || null), [cwd, messages])

  const [expanded, setExpanded] = useState<null | string>(null)
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({})
  // Bumped by workspace-change ticks so already-open diffs re-read a tree the
  // agent just mutated (same trigger model store/review.ts uses).
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(
    () => $workspaceChangeTick.subscribe(() => setReloadNonce(nonce => nonce + 1)),
    []
  )

  const loadDiff = useCallback(
    async (path: string) => {
      setDiffs(prev => ({ ...prev, [path]: { kind: 'loading' } }))

      try {
        const root = await desktopGitRoot(path)
        const diff = root ? await desktopFileDiff(root, path) : ''

        setDiffs(prev => ({ ...prev, [path]: diff.trim() ? { diff, kind: 'ready' } : { kind: 'nodiff' } }))
      } catch (error) {
        setDiffs(prev => ({
          ...prev,
          [path]: { kind: 'error', message: error instanceof Error ? error.message : String(error) }
        }))
      }
    },
    []
  )

  const toggle = (path: string) => {
    if (expanded === path) {
      setExpanded(null)

      return
    }

    setExpanded(path)

    if (!diffs[path] || diffs[path]!.kind === 'error') {
      void loadDiff(path)
    }
  }

  // An expanded diff re-reads after the agent touches the tree again.
  useEffect(() => {
    if (reloadNonce > 0 && expanded) {
      void loadDiff(expanded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce is the re-run trigger
  }, [reloadNonce])

  if (files.length === 0) {
    // Honest empty state (A6): no tool call touched a file → say exactly that.
    return <EmptyState className="h-full" description={r.scopeNote} title={r.empty} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1.5 px-2.5">
        <span className="min-w-0 flex-1 truncate text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-(--ui-text-quaternary)">
          {r.title}
        </span>
        <Tip label={r.refresh}>
          <Button
            aria-label={r.refresh}
            onClick={() => setReloadNonce(nonce => nonce + 1)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Codicon name="refresh" size="0.8125rem" />
          </Button>
        </Tip>
      </div>
      <p className="shrink-0 px-2.5 pb-1.5 text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)">
        {r.scopeNote}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {files.map(file => {
          const open = expanded === file.path
          const state = diffs[file.path]

          return (
            <div key={file.path}>
              <button
                aria-expanded={open}
                className={cn(
                  'flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1 text-left hover:bg-(--chrome-action-hover)',
                  open && 'bg-(--ui-row-active-background)'
                )}
                onClick={() => toggle(file.path)}
                type="button"
              >
                <Codicon
                  className="shrink-0 text-(--ui-text-quaternary)"
                  name={open ? 'chevron-down' : 'chevron-right'}
                  size="0.75rem"
                />
                <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-(--ui-text-secondary)">
                  {file.path}
                </span>
                <span className="shrink-0 text-[0.5625rem] text-(--ui-text-quaternary)">{file.tool}</span>
              </button>
              {open && (
                <div className="border-y border-(--ui-stroke-tertiary) bg-(--ui-widget-surface-background) px-2 py-1">
                  {!state || state.kind === 'loading' ? (
                    <div className="px-1 py-2 text-[0.625rem] text-(--ui-text-quaternary)">{r.loadingDiff}</div>
                  ) : state.kind === 'error' ? (
                    <div className="px-1 py-2 text-[0.625rem] text-destructive">
                      {state.message || r.diffUnavailable}
                    </div>
                  ) : state.kind === 'nodiff' ? (
                    <div className="px-1 py-2 text-[0.625rem] text-(--ui-text-quaternary)">{r.noDiff}</div>
                  ) : (
                    <FileDiffPanel className="border-0 bg-transparent" diff={state.diff} showLineNumbers={false} />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
