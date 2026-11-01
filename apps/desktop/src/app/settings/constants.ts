import {
  Box,
  Brain,
  Globe,
  type IconComponent,
  Lock,
  MessageCircle,
  Monitor,
  Moon,
  Palette,
  Sun,
  Wrench
} from '@/lib/icons'
import { REASONING_EFFORTS } from '@/lib/reasoning-effort'
import type { ThemeMode } from '@/themes/context'

// Single source of truth for built-in personality names lives in
// lib/personalities (mirrors fulilian_cli/personality.py BUILTIN_PERSONALITIES).
export { BUILTIN_PERSONALITIES } from '@/lib/personalities'

import { defineFieldCopy } from './field-copy'
import type { DesktopConfigSection, SettingsGroupId, SettingsView } from './types'

// Provider group definitions used to fold raw env-var names like
// ``XAI_API_KEY`` into a single "xAI" card with a friendly label, short
// description, and signup URL. Membership is determined by longest
// prefix match (see ``providerGroup`` in helpers.ts) so more specific
// prefixes (``MINIMAX_CN_``) correctly beat their general parents
// (``MINIMAX_``). New providers should be added here so they get their
// own card in Settings → Keys instead of being lumped into "Other".
interface ProviderPrefix {
  prefix: string
  name: string
  /** Optional one-line tagline shown beneath the group name. */
  description?: string
  /** Optional canonical signup/console URL surfaced from the card header. */
  docsUrl?: string
  /** Lower numbers float to the top of the providers list. */
  priority: number
}

export const EMPTY_SELECT_VALUE = '__fulilian_empty__'
export const CONTROL_TEXT = 'text-xs'

