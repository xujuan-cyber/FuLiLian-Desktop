import type { ReactNode } from 'react'

import type { SubmitTextOptions } from '@/app/session/hooks/use-prompt-actions/utils'
import type { FulilianGateway } from '@/fulilian'

import type { DroppedFile } from '../hooks/use-composer-actions'

export interface ContextSuggestion {
  text: string
  display: string
  meta?: string
}

export interface QuickModelOption {
  provider: string
  providerName: string
  model: string
}

export interface ChatBarState {
  model: {
    model: string
    provider: string
    canSwitch: boolean
    loading?: boolean
    quickModels?: QuickModelOption[]
    /** Reused status-bar dropdown (built with gateway + selectModel upstream). */
    modelMenuContent?: ReactNode
  }
  tools: { enabled: boolean; label: string; suggestions?: ContextSuggestion[] }
  voice: { enabled: boolean; active: boolean }
}

export interface ChatBarProps {
  busy: boolean
  disabled: boolean
  focusKey?: string | null
  /** Where this bar lives (step 20 · v3 §8.3/§8.5).
   *  - `docked` (default): the session composer — absolutely positioned at the
   *    bottom of the chat column, reserving scroll clearance via the measured
   *    height vars.
   *  - `inline`: the empty-state card in the intro flow — static, full column
   *    width, no bottom mask, no measured clearance. Mounting is the caller's
   *    job; the bar itself changes nothing but presentation. */
  variant?: 'docked' | 'inline'
  maxRecordingSeconds?: number
  state: ChatBarState
  gateway?: FulilianGateway | null
  queueSessionKey?: string | null
  sessionId?: string | null
  cwd?: string | null
  onCancel: () => Promise<void> | void
  onAddContextRef?: (refText: string, label?: string, detail?: string) => void
  onAddUrl?: (url: string) => void
  onAttachImageBlob?: (blob: Blob) => Promise<boolean | void> | boolean | void
  onAttachDroppedItems?: (candidates: DroppedFile[]) => Promise<boolean | void> | boolean | void
  /** Pasted GitHub PR-comment deep link → structured review attachment.
   *  Returns true when the paste was consumed as an attachment. */
  onAttachPrCommentUrl?: (url: string) => boolean
  onPasteClipboardImage?: (opts?: { silent?: boolean }) => Promise<boolean> | void
  onPickFiles?: () => void
  onPickFolders?: () => void
  onPickImages?: () => void
  onRemoveAttachment?: (id: string) => void
  onSteer?: (text: string) => Promise<boolean> | boolean
  onSubmit: (value: string, options?: SubmitTextOptions) => Promise<boolean> | boolean
  onTranscribeAudio?: (audio: Blob) => Promise<string>
}

export type VoiceStatus = 'idle' | 'recording' | 'transcribing'

export interface VoiceActivityState {
  elapsedSeconds: number
  level: number
  status: VoiceStatus
}
