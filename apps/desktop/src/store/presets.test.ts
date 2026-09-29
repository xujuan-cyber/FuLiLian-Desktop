import { beforeEach, describe, expect, it } from 'vitest'

import { CAPABILITY_PRESETS, PRESET_TOOLSETS } from '@/lib/personalities'

import {
  $activePreset,
  $sessionPreset,
  activePresetToolsets,
  isValidPreset,
  rememberSessionPreset,
  sessionPreset,
  setActivePreset
} from './presets'

describe('capability preset store', () => {
  beforeEach(() => {
    $activePreset.set(null)
    $sessionPreset.set({})
  })

  it('starts with no preset active', () => {
    expect($activePreset.get()).toBeNull()
  })

  it('omits the create parameter entirely when no preset is active', () => {
    // Not `[]`: an empty whitelist means "no tools at all" on the backend, and
    // a default session must keep the platform resolution.
    expect(activePresetToolsets()).toBeUndefined()
  })

  it('hands the backend the preset whitelist when one is active', () => {
    for (const preset of CAPABILITY_PRESETS) {
      setActivePreset(preset)
      expect(activePresetToolsets(), preset).toEqual([...PRESET_TOOLSETS[preset]])
    }
  })

  it('returns a copy, so a mutate cannot widen the sent gate', () => {
    setActivePreset('review')
    activePresetToolsets()!.push('terminal')
    expect(activePresetToolsets()).toEqual([...PRESET_TOOLSETS.review])
    expect(activePresetToolsets()).not.toContain('terminal')
  })

  it('remembers the preset a session was created with', () => {
    rememberSessionPreset('sess-1', 'dev')
    rememberSessionPreset('sess-2', 'research')

    expect(sessionPreset('sess-1')).toBe('dev')
    expect(sessionPreset('sess-2')).toBe('research')
    expect(sessionPreset('never-created')).toBeNull()
    expect(sessionPreset(null)).toBeNull()
    expect(sessionPreset(undefined)).toBeNull()
  })

  it('drops a session record when the created session had no preset', () => {
    rememberSessionPreset('sess-3', 'dev')
    expect(sessionPreset('sess-3')).toBe('dev')

    rememberSessionPreset('sess-3', null)
    expect(sessionPreset('sess-3')).toBeNull()
  })

  it('keeps the pending selection separate from a live session preset', () => {
    // The chip shows the session's own preset; the picker shows the pending
    // one. Switching must not rewrite history for an open chat.
    rememberSessionPreset('sess-4', 'dev')
    setActivePreset('sec-audit')

    expect(sessionPreset('sess-4')).toBe('dev')
    expect($activePreset.get()).toBe('sec-audit')
  })

  it('rejects ids that are not presets', () => {
    expect(isValidPreset('dev')).toBe(true)
    expect(isValidPreset('helpful')).toBe(false)
    expect(isValidPreset('doc')).toBe(false)
    expect(isValidPreset('minimal')).toBe(false)
    expect(isValidPreset(null)).toBe(false)
  })
})