export const PROVIDER_GROUPS: ProviderPrefix[] = [
  {
    prefix: 'NOUS_',
    name: 'Nous Portal',
    description: 'Hosted Fulilian & Nous-trained models',
    docsUrl: 'https://portal.nousresearch.com',
    priority: 0
  },
  {
    prefix: 'FIREWORKS_',
    name: 'Fireworks AI',
    description: 'OpenAI-compatible direct model API',
    docsUrl: 'https://app.fireworks.ai/settings/users/api-keys',
    // Slot #2 — mirrors CANONICAL_PROVIDERS (after Nous, ahead of OpenRouter).
    // Same numeric priority as OpenRouter; name sort puts Fireworks first.
    priority: 1
  },
  {
    prefix: 'OPENROUTER_',
    name: 'OpenRouter',
    description: 'Aggregator for hundreds of frontier models',
    docsUrl: 'https://openrouter.ai/keys',
    priority: 1
  },
  {
    prefix: 'ANTHROPIC_',
    name: 'Anthropic',
    description: 'Claude API access (Sonnet, Opus, Haiku)',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    priority: 2
  },
  {
    prefix: 'XAI_',
    name: 'xAI',
    description: 'Grok models (use OAuth for SuperGrok / Premium+)',
    docsUrl: 'https://console.x.ai/',
    priority: 3
  },
  {
    prefix: 'GOOGLE_',
    name: 'Gemini',
    description: 'Google AI Studio (Gemini 1.5 / 2.0 / 2.5)',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    priority: 4
  },
  { prefix: 'GEMINI_', name: 'Gemini', priority: 4 },
  {
    prefix: 'DEEPSEEK_',
    name: 'DeepSeek',
    description: 'Direct DeepSeek API (V3.x, R1)',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    priority: 5
  },
  {
    prefix: 'DASHSCOPE_',
    name: 'DashScope (Qwen)',
    description: 'Alibaba Cloud DashScope — Qwen and multi-vendor models',
    docsUrl: 'https://modelstudio.console.alibabacloud.com/',
    priority: 6
  },
  { prefix: 'FULILIAN_QWEN_', name: 'DashScope (Qwen)', priority: 6 },
  {
    prefix: 'GLM_',
    name: 'GLM / Z.AI',
    description: 'Zhipu GLM-4.6 and Z.AI hosted endpoints',
    docsUrl: 'https://z.ai/',
    priority: 7
  },
  { prefix: 'ZAI_', name: 'GLM / Z.AI', priority: 7 },
  { prefix: 'Z_AI_', name: 'GLM / Z.AI', priority: 7 },
  {
    prefix: 'KIMI_',
    name: 'Kimi / Moonshot',
    description: 'Moonshot Kimi K2 / coding endpoints',
    docsUrl: 'https://platform.moonshot.cn/',
    priority: 8
  },
  {
    prefix: 'KIMI_CN_',
    name: 'Kimi (China)',
    description: 'Moonshot China endpoint',
    docsUrl: 'https://platform.moonshot.cn/',
    priority: 9
  },
  {
    prefix: 'MINIMAX_',
    name: 'MiniMax',
    description: 'MiniMax-M2 and Hailuo international endpoints',
    docsUrl: 'https://www.minimax.io/',
    priority: 10
  },
  {
    prefix: 'MINIMAX_CN_',
    name: 'MiniMax (China)',
    description: 'MiniMax mainland China endpoint',
    docsUrl: 'https://www.minimaxi.com/',
    priority: 11
  },
  {
    prefix: 'HF_',
    name: 'Hugging Face',
    description: 'Inference Providers — 20+ open models via router.huggingface.co',
    docsUrl: 'https://huggingface.co/settings/tokens',
    priority: 12
  },
  {
    prefix: 'OPENCODE_ZEN_',
    name: 'OpenCode Zen',
    description: 'Pay-as-you-go access to curated coding models',
    docsUrl: 'https://opencode.ai/auth',
    priority: 13
  },
  {
    prefix: 'OPENCODE_GO_',
    name: 'OpenCode Go',
    description: '$10/month subscription for open coding models',
    docsUrl: 'https://opencode.ai/auth',
    priority: 14
  },
  {
    prefix: 'NVIDIA_',
    name: 'NVIDIA NIM',
    description: 'build.nvidia.com or your own local NIM endpoint',
    docsUrl: 'https://build.nvidia.com/',
    priority: 15
  },
  {
    prefix: 'OLLAMA_',
    name: 'Ollama Cloud',
    description: 'Cloud-hosted open models from ollama.com',
    docsUrl: 'https://ollama.com/settings',
    priority: 16
  },
  {
    prefix: 'LM_',
    name: 'LM Studio',
    description: 'Local LM Studio server (OpenAI-compatible)',
    docsUrl: 'https://lmstudio.ai/docs/local-server',
    priority: 17
  },
  {
    prefix: 'STEPFUN_',
    name: 'StepFun',
    description: 'StepFun Step Plan coding models',
    docsUrl: 'https://platform.stepfun.com/',
    priority: 18
  },
  {
    prefix: 'XIAOMI_',
    name: 'Xiaomi MiMo',
    description: 'MiMo-V2.5 and Xiaomi proprietary models',
    docsUrl: 'https://platform.xiaomimimo.com',
    priority: 19
  },
  {
    prefix: 'ARCEEAI_',
    name: 'Arcee AI',
    description: 'Arcee-hosted small + medium models',
    docsUrl: 'https://chat.arcee.ai/',
    priority: 20
  },
  { prefix: 'ARCEE_', name: 'Arcee AI', priority: 20 },
  {
    prefix: 'GMI_',
    name: 'GMI Cloud',
    description: 'GMI Cloud GPU + model serving',
    docsUrl: 'https://www.gmicloud.ai/',
    priority: 21
  },
  {
    prefix: 'AZURE_FOUNDRY_',
    name: 'Azure Foundry',
    description: 'Azure AI Foundry custom endpoints (OpenAI / Anthropic-compatible)',
    docsUrl: 'https://ai.azure.com/',
    priority: 22
  },
  {
    prefix: 'AWS_',
    name: 'AWS Bedrock',
    description: 'Authenticate via AWS profile + region',
    docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-regions.html',
    priority: 23
  }
]

// Schema-side select overrides for desktop-relevant enum fields whose
// backend schema only declares a string type.
export const ENUM_OPTIONS: Record<string, string[]> = {
  'agent.image_input_mode': ['auto', 'native', 'text'],
  'approvals.mode': ['manual', 'smart', 'off'],
  'code_execution.mode': ['project', 'strict'],
  'context.engine': ['compressor', 'default', 'custom'],
  // '' = inherit the agent's own effort; the rest is the shared scale.
  'delegation.reasoning_effort': ['', ...REASONING_EFFORTS],
  // NOTE: memory.provider is intentionally NOT listed here. Its options are
  // discovery-driven and served by the backend config schema (merged
  // per-request in web_server._schema_with_dynamic_provider_options), so
  // config-field consumes schema.options directly — a static list here would
  // shadow that and hide user-installed/pip providers (#49513).
  // Terminal execution backends — kept in sync with the dispatch ladder in
  // tools/terminal_tool.py::_create_environment (local/docker/singularity/
  // modal/daytona/ssh). Remote backends need extra env (image, tokens, host).
  'terminal.backend': ['local', 'docker', 'singularity', 'modal', 'daytona', 'ssh'],
  'updates.non_interactive_local_changes': ['stash', 'discard']
}

