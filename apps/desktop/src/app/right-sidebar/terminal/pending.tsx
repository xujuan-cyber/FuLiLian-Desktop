import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import type { TerminalEntry } from './terminals'

/** Same stacking contract as TerminalInstance: absolute, only the active tab
 *  is visible, inactive tabs keep their layout box. */
const INSTANCE_CLASS = 'absolute inset-0 flex flex-col bg-(--ui-terminal-surface-background) px-2 pb-2 pt-0'

interface PendingTerminalInstanceProps {
  active: boolean
  onResume: () => void
  term: TerminalEntry
}

/**
 * Placeholder for a RESTORED WSL tab (R-3 / N1) whose PTY was deliberately not
 * rebuilt at launch. It holds the tab's place in the workspace — same geometry
 * as a live instance, so switching tabs doesn't relayout — and owns the
 * "restore" affordance. Nothing here spawns a process; only `onResume` clears
 * the pause, after which the workspace mounts the real TerminalInstance.
 */
export function PendingTerminalInstance({ active, onResume, term }: PendingTerminalInstanceProps) {
  const { t } = useI18n()

  return (
    <div
      className={cn(INSTANCE_CLASS, active ? 'visible' : 'invisible pointer-events-none')}
      data-terminal=""
      data-terminal-pending=""
    >
      <div className="grid h-full place-items-center">
        <div className="flex max-w-sm flex-col items-center gap-1.5 px-6 text-center">
          <Codicon className="text-(--ui-text-tertiary)" name="debug-pause" size="1.25rem" />
          <p className="text-xs font-medium text-(--ui-text-secondary)">
            {t.rightSidebar.terminalRestoreTitle}
            {term.wsl ? ` · ${term.wsl.cli} @ ${term.wsl.distro}` : ''}
          </p>
          <p className="text-[0.68rem] leading-relaxed text-(--ui-text-tertiary)">
            {t.rightSidebar.terminalRestoreDesc}
          </p>
          <Button className="mt-1 h-7 rounded-md px-2.5 text-[0.7rem]" onClick={onResume} type="button" variant="secondary">
            {t.rightSidebar.terminalRestoreAction}
          </Button>
        </div>
      </div>
    </div>
  )
}
