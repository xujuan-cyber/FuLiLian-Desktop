import { type ChatMessage, messageVisibility } from '@/lib/chat-messages'

export type ThreadLoadingState = 'response' | 'session'

export function lastVisibleMessageIsUser(messages: ChatMessage[]): boolean {
  // Allocation-free reverse scan — runs in a hot $messages computed. The
  // visibility judgment lives in the projection module; messageVisibility is
  // allocation-free by contract, so the scan stays allocation-free too.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const visibility = messageVisibility(messages[i])

    if (visibility !== 'hiddenSynthetic') {
      return visibility === 'realUser'
    }
  }

  return false
}

export function threadLoadingState(
  loadingSession: boolean,
  busy: boolean,
  awaitingResponse: boolean,
  lastVisibleIsUser: boolean
): ThreadLoadingState | undefined {
  if (loadingSession) {
    return 'session'
  }

  if (busy && awaitingResponse && lastVisibleIsUser) {
    return 'response'
  }

  return undefined
}