// Free-input combobox keys (Input + datalist instead of a closed Select). The
// only entries were the TTS/STT voice and model names, which left with the
// Voice settings section; the export stays because `config-field.tsx` reads it
// for every select field.
export const FREE_INPUT_KEYS = new Set<string>()

export const FIELD_LABELS: Record<string, string> = defineFieldCopy({
  model: 'Default Model',
  modelContextLength: 'Context Window',
  fallbackProviders: 'Fallback Models',
  toolsets: 'Enabled Toolsets',
  timezone: 'Timezone',
  display: {
    personality: 'Personality',
    showReasoning: 'Reasoning Blocks'
  },
  desktop: {
    repoScanEnabled: 'Automatic Repository Discovery',
    repoScanRoots: 'Repository Discovery Roots',
    repoScanExcludePaths: 'Excluded Repository Paths'
  },
  agent: {
    maxTurns: 'Max Agent Steps',
    imageInputMode: 'Image Attachments',
    apiMaxRetries: 'API Retries',
    serviceTier: 'Service Tier',
    toolUseEnforcement: 'Tool-Use Enforcement'
  },
  terminal: {
    cwd: 'Working Directory',
    backend: 'Execution Backend',
    timeout: 'Command Timeout',
    persistentShell: 'Persistent Shell',
    envPassthrough: 'Environment Passthrough',
    dockerImage: 'Docker Image',
    singularityImage: 'Singularity Image',
    modalImage: 'Modal Image',
    daytonaImage: 'Daytona Image'
  },
  fileReadMaxChars: 'File Read Limit',
  toolOutput: {
    maxBytes: 'Terminal Output Limit',
    maxLines: 'File Page Limit',
    maxLineLength: 'Line Length Limit'
  },
  codeExecution: {
    mode: 'Code Execution Mode'
  },
  approvals: {
    mode: 'Approval Mode',
    timeout: 'Approval Timeout',
    mcpReloadConfirm: 'Confirm MCP Reloads'
  },
  commandAllowlist: 'Command Allowlist',
  security: {
    redactSecrets: 'Redact Secrets',
    allowPrivateUrls: 'Allow Private URLs'
  },
  browser: {
    allowPrivateUrls: 'Browser Private URLs',
    autoLocalForPrivateUrls: 'Local Browser For Private URLs',
    useRealProfile: 'Use My Real Browser Profile'
  },
  checkpoints: {
    enabled: 'File Checkpoints',
    maxSnapshots: 'Checkpoint Limit'
  },
  memory: {
    memoryEnabled: 'Persistent Memory',
    userProfileEnabled: 'User Profile',
    memoryCharLimit: 'Memory Budget',
    userCharLimit: 'Profile Budget',
    provider: 'Memory Provider'
  },
  context: {
    engine: 'Context Engine'
  },
  compression: {
    enabled: 'Auto-Compression',
    threshold: 'Compression Threshold',
    targetRatio: 'Compression Target',
    protectLastN: 'Protected Recent Messages'
  },
  delegation: {
    model: 'Subagent Model',
    provider: 'Subagent Provider',
    maxIterations: 'Subagent Turn Limit',
    maxConcurrentChildren: 'Parallel Subagents',
    childTimeoutSeconds: 'Subagent Timeout',
    reasoningEffort: 'Subagent Reasoning Effort'
  },
  updates: {
    nonInteractiveLocalChanges: 'In-App Update Local Changes'
  }
})

