import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  $quickCaptureNotes,
  appendQuickCaptureNote,
  clearQuickCaptureNotes,
  loadQuickCaptureNotes,
  QUICK_CAPTURE_INBOX_LIMIT,
  QUICK_CAPTURE_INBOX_STORAGE_KEY
} from './quick-capture-inbox'

describe('quick capture inbox', () => {
  beforeEach(() => {
    window.localStorage.clear()
    $quickCaptureNotes.set([])
  })

  afterEach(() => {
    window.localStorage.clear()
    $quickCaptureNotes.set([])
  })

  it('appends a trimmed note with an id and timestamp, and persists it', () => {
    const note = appendQuickCaptureNote('  registry Run key: OneDriveUpdate  ')

    expect(note).not.toBeNull()
    expect(note!.text).toBe('registry Run key: OneDriveUpdate')
    expect(note!.id).toBeTruthy()
    expect(note!.at).toBeTruthy()

    const stored = JSON.parse(window.localStorage.getItem(QUICK_CAPTURE_INBOX_STORAGE_KEY) ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ text: 'registry Run key: OneDriveUpdate' })
    expect($quickCaptureNotes.get()).toHaveLength(1)
  })

  it('rejects whitespace-only text without touching storage', () => {
    expect(appendQuickCaptureNote('   ')).toBeNull()
    expect(appendQuickCaptureNote('')).toBeNull()
    expect(window.localStorage.getItem(QUICK_CAPTURE_INBOX_STORAGE_KEY)).toBeNull()
    expect($quickCaptureNotes.get()).toEqual([])
  })

  it('preserves earlier notes and appends in order', () => {
    appendQuickCaptureNote('first')
    appendQuickCaptureNote('second')

    const notes = loadQuickCaptureNotes()
    expect(notes.map(note => note.text)).toEqual(['first', 'second'])
  })

  it('evicts the OLDEST note once the cap is reached', () => {
    for (let index = 0; index < QUICK_CAPTURE_INBOX_LIMIT + 5; index += 1) {
      appendQuickCaptureNote(`note ${index}`)
    }

    const notes = loadQuickCaptureNotes()

    expect(notes).toHaveLength(QUICK_CAPTURE_INBOX_LIMIT)
    expect(notes[0]!.text).toBe('note 5')
    expect(notes.at(-1)!.text).toBe(`note ${QUICK_CAPTURE_INBOX_LIMIT + 4}`)
  })

  it('a corrupt stored blob degrades to an empty inbox instead of breaking the next capture', () => {
    window.localStorage.setItem(QUICK_CAPTURE_INBOX_STORAGE_KEY, '{not json')

    expect(loadQuickCaptureNotes()).toEqual([])

    const note = appendQuickCaptureNote('still lands')
    expect(note!.text).toBe('still lands')
    expect(loadQuickCaptureNotes()).toHaveLength(1)
  })

  it('a stored blob with malformed rows keeps only the well-formed notes', () => {
    window.localStorage.setItem(
      QUICK_CAPTURE_INBOX_STORAGE_KEY,
      JSON.stringify([{ id: 'a', at: 't', text: 'good' }, 'junk', 42, null, { text: 'no id' }])
    )

    const notes = loadQuickCaptureNotes()
    expect(notes).toHaveLength(1)
    expect(notes[0]!.text).toBe('good')
  })

  it('clear drains the inbox and removes the storage key', () => {
    appendQuickCaptureNote('to be drained')

    const drained = clearQuickCaptureNotes()

    expect(drained.map(note => note.text)).toEqual(['to be drained'])
    expect(window.localStorage.getItem(QUICK_CAPTURE_INBOX_STORAGE_KEY)).toBeNull()
    expect($quickCaptureNotes.get()).toEqual([])
  })
})
