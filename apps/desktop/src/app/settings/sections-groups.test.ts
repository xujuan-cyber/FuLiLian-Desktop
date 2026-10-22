import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS_VIEW,
  SECTIONS,
  SETTINGS_GROUPS,
  SETTINGS_VIEWS,
  settingsViewFromSection
} from './constants'

// The Workbench regrouping (DESIGN_PROPOSAL §5.5) must be a pure re-grouping:
// every section id and key list survives untouched.
const EXPECTED_SECTION_IDS = [
  'chat',
  'appearance',
  'workspace',
  'model',
  'memory',
  'voice',
  'browser',
  'advanced',
  'safety'
].sort()

const EXPECTED_PAGE_VIEWS = [
  // Basics
  'notifications',
  'keybinds',
  'tray',
  // Work modes
  'forensics',
  'ctf',
  // Security & compliance
  'approvals',
  'evidence-protection',
  'audit',
  'sensitive-info',
  // Models & capabilities
  'submodels',
  // Connection & data
  'providers',
  'gateway',
  'keys',
  'sessions',
  'billing',
  // Apps
  'plugins',
  'presets',
  'about',
  'pet',
  'quick-entry'
]

describe('settings sections / groups (DESIGN_PROPOSAL §5.5)', () => {
  it('keeps every section id intact — ids unchanged, only regrouped', () => {
    expect(SECTIONS.map(section => section.id).sort()).toEqual(EXPECTED_SECTION_IDS)
  })

  it('keeps the curated key lists of every section intact', () => {
    const byId = new Map(SECTIONS.map(section => [section.id, section]))

    // Spot-check the sections whose keys are the most regression-prone: the
    // full lists must not shrink or drift while the nav regroups.
    expect(byId.get('safety')?.keys).toEqual([
      'approvals.mode',
      'approvals.timeout',
      'approvals.mcp_reload_confirm',
      'command_allowlist',
      'security.redact_secrets',
      'security.allow_private_urls',
      'checkpoints.enabled'
    ])
    expect(byId.get('workspace')?.keys).toEqual([
      'terminal.cwd',
      'desktop.repo_scan_enabled',
      'desktop.repo_scan_roots',
      'desktop.repo_scan_exclude_paths',
      'code_execution.mode',
      'terminal.persistent_shell',
      'terminal.env_passthrough',
      'file_read_max_chars'
    ])
    expect(byId.get('chat')?.keys).toEqual([
      'display.personality',
      'timezone',
      'display.show_reasoning',
      'agent.image_input_mode'
    ])
  })

  it('orders the six groups exactly as designed', () => {
    expect(SETTINGS_GROUPS.map(group => group.id)).toEqual([
      'basics',
      'work-mode',
      'model-capabilities',
      'security-compliance',
      'connection-data',
      'apps'
    ])
  })

  it('keeps SECTIONS group metadata consistent with SETTINGS_GROUPS placement', () => {
    const groupOf = new Map(SETTINGS_GROUPS.flatMap(group => group.views.map(view => [view, group.id])))

    for (const section of SECTIONS) {
      expect(groupOf.get(`config:${section.id}`), `section ${section.id}`).toBe(section.group)
    }
  })

  it('places each view in its §5.5 group', () => {
    const groupOf = new Map(SETTINGS_GROUPS.flatMap(group => group.views.map(view => [view, group.id])))

    // Basics
    expect(groupOf.get('config:chat')).toBe('basics')
    expect(groupOf.get('config:appearance')).toBe('basics')
    expect(groupOf.get('notifications')).toBe('basics')
    expect(groupOf.get('keybinds')).toBe('basics')
    // Work modes (programming = the existing workspace page, relinked here)
    expect(groupOf.get('forensics')).toBe('work-mode')
    expect(groupOf.get('ctf')).toBe('work-mode')
    expect(groupOf.get('config:workspace')).toBe('work-mode')
    // Models & capabilities
    expect(groupOf.get('config:model')).toBe('model-capabilities')
    expect(groupOf.get('providers')).toBe('model-capabilities')
    expect(groupOf.get('submodels')).toBe('model-capabilities')
    expect(groupOf.get('config:memory')).toBe('model-capabilities')
    expect(groupOf.get('config:voice')).toBe('model-capabilities')
    expect(groupOf.get('config:browser')).toBe('model-capabilities')
    expect(groupOf.get('config:advanced')).toBe('model-capabilities')
    // Security & compliance: safety migrates in + the four new sections
    expect(groupOf.get('config:safety')).toBe('security-compliance')
    expect(groupOf.get('approvals')).toBe('security-compliance')
    expect(groupOf.get('evidence-protection')).toBe('security-compliance')
    expect(groupOf.get('audit')).toBe('security-compliance')
    expect(groupOf.get('sensitive-info')).toBe('security-compliance')
    // Connection & data
    expect(groupOf.get('keys')).toBe('connection-data')
    expect(groupOf.get('gateway')).toBe('connection-data')
    expect(groupOf.get('sessions')).toBe('connection-data')
    expect(groupOf.get('billing')).toBe('connection-data')
    // Apps
    expect(groupOf.get('plugins')).toBe('apps')
    expect(groupOf.get('presets')).toBe('apps')
    expect(groupOf.get('about')).toBe('apps')
    expect(groupOf.get('pet')).toBe('apps')
    expect(groupOf.get('quick-entry')).toBe('apps')
  })

  it('covers every nav view exactly once — nothing lost, nothing duplicated', () => {
    const views = SETTINGS_GROUPS.flatMap(group => group.views)

    expect(new Set(views).size).toBe(views.length)

    for (const section of SECTIONS) {
      expect(views).toContain(`config:${section.id}`)
    }

    for (const page of EXPECTED_PAGE_VIEWS) {
      expect(views).toContain(page)
    }

    // 9 config sections + 20 page views = 29 rows in the regrouped nav.
    expect(views.length).toBe(SECTIONS.length + EXPECTED_PAGE_VIEWS.length)
  })
})

