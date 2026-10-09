import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type { ChatMessage } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { desktopFileDiff, desktopGitRoot } from '@/lib/desktop-fs'
import type * as SessionStore from '@/store/session'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'
import type * as SessionStatesStore from '@/store/session-states'

import { sessionChangedFiles, SessionChangesPanel } from './session-changes'

const SID = vi.hoisted(() => 'sess-changes-1')
// vi.mock factories are hoisted above module scope: the shared repo root must
// be hoisted with them.
const REPO = vi.hoisted(() => '/repo')

vi.mock('@/store/session-states', async importOriginal => {
  const actual = await importOriginal<typeof SessionStatesStore>()

  return { ...actual, $focusedRuntimeId: atom<null | string>(SID) }
})

vi.mock('@/store/session', async importOriginal => {
  const actual = await importOriginal<typeof SessionStore>()

  return { ...actual, $currentCwd: atom(REPO) }
})

vi.mock('@/lib/desktop-fs', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/desktop-fs')>()

  return {
    ...actual,
    desktopGitRoot: vi.fn(async () => REPO),
    desktopFileDiff: vi.fn(async () => '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-OLD_MARKER\n+CHANGED_MARKER')
  }
})

const toolPart = (name: string, args: Record<string, unknown>, result?: Record<string, unknown>) =>
  ({
    args,
    argsText: JSON.stringify(args),
    toolCallId: `${name}-1`,
    toolName: name,
    type: 'tool-call',
    ...(result ? { result } : {})
  }) as never

const msg = (id: string, parts: unknown[]): ChatMessage => ({ id, parts, role: 'assistant' }) as unknown as ChatMessage

describe('sessionChangedFiles (R2 aggregation)', () => {
  it('collects files touched by mutating tool calls', () => {
    const files = sessionChangedFiles(
      [msg('m1', [toolPart('write_file', { path: '/repo/src/a.ts' }), toolPart('read_file', { path: '/repo/src/b.ts' })])],
      REPO
    )

    expect(files.map(file => file.path)).toEqual(['/repo/src/a.ts'])
  })

  it('ignores read-only tools and pathless mutations', () => {
    const files = sessionChangedFiles(
      [
        msg('m1', [
          toolPart('search_files', { path: '/repo/src' }),
          toolPart('terminal', { command: 'npm test' }),
          toolPart('apply_patch', { patch: '+++' }, { inline_diff: '--- a\n+++ b' })
        ])
      ],
      REPO
    )

    expect(files).toEqual([])
  })

  it('anchors relative paths to the session cwd', () => {
    const files = sessionChangedFiles([msg('m1', [toolPart('write_file', { file_path: 'src/rel.ts' })])], REPO)

    expect(files.map(file => file.path)).toEqual([`${REPO}/src/rel.ts`])
  })

  it('dedupes by path and lists the most recently touched first', () => {
    const files = sessionChangedFiles(
      [
        msg('m1', [toolPart('write_file', { path: '/repo/a.ts' })]),
        msg('m2', [toolPart('edit_file', { path: '/repo/a.ts' }), toolPart('write_file', { path: '/repo/b.ts' })])
      ],
      REPO
    )

    expect(files.map(file => file.path)).toEqual(['/repo/b.ts', '/repo/a.ts'])
  })
})

function renderPanel() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <SessionChangesPanel />
    </I18nProvider>
  )
}

describe('SessionChangesPanel (A6 aggregate + honest empty state)', () => {
  beforeEach(() => {
    clearAllSessionStates()
    vi.mocked(desktopFileDiff).mockClear()
    vi.mocked(desktopGitRoot).mockClear()
  })

  afterEach(() => {
    cleanup()
    clearAllSessionStates()
  })

  it('shows the honest empty state when no tool touched a file', () => {
    renderPanel()

    expect(screen.getByText('No file changes in this session')).toBeTruthy()
  })

  it('lists touched files and expands a working-tree diff on click', async () => {
    publishSessionState(SID, {
      ...createClientSessionState(SID),
      messages: [msg('m1', [toolPart('write_file', { path: `${REPO}/src/a.ts` })])]
    })

    renderPanel()

    const row = screen.getByText(`${REPO}/src/a.ts`).closest('button')

    expect(row).toBeTruthy()

    fireEvent.click(row!)

    await waitFor(() => expect(vi.mocked(desktopFileDiff)).toHaveBeenCalledWith(REPO, `${REPO}/src/a.ts`))
    await waitFor(() => expect(screen.getByText('CHANGED_MARKER')).toBeTruthy())
  })

  it('recomputes the list when the focused session changes', () => {
    publishSessionState(SID, {
      ...createClientSessionState(SID),
      messages: [msg('m1', [toolPart('write_file', { path: `${REPO}/a.ts` })])]
    })

    const view = renderPanel()

    expect(screen.getByText(`${REPO}/a.ts`)).toBeTruthy()

    act(() => {
      clearAllSessionStates()
    })

    expect(screen.getByText('No file changes in this session')).toBeTruthy()

    return view.unmount()
  })
})