export const FIELD_DESCRIPTIONS: Record<string, string> = defineFieldCopy({
  model: 'Used for new chats unless you pick a different model in the composer.',
  modelContextLength: "Leave at 0 to use the selected model's detected context window.",
  fallbackProviders: 'Backup provider:model entries to try if the default model fails.',
  display: {
    personality: 'Default assistant style for new sessions.',
    showReasoning: 'Show reasoning sections when the backend provides them.'
  },
  desktop: {
    repoScanEnabled: 'Scan local folders for Git repositories to show in Projects.',
    repoScanRoots: 'Folders to scan. Leave empty to scan your home directory.',
    repoScanExcludePaths: 'Folders and their descendants to skip during repository discovery.'
  },
  timezone: 'IANA timezone identifier. Blank uses the system timezone.',
  browser: {
    useRealProfile:
      "Local browsing uses your real logins. Fulilian copies your default browser's profile (cookies, logins, preferences) into a managed snapshot and drives it with its packaged Chromium — your live profile is never opened directly, and the copy is refreshed from it on each run. Also lets the agent open a local real-profile session on request even when a cloud browser backend is configured. Only Chromium browsers (Chrome, Edge, Brave, Chromium) are supported; a non-Chromium default fails with a clear message. Off by default."
  },
  agent: {
    imageInputMode: 'Controls how image attachments are sent to the model.',
    maxTurns: 'Upper bound for tool-calling turns before Fulilian stops a run.'
  },
  terminal: {
    cwd: 'Default project folder for tool and terminal work.',
    persistentShell: 'Keep shell state between commands when the backend supports it.',
    envPassthrough: 'Environment variables to pass into tool execution.',
    dockerImage: 'Container image used when the execution backend is Docker.',
    singularityImage: 'Image used when the execution backend is Singularity.',
    modalImage: 'Image used when the execution backend is Modal.',
    daytonaImage: 'Image used when the execution backend is Daytona.'
  },
  codeExecution: {
    mode: 'How strictly code execution is scoped to the current project.'
  },
  fileReadMaxChars: 'Maximum characters Fulilian can read from one file request.',
  approvals: {
    mode: 'How Fulilian handles commands that need explicit approval.',
    timeout: 'How long approval prompts wait before timing out.'
  },
  security: {
    redactSecrets: 'Hide detected secrets from model-visible content when possible.'
  },
  checkpoints: {
    enabled: 'Create rollback snapshots before file edits.'
  },
  memory: {
    memoryEnabled: 'Save durable memories that can help future sessions.',
    userProfileEnabled: 'Maintain a compact profile of user preferences.'
  },
  context: {
    engine: 'Strategy for managing long conversations near the context limit.'
  },
  compression: {
    enabled: 'Summarize older context when conversations get large.'
  },
  updates: {
    nonInteractiveLocalChanges:
      'When Fulilian updates itself from the app (no terminal prompt), keep local source edits (stash) or throw them away (discard). Terminal updates always ask.'
  }
})

// Curated desktop config surface: only fields a user might tune from the app.
// Grouping follows DESIGN_PROPOSAL §5.5 (six Workbench groups); ids and key
// lists are stable — placement and order are all that changed.
export const SECTIONS: DesktopConfigSection[] = [
  {
    group: 'basics',
    id: 'chat',
    label: 'Chat',
    icon: MessageCircle,
    keys: ['display.personality', 'timezone', 'display.show_reasoning', 'agent.image_input_mode']
  },
  {
    group: 'basics',
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    keys: []
  },
  {
    group: 'basics',
    id: 'workspace',
    label: 'Workspace',
    icon: Monitor,
    keys: [
      'terminal.cwd',
      'desktop.repo_scan_enabled',
      'desktop.repo_scan_roots',
      'desktop.repo_scan_exclude_paths',
      'code_execution.mode',
      'terminal.persistent_shell',
      'terminal.env_passthrough',
      'file_read_max_chars'
    ]
  },
  {
    group: 'model-capabilities',
    id: 'model',
    label: 'Model',
    icon: Box,
    keys: ['model_context_length', 'fallback_providers']
  },
  {
    group: 'model-capabilities',
    id: 'memory',
    label: 'Memory & Context',
    icon: Brain,
    keys: [
      'memory.memory_enabled',
      'memory.user_profile_enabled',
      'memory.memory_char_limit',
      'memory.user_char_limit',
      'memory.provider',
      'context.engine',
      'compression.enabled',
      'compression.threshold',
      'compression.target_ratio',
      'compression.protect_last_n'
    ]
  },
  {
    group: 'model-capabilities',
    id: 'browser',
    label: 'Browser',
    icon: Globe,
    keys: ['browser.use_real_profile', 'browser.allow_private_urls', 'browser.auto_local_for_private_urls']
  },
  {
    group: 'model-capabilities',
    id: 'advanced',
    label: 'Advanced',
    icon: Wrench,
    keys: [
      'toolsets',
      'terminal.backend',
      'terminal.timeout',
      'terminal.docker_image',
      'terminal.singularity_image',
      'terminal.modal_image',
      'terminal.daytona_image',
      'tool_output.max_bytes',
      'tool_output.max_lines',
      'tool_output.max_line_length',
      'checkpoints.max_snapshots',
      'agent.max_turns',
      'agent.api_max_retries',
      'agent.service_tier',
      'agent.tool_use_enforcement',
      'delegation.model',
      'delegation.provider',
      'delegation.max_iterations',
      'delegation.max_concurrent_children',
      'delegation.child_timeout_seconds',
      'delegation.reasoning_effort',
      'updates.non_interactive_local_changes'
    ]
  },
  {
    group: 'security-compliance',
    id: 'safety',
    label: 'Safety',
    icon: Lock,
    keys: [
      'approvals.mode',
      'approvals.timeout',
      'approvals.mcp_reload_confirm',
      'command_allowlist',
      'security.redact_secrets',
      'security.allow_private_urls',
      'checkpoints.enabled'
    ]
  }
]

