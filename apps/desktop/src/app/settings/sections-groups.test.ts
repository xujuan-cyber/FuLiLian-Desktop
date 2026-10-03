import { describe, expect, it } from 'vitest'

import { SECTIONS, SETTINGS_GROUPS } from './constants'

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
  // Work modes
  'forensics',
  'ctf',
  // Security & compliance
  'approvals',
  'evidence-protection',
  'audit',
  'sensitive-info',
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

    // 9 config sections + 19 page views = 28 rows in the regrouped nav.
    expect(views.length).toBe(SECTIONS.length + EXPECTED_PAGE_VIEWS.length)
  })
})
