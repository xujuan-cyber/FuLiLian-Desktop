// Single source of truth for built-in personality names on the desktop.
// Mirrors fulilian_cli/personality.py BUILTIN_PERSONALITIES — the backend
// single owner. Keep in sync when a built-in is added there.
export const BUILTIN_PERSONALITIES = [
  'helpful',
  'concise',
  'technical',
  'creative',
  'teacher',
  'kawaii',
  'catgirl',
  'pirate',
  'shakespeare',
  'surfer',
  'noir',
  'uwu',
  'philosopher',
  'hype',
  // Phase-13 capability presets (P1~P5). Structured definitions on the
  // backend; here they are the names the preset picker renders and the keys
  // the toolset binding below is looked up by. P6 `doc` and P7 `minimal` are
  // deferred by decision U6 and must not be added.
  'orchestrator',
  'dev',
  'review',
  'sec-audit',
  'research'
] as const

/** Ordered capability presets, mirroring `CAPABILITY_PRESETS` in
 *  `fulilian_cli/personality.py`. */
export const CAPABILITY_PRESETS = ['orchestrator', 'dev', 'review', 'sec-audit', 'research'] as const

export type CapabilityPreset = (typeof CAPABILITY_PRESETS)[number]

/**
 * The tool-surface half of each capability preset — a **closed** toolset
 * whitelist, mirroring `PRESET_TOOLSETS` in `fulilian_cli/personality.py`.
 *
 * Sent as the optional `toolsets` parameter on `session.create`; the backend
 * resolves it in preference to `platform_toolsets` for that session only, so
 * the gate is enforced server-side. Keeping the table in sync matters more
 * than usual: a name that only exists here would be dropped (loudly) by the
 * backend and silently widen nothing, but the UI would lie about it.
 */
export const PRESET_TOOLSETS: Record<CapabilityPreset, readonly string[]> = {
  orchestrator: [
    'file',
    'web',
    'session_search',
    'todo',
    'delegation',
    'kanban',
    'skills',
    'memory',
    'clarify',
    'vision'
  ],
  dev: ['coding'],
  review: ['file', 'web', 'vision', 'session_search', 'skills', 'todo'],
  'sec-audit': ['file', 'web', 'vision', 'session_search', 'skills', 'todo', 'terminal'],
  research: ['file', 'web', 'vision', 'session_search', 'skills', 'todo', 'x_search']
}

export function isCapabilityPreset(value: null | string | undefined): value is CapabilityPreset {
  return typeof value === 'string' && (CAPABILITY_PRESETS as readonly string[]).includes(value)
}

/** The toolset whitelist for a preset, or `null` when `value` is not one. */
export function presetToolsets(value: null | string | undefined): null | string[] {
  if (!isCapabilityPreset(value)) {
    return null
  }

  return [...PRESET_TOOLSETS[value]]
}
