import type { Dispatch, SetStateAction } from 'react'

import type { FulilianGateway } from '@/fulilian'
import type { IconComponent } from '@/lib/icons'
import type { EnvVarInfo } from '@/types/fulilian'

export type SettingsView =
  | 'about'
  | 'approvals'
  | 'audit'
  | 'billing'
  | 'connections'
  | 'ctf'
  | 'evidence-protection'
  | 'forensics'
  | 'gateway'
  | 'keybinds'
  | 'keys'
  | 'notifications'
  | 'pet'
  | 'plugins'
  | 'presets'
  | 'providers'
  | 'quick-entry'
  | 'sensitive-info'
  | 'sessions'
  | `config:${string}`

// The six Workbench groups (DESIGN_PROPOSAL §5.5). Pure re-grouping: section
// ids are stable, only placement and order change.
export type SettingsGroupId =
  | 'apps'
  | 'basics'
  | 'connection-data'
  | 'model-capabilities'
  | 'security-compliance'
  | 'work-mode'
export type EnvPatch = Partial<Pick<EnvVarInfo, 'is_set' | 'redacted_value'>>

export interface SettingsPageProps {
  gateway?: FulilianGateway | null
  onClose: () => void
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
}

export interface ProviderGroup {
  name: string
  priority: number
  entries: [string, EnvVarInfo][]
  hasAnySet: boolean
}

export interface DesktopConfigSection {
  group: SettingsGroupId
  id: string
  label: string
  icon: IconComponent
  keys: string[]
}

export interface EnvRowProps {
  varKey: string
  info: EnvVarInfo
  edits: Record<string, string>
  revealed: Record<string, string>
  saving: string | null
  setEdits: Dispatch<SetStateAction<Record<string, string>>>
  onSave: (key: string) => void
  onClear: (key: string) => void
  onReveal: (key: string) => void
  compact?: boolean
}
