import { describe, expect, it } from 'vitest'

import type { FulilianConfigRecord } from '@/types/fulilian'

import { FIELD_DESCRIPTIONS, FIELD_LABELS, SECTIONS } from './constants'
import { defineFieldCopy, fieldCopyForSchemaKey, schemaKeyToFieldCopyKey } from './field-copy'
import {
  clearsEnabledToolsets,
  enumOptionsFor,
  getNested,
  isExternalMemoryProvider,
  providerGroup,
  sectionFieldEntries,
  setNested,
  stripToolsetLabel,
  toolsetDisplayLabel
} from './helpers'

describe('settings helpers', () => {
  it('surfaces repository discovery config in Workspace with user-facing copy', () => {
    const workspace = SECTIONS.find(section => section.id === 'workspace')

    expect(workspace?.keys).toEqual(
      expect.arrayContaining([
        'desktop.repo_scan_enabled',
        'desktop.repo_scan_roots',
        'desktop.repo_scan_exclude_paths'
      ])
    )
    expect(fieldCopyForSchemaKey(FIELD_LABELS, 'desktop.repo_scan_enabled')).toBeTruthy()
    expect(fieldCopyForSchemaKey(FIELD_DESCRIPTIONS, 'desktop.repo_scan_exclude_paths')).toBeTruthy()
  })

  it('does not shadow the backend schema options for memory.provider', () => {
    // memory.provider options are discovery-driven and served by the backend
    // config schema (merged per-request); enumOptionsFor must return undefined
    // so config-field consumes schema.options instead of a stale static list.
    expect(enumOptionsFor('memory.provider', '', {})).toBeUndefined()
    expect(enumOptionsFor('memory.provider', 'honcho', {})).toBeUndefined()
  })

  describe('isExternalMemoryProvider', () => {
    it('treats only real plugin names as external providers', () => {
      expect(isExternalMemoryProvider('honcho')).toBe(true)
      expect(isExternalMemoryProvider('hindsight')).toBe(true)
    })

    it('treats built-in aliases and empty values as not external', () => {
      for (const value of ['', 'builtin', 'built-in', 'Builtin', 'none', '  ', undefined, null, 7]) {
        expect(isExternalMemoryProvider(value)).toBe(false)
      }
    })
  })

  describe('defineFieldCopy', () => {
    it('flattens nested field copy paths', () => {
      const copy = defineFieldCopy({
        display: {
          personality: 'Personality'
        },
        stt: {
          elevenlabs: {
            language_code: 'Language'
          }
        }
      })

      expect(copy[['display', 'personality'].join('.')]).toBe('Personality')
      expect(copy[['stt', 'elevenlabs', 'language_code'].join('.')]).toBe('Language')
    })

    it('keeps top-level flat field keys', () => {
      expect(
        defineFieldCopy({
          model_context_length: 'Context Window',
          file_read_max_chars: 'File Read Limit'
        })
      ).toEqual({
        model_context_length: 'Context Window',
        file_read_max_chars: 'File Read Limit'
      })
    })

    it('maps schema keys to camelCase translation keys', () => {
      expect(schemaKeyToFieldCopyKey('model_context_length')).toBe('modelContextLength')
      expect(schemaKeyToFieldCopyKey('display.show_reasoning')).toBe('display.showReasoning')
      expect(schemaKeyToFieldCopyKey('tool_output.max_line_length')).toBe('toolOutput.maxLineLength')
      expect(schemaKeyToFieldCopyKey('updates.non_interactive_local_changes')).toBe(
        'updates.nonInteractiveLocalChanges'
      )
    })

    it('looks up camelCase field copy by schema key with legacy fallback', () => {
      const copy = defineFieldCopy({
        display: {
          showReasoning: 'Reasoning Blocks'
        },
        file_read_max_chars: 'Legacy File Read Limit',
        modelContextLength: 'Context Window',
        toolOutput: {
          maxLineLength: 'Line Length Limit'
        }
      })

      expect(fieldCopyForSchemaKey(copy, 'model_context_length')).toBe('Context Window')
      expect(fieldCopyForSchemaKey(copy, 'display.show_reasoning')).toBe('Reasoning Blocks')
      expect(fieldCopyForSchemaKey(copy, 'tool_output.max_line_length')).toBe('Line Length Limit')
      expect(fieldCopyForSchemaKey(copy, 'file_read_max_chars')).toBe('Legacy File Read Limit')
    })

    it('rejects duplicate flattened paths', () => {
      const duplicateKey = ['display', 'personality'].join('.')

      expect(() =>
        defineFieldCopy({
          display: {
            personality: 'Personality'
          },
          [duplicateKey]: 'Duplicate'
        })
      ).toThrow('Duplicate field copy key: display.personality')
    })
  })

  it('reads and writes nested config paths', () => {
    const config: FulilianConfigRecord = { display: { theme: 'mono' } }
    const next = setNested(config, 'display.theme', 'slate')

    expect(getNested(next, 'display.theme')).toBe('slate')
    expect(getNested(config, 'display.theme')).toBe('mono')
  })

  it('rejects prototype-polluting config paths', () => {
    const config: FulilianConfigRecord = {}

    expect(() => setNested(config, '__proto__.polluted', true)).toThrow('Unsafe config path')
    expect(() => setNested(config, 'constructor.prototype.polluted', true)).toThrow('Unsafe config path')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  describe('stripToolsetLabel', () => {
    it('removes leading emoji prefixes from registry labels', () => {
      expect(stripToolsetLabel('⏰ Cron Jobs')).toBe('Cron Jobs')
      expect(stripToolsetLabel('⚡ Code Execution')).toBe('Code Execution')
      expect(stripToolsetLabel('❓ Clarifying Questions')).toBe('Clarifying Questions')
      expect(stripToolsetLabel('🌐 Browser Automation')).toBe('Browser Automation')
      expect(stripToolsetLabel('🎨 Image Generation')).toBe('Image Generation')
    })

    it('leaves plain titles unchanged', () => {
      expect(stripToolsetLabel('Terminal & Processes')).toBe('Terminal & Processes')
    })
  })

  describe('toolsetDisplayLabel', () => {
    it('strips emoji from toolset rows', () => {
      expect(toolsetDisplayLabel({ name: 'cronjob', label: '⏰ Cron Jobs' })).toBe('Cron Jobs')
    })
  })

  describe('providerGroup', () => {
    it('maps a provider env var to its labeled group', () => {
      expect(providerGroup('XAI_API_KEY')).toBe('xAI')
      expect(providerGroup('NOUS_API_KEY')).toBe('Nous Portal')
      expect(providerGroup('FIREWORKS_API_KEY')).toBe('Fireworks AI')
      expect(providerGroup('OPENROUTER_API_KEY')).toBe('OpenRouter')
    })

    it('prefers the longest matching prefix so CN/regional buckets win', () => {
      // MINIMAX_CN_ must beat the generic MINIMAX_ prefix.
      expect(providerGroup('MINIMAX_CN_API_KEY')).toBe('MiniMax (China)')
      expect(providerGroup('MINIMAX_API_KEY')).toBe('MiniMax')
      // KIMI_CN_ likewise must beat KIMI_.
      expect(providerGroup('KIMI_CN_API_KEY')).toBe('Kimi (China)')
      expect(providerGroup('KIMI_API_KEY')).toBe('Kimi / Moonshot')
      // FULILIAN_QWEN_ shares the FULILIAN_ stem with other integrations.
      expect(providerGroup('FULILIAN_QWEN_BASE_URL')).toBe('DashScope (Qwen)')
      expect(providerGroup('GEMINI_API_KEY')).toBe('Gemini')
    })

    it('falls back to "Other" for un-grouped env vars', () => {
      expect(providerGroup('SOMETHING_RANDOM')).toBe('Other')
    })
  })

  describe('enumOptionsFor — backend selector dropdowns', () => {
    const config: FulilianConfigRecord = {}

    it('renders a dropdown for the terminal execution backend', () => {
      const opts = enumOptionsFor('terminal.backend', 'local', config)
      expect(opts).toEqual(['local', 'docker', 'singularity', 'modal', 'daytona', 'ssh'])
    })
  })

  describe('sectionFieldEntries', () => {
    it('renders memory.provider from config even when the backend schema omits it', () => {
      const schema = { 'memory.memory_enabled': { type: 'boolean' as const } }
      const config: FulilianConfigRecord = { memory: { memory_enabled: true, provider: '' } }

      const memoryKeys = (sectionFieldEntries(schema, config).get('memory') ?? []).map(([key]) => key)

      expect(memoryKeys).toContain('memory.provider')
    })

    it('infers the field type from the config value when the schema omits the key', () => {
      const config: FulilianConfigRecord = { memory: { provider: '', memory_enabled: true, memory_char_limit: 2200 } }

      const fields = new Map(sectionFieldEntries({}, config).get('memory') ?? [])

      expect(fields.get('memory.provider')?.type).toBe('string')
      expect(fields.get('memory.memory_enabled')?.type).toBe('boolean')
      expect(fields.get('memory.memory_char_limit')?.type).toBe('number')
    })

    it('prefers the backend schema entry over inference when both exist', () => {
      const schema = { 'memory.provider': { type: 'select' as const, options: ['honcho'] } }
      const config: FulilianConfigRecord = { memory: { provider: 'honcho' } }

      const field = new Map(sectionFieldEntries(schema, config).get('memory') ?? []).get('memory.provider')

      expect(field?.type).toBe('select')
      expect(field?.options).toEqual(['honcho'])
    })

    it('hides declared keys absent from both schema and config', () => {
      expect(sectionFieldEntries({}, {}).get('memory') ?? []).toHaveLength(0)
    })
  })

  describe('clearsEnabledToolsets', () => {
    it('flags a non-empty → empty transition', () => {
      const prev: FulilianConfigRecord = { toolsets: ['memory', 'terminal', 'web_search'] }
      const next: FulilianConfigRecord = { toolsets: [] }

      expect(clearsEnabledToolsets(prev, next)).toBe(true)
    })

    it('does not flag a non-empty → missing transition (deep-merge preserves the key)', () => {
      // PUT /api/config deep-merges the override onto the stored config, so an
      // import that omits `toolsets` keeps the existing list — no wipe happens,
      // so there is nothing to confirm.
      const prev: FulilianConfigRecord = { toolsets: ['memory'] }
      const next: FulilianConfigRecord = {}

      expect(clearsEnabledToolsets(prev, next)).toBe(false)
    })

    it('does not flag when at least one toolset remains', () => {
      const prev: FulilianConfigRecord = { toolsets: ['memory', 'terminal'] }
      const next: FulilianConfigRecord = { toolsets: ['memory'] }

      expect(clearsEnabledToolsets(prev, next)).toBe(false)
    })

    it('does not flag when the list was already empty', () => {
      const prev: FulilianConfigRecord = { toolsets: [] }
      const next: FulilianConfigRecord = { toolsets: [] }

      expect(clearsEnabledToolsets(prev, next)).toBe(false)
    })

    it('does not flag an unrelated edit that never touched toolsets', () => {
      const prev: FulilianConfigRecord = { model: 'a', toolsets: ['memory'] }
      const next: FulilianConfigRecord = { model: 'b', toolsets: ['memory'] }

      expect(clearsEnabledToolsets(prev, next)).toBe(false)
    })
  })
})
