import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { $backgroundStatusBySession } from '@/store/composer-status'
import { $terminalShellEnvSide } from '@/store/terminal-shell'

import { seedAgentTerminalCommand, syncAgentTerminalSnapshot } from './agent-terminal-stream'
import { setActiveTerminalId } from './buffer'
import { AgentTerminalInstance, TerminalInstance } from './instance'
import { PendingTerminalInstance } from './pending'
import { $activeTerminalId, $terminals, ensureAgentTerminal, resumeTerminal } from './terminals'

interface TerminalWorkspaceProps {
  onAddSelectionToChat: (text: string, label?: string) => void
}

/** The persistent-overlay layer: the stack of live xterm instances (only these
 *  must stay in the fixed overlay, for the WebGL host). Mount/visibility is owned
 *  by PersistentTerminal (latched so shells survive hiding); the tab rail and
 *  new-terminal control live in the pane DOM — see TerminalPaneChrome. */
export function TerminalWorkspace({ onAddSelectionToChat }: TerminalWorkspaceProps) {
  const terminals = useStore($terminals)
  const activeId = useStore($activeTerminalId)
  const background = useStore($backgroundStatusBySession)
  // N1/R-3: on the Windows side a restored WSL tab stays paused (no PTY) until
  // the user asks for it. On an explicit `wsl` side it may rebuild eagerly.
  const envSide = useStore($terminalShellEnvSide)

  // Mirror the tab selection into the agent reader (read_terminal reads it).
  useEffect(() => {
    const unsubscribe = $activeTerminalId.subscribe(setActiveTerminalId)

    return () => {
      unsubscribe()
      setActiveTerminalId(null)
    }
  }, [])

  // Surface the agent's background processes as read-only tabs (once each).
  // Live chunks stream via agent.terminal.output; the process-list snapshot also
  // seeds/falls back so the tab never stays blank if the stream races startup.
  useEffect(() => {
    for (const list of Object.values(background)) {
      for (const item of list) {
        ensureAgentTerminal(item.id, item.title)
        seedAgentTerminalCommand(item.id, item.title)
        syncAgentTerminalSnapshot(item.id, item.output ?? '')
      }
    }
  }, [background])

  return (
    <>
      {terminals.map(term => {
        if (term.kind === 'agent') {
          return <AgentTerminalInstance active={term.id === activeId} id={term.id} key={term.id} procId={term.procId!} />
        }

        // R-3: paused restored WSL tab — render the placeholder, never the
        // instance, so no PTY (and no wsl.exe) is created before the click.
        if (term.wsl && term.resumePending && envSide === 'windows') {
          return (
            <PendingTerminalInstance
              active={term.id === activeId}
              key={`${term.id}:paused`}
              onResume={() => resumeTerminal(term.id)}
              term={term}
            />
          )
        }

        return (
          <TerminalInstance
            active={term.id === activeId}
            cwd={term.cwd}
            id={term.id}
            // The key carries the tab's CLI: switching it remounts the instance,
            // whose cleanup disposes the old PTY and whose mount replays
            // reviveBuffer into the fresh session.
            key={`${term.id}:${term.wsl?.cli ?? 'local'}`}
            onAddSelectionToChat={onAddSelectionToChat}
            restoreCwd={term.restoreCwd}
            reviveBuffer={term.reviveBuffer}
            wsl={term.wsl}
          />
        )
      })}
    </>
  )
}
