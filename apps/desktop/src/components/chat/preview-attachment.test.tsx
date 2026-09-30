// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { atom } from 'nanostores'

import { PreviewAttachment } from './preview-attachment'

const mocks = vi.hoisted(() => ({
  notifyError: vi.fn(),
  openPreview: vi.fn(),
  resolveTarget: vi.fn()
}))

vi.mock('@/app/chat/right-rail/preview-file', () => ({
  LocalFilePreview: ({ target }: { target: { name?: string } }) => (
    <div data-testid="local-file-preview">{target.name ?? 'preview'}</div>
  )
}))

vi.mock('@/lib/local-preview', () => ({
  normalizeOrLocalPreviewTarget: mocks.resolveTarget
}))

vi.mock('@/lib/preview-targets', () => ({
  previewName: (target: string) => target.split('/').pop() ?? target
}))

vi.mock('@/store/notifications', () => ({
  notifyError: mocks.notifyError
}))

vi.mock('@/store/preview', () => ({
  $previewTabSources: atom<string[]>([]),
  closePreviewForSource: vi.fn(),
  openPreview: mocks.openPreview
}))

vi.mock('@/app/chat/session-view', () => {
  const shared = atom('')

  return {
    useSessionView: () => ({ $cwd: shared })
  }
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      preview: {
        inlinePreview: 'Inline preview',
        inlineTooLarge: (name: string) => `${name} is too large to preview inline`,
        opening: 'Opening…',
        openPreview: 'Open preview',
        unavailable: 'Preview unavailable'
      }
    }
  })
}))

function fileTarget(name: string) {
  return `/repo/notes/${name}`
}

describe('R9 inline preview in the transcript (click-to-expand)', () => {
  beforeEach(() => {
    // $previewTabSources is a readable (derived) atom — nothing to seed here;
    // the component only reads it for the "already open in rail" hint.
    mocks.resolveTarget.mockReset()
    mocks.openPreview.mockReset()
  })

  it('never auto-expands: a mounted card renders no preview pane (no-hijack)', () => {
    mocks.resolveTarget.mockResolvedValue({ kind: 'file', name: 'notes.md' })

    render(<PreviewAttachment target={fileTarget('notes.md')} />)

    expect(screen.queryByTestId('local-file-preview')).toBeNull()
  })

  it('expands the shared rail renderer only on click (two consumers, one render path)', async () => {
    mocks.resolveTarget.mockResolvedValue({ kind: 'file', name: 'notes.md', previewKind: 'text' })

    render(<PreviewAttachment target={fileTarget('notes.md')} />)

    fireEvent.click(screen.getByText('Inline preview'))

    await waitFor(() => expect(screen.getByTestId('local-file-preview')).toBeTruthy())
    expect(mocks.resolveTarget).toHaveBeenCalledWith(fileTarget('notes.md'), undefined)
  })

  it('offers no inline toggle for office/archive binaries (U3: DOCX 不做)', () => {
    render(<PreviewAttachment target={fileTarget('report.docx')} />)

    expect(screen.queryByText('Inline preview')).toBeNull()
    // The rail escape hatch stays.
    expect(screen.getByText('Open preview')).toBeTruthy()
  })

  it('degrades an oversized/binary target to the rail instead of faking a preview', async () => {
    mocks.resolveTarget.mockResolvedValue({ binary: true, kind: 'file', large: true, name: 'huge.bin' })

    render(<PreviewAttachment target={fileTarget('huge.bin')} />)

    fireEvent.click(screen.getByText('Inline preview'))

    expect(await screen.findByText(/too large to preview inline/)).toBeTruthy()
    expect(screen.queryByTestId('local-file-preview')).toBeNull()
  })

  it('collapses back on a second click', async () => {
    mocks.resolveTarget.mockResolvedValue({ kind: 'file', name: 'notes.md', previewKind: 'text' })

    render(<PreviewAttachment target={fileTarget('notes.md')} />)

    fireEvent.click(screen.getByText('Inline preview'))
    await waitFor(() => expect(screen.getByTestId('local-file-preview')).toBeTruthy())

    fireEvent.click(screen.getByText('Inline preview'))

    expect(screen.queryByTestId('local-file-preview')).toBeNull()
  })
})