// D3: `?section=` deep links. The resolver must be a *derivation* of the two
// tables above — a hand-kept second list is exactly the drift this pins out.
describe('settings section deep-link resolver (D3)', () => {
  it('derives the view enum from the group table, not a second list', () => {
    expect(SETTINGS_VIEWS).toEqual([...SETTINGS_GROUPS.flatMap(group => group.views), 'connections'])
    expect(DEFAULT_SETTINGS_VIEW).toBe('config:model')
    expect(SETTINGS_VIEWS).toContain(DEFAULT_SETTINGS_VIEW)
  })

  it('resolves every nav view id to itself', () => {
    for (const view of SETTINGS_GROUPS.flatMap(group => group.views)) {
      expect(settingsViewFromSection(view), `view ${view}`).toBe(view)
    }
  })

  it('resolves a bare SECTIONS id to its config page', () => {
    for (const section of SECTIONS) {
      expect(settingsViewFromSection(section.id), `section ${section.id}`).toBe(`config:${section.id}`)
    }
  })

  it('resolves the documented aliases and rejects everything else', () => {
    // QA/docs spell the Model section in the plural.
    expect(settingsViewFromSection('models')).toBe('config:model')
    expect(settingsViewFromSection('approvals')).toBe('approvals')
    expect(settingsViewFromSection('audit')).toBe('audit')
    expect(settingsViewFromSection('submodels')).toBe('submodels')
    expect(settingsViewFromSection('providers')).toBe('providers')
    // Unknown / empty → null, so the shell falls back instead of blanking.
    expect(settingsViewFromSection('no-such-section')).toBeNull()
    expect(settingsViewFromSection('')).toBeNull()
    expect(settingsViewFromSection(null)).toBeNull()
    expect(settingsViewFromSection(undefined)).toBeNull()
  })
})