// Workbench nav grouping (DESIGN_PROPOSAL §5.5): each group lists its nav
// views in display order — `config:*` ids resolve through SECTIONS, the rest
// are page-level views rendered by the settings shell.
export interface SettingsGroupDef {
  id: SettingsGroupId
  views: SettingsView[]
}

export const SETTINGS_GROUPS: SettingsGroupDef[] = [
  {
    id: 'basics',
    views: ['config:chat', 'config:appearance', 'notifications', 'keybinds', 'tray', 'config:workspace']
  },
  { id: 'agent', views: ['submodels', 'profiles'] },
  {
    id: 'model-capabilities',
    views: ['config:model', 'providers', 'config:memory', 'config:browser', 'config:advanced']
  },
  { id: 'security-compliance', views: ['config:safety', 'approvals'] },
  { id: 'connection-data', views: ['keys', 'gateway', 'sessions', 'billing'] },
  { id: 'apps', views: ['plugins', 'presets', 'about', 'pet', 'quick-entry'] }
]

// Group header copy. Every group id in `SETTINGS_GROUPS` has a matching
// `settings.group.*` entry in all five locales, so this is a plain lookup —
// no fallback needed (the `agent` group used to borrow the sidebar's label
// before its own key landed in P1).
export interface SettingsGroupLabelSource {
  settings: { group: Partial<Record<SettingsGroupId, string>> }
}

export function settingsGroupLabel(group: SettingsGroupId, t: SettingsGroupLabelSource): string {
  return t.settings.group[group] ?? group
}

// Every view the shell can render, derived from the group table so the rail,
// the narrow dropdown and the deep-link enum can never drift apart. The legacy
// `connections` alias stays resolvable (redirected to gateway by the shell) but
// has no nav row of its own.
export const SETTINGS_VIEWS: readonly SettingsView[] = [...SETTINGS_GROUPS.flatMap(group => group.views), 'connections']

// Where a bare `/settings` lands. Unchanged by the URL params work — the shell
// falls back here whenever neither `?tab=` nor `?section=` names a view.
export const DEFAULT_SETTINGS_VIEW: SettingsView = 'config:model'

// `?section=` spellings whose name differs from the view id they address.
// Deliberately tiny: anything not listed here resolves by identity (a nav view
// id) or by prefixing a SECTIONS id with `config:`. Never a second section
// table — the ids themselves come from SETTINGS_GROUPS / SECTIONS above.
const SECTION_PARAM_ALIASES: Record<string, SettingsView> = {
  // QA/docs write the plural for the Model section; the SECTIONS id is `model`.
  models: 'config:model'
}

// Resolve a `?section=` deep-link value to a nav view, or null when the value
// names nothing (the caller then falls back to `?tab=` / the default view
// instead of rendering a blank pane). Accepted forms:
//   1. a nav view id            — approvals, submodels, config:model, …
//   2. a bare SECTIONS id       — model, appearance, workspace, … → config:<id>
//   3. the documented aliases   — models → config:model
export function settingsViewFromSection(raw: string | null | undefined): SettingsView | null {
  if (!raw) {
    return null
  }

  if ((SETTINGS_VIEWS as readonly string[]).includes(raw)) {
    return raw as SettingsView
  }

  if (SECTION_PARAM_ALIASES[raw]) {
    return SECTION_PARAM_ALIASES[raw]
  }

  if (SECTIONS.some(section => section.id === raw)) {
    return `config:${raw}` as SettingsView
  }

  return null
}

export interface ModeOption {
  id: ThemeMode
  label: string
  icon: IconComponent
}

export const MODE_OPTIONS: ModeOption[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor }
]
