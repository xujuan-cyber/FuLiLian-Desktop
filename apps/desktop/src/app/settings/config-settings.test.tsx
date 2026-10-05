import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

const getElevenLabsVoices = vi.fn()
const getFulilianConfigRecord = vi.fn()
const getFulilianConfigSchema = vi.fn()
const saveFulilianConfig = vi.fn()

// Keep the real `@/fulilian` barrel (ConfigSettings + the statically-imported
// ModelSettings pull many names) but stub the four IO calls this test drives.
vi.mock('@/fulilian', async () => {
  const actual = await vi.importActual<typeof import('@/fulilian')>('@/fulilian')

  return {
    ...actual,
    getElevenLabsVoices: (...args: unknown[]) => getElevenLabsVoices(...args),
    getFulilianConfigRecord: () => getFulilianConfigRecord(),
    getFulilianConfigSchema: (...args: unknown[]) => getFulilianConfigSchema(...args),
    saveFulilianConfig: (...args: unknown[]) => saveFulilianConfig(...args)
  }
})

// The scope chip pulls the profile store + refreshProfiles IPC; irrelevant here.
vi.mock('./profile-scope', () => ({
  SettingsProfileScope: () => null
}))

const CONFIG = {
  display: { personality: '' },
  tts: { provider: 'elevenlabs', elevenlabs: { voice_id: '', model_id: '' } }
}

function renderConfigSettings(activeSectionId: string, config: Record<string, unknown>) {
  getFulilianConfigRecord.mockResolvedValue(config)
  getFulilianConfigSchema.mockResolvedValue({ category_order: [], fields: {} })
  saveFulilianConfig.mockResolvedValue({ ok: true })

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return import('./config-settings').then(({ ConfigSettings }) =>
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <I18nProvider configClient={null} initialLocale="en">
            <ConfigSettings activeSectionId={activeSectionId} importInputRef={createRef<HTMLInputElement>()} />
          </I18nProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )
  )
}

// Step 17 · P4-B: the ElevenLabs voice list is only used by the
// `tts.elevenlabs.voice_id` field. It used to be fetched unconditionally on
// every config-page mount; now it loads only on the Voice section with the
// ElevenLabs TTS provider selected.
describe('ConfigSettings ElevenLabs voices gating (P4-B)', () => {
  beforeEach(() => {
    getElevenLabsVoices.mockResolvedValue({ available: true, voices: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('fetches voices on the Voice section with the ElevenLabs provider', async () => {
    await renderConfigSettings('voice', CONFIG)

    await waitFor(() => expect(getElevenLabsVoices).toHaveBeenCalledTimes(1))
  })

  it('skips voices on the Voice section when the provider is not ElevenLabs', async () => {
    await renderConfigSettings('voice', { tts: { provider: 'edge', edge: { voice: '' } } })

    await waitFor(() => expect(getFulilianConfigRecord).toHaveBeenCalled())
    expect(getElevenLabsVoices).not.toHaveBeenCalled()
  })

  it('skips voices on non-voice sections even when the provider is ElevenLabs', async () => {
    await renderConfigSettings('chat', CONFIG)

    await waitFor(() => expect(getFulilianConfigRecord).toHaveBeenCalled())
    expect(getElevenLabsVoices).not.toHaveBeenCalled()
  })
})
