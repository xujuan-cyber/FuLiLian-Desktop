import { useStore } from '@nanostores/react'

import { Codicon } from '@/components/ui/codicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip, TipHintLabel } from '@/components/ui/tooltip'
import type { WslCliName } from '@/global'
import { useI18n } from '@/i18n'
import { formatCombo } from '@/lib/keybinds/combo'
import { isMetaClose, middleClickHandlers } from '@/lib/middle-click'
import { cn } from '@/lib/utils'
import { $bindings } from '@/store/keybinds'
import { $wslCliDistro, $wslCliEnabledClis, $wslCliProbe, selectWslCli, selectWslCliDistro, type WslCliTarget } from '@/store/wsl-cli'

import { setTerminalTakeover } from '../store'

import {
  $activeTerminal,
  $activeTerminalId,
  $terminals,
  closeAllTerminals,
  closeOtherTerminals,
  closeTerminal,
  createTerminal,
  selectTerminal,
  setTerminalWslCli,
  type TerminalEntry
} from './terminals'

const RAIL_ACTION =
  'grid size-6 place-items-center rounded text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground focus-visible:bg-(--chrome-action-hover) focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring [-webkit-app-region:no-drag]'

/** Thin icon "bookmark" strip blended into the terminal surface, shown whenever a
 *  terminal exists. Each square is a tab (name + hotkey on hover); close via the
 *  shell's `exit`, middle-click, or the context menu. */
export function TerminalRail() {
  const { t } = useI18n()
  const terminals = useStore($terminals)
  const activeId = useStore($activeTerminalId)
  const activeTerminal = useStore($activeTerminal)
  const enabledClis = useStore($wslCliEnabledClis)
  const probe = useStore($wslCliProbe)
  const distroPref = useStore($wslCliDistro)
  const bindings = useStore($bindings)
  const toggleHint = bindings['view.showTerminal']?.[0]
  const newHint = bindings['view.newTerminal']?.[0]
  const currentCli = activeTerminal?.wsl?.cli ?? 'local'
  const distros = probe?.distros ?? []
  const currentDistro = activeTerminal?.wsl?.distro ?? distroPref ?? probe?.distro ?? ''

  // The switcher re-targets the ACTIVE tab only. The workspace keys each
  // instance on its CLI, so the tab's PTY is re-created inside WSL by remount
  // (and re-created again when the same CLI is picked in another distro, since
  // the `wsl` prop itself is in the mount effect's deps).
  function switchCli(value: string) {
    if (!activeTerminal) {
      return
    }

    const distro = currentDistro

    const target: null | WslCliTarget =
      value === 'local' ? null : distro ? { cli: value as WslCliName, distro } : null

    if (value !== 'local' && !target) {
      return
    }

    setTerminalWslCli(activeTerminal.id, target)
    selectWslCli(target)
  }

  // The distro picker only re-targets an existing CLI tab. On the local shell it
  // merely records the preference, so picking a distro never forces a tab into
  // WSL; the next CLI pick then lands in that distro.
  function switchDistro(distro: string) {
    selectWslCliDistro(distro)

    const cli = activeTerminal?.wsl?.cli

    if (!activeTerminal || !cli) {
      return
    }

    const target: WslCliTarget = { cli, distro }

    setTerminalWslCli(activeTerminal.id, target)
    selectWslCli(target)
  }

  return (
    <div
      className="group/rail relative z-40 flex h-full w-9 shrink-0 flex-col items-center border-l border-(--ui-stroke-quaternary) bg-(--ui-terminal-surface-background)"
      // The rail sits at the pane's outer edge, under the collapsed sidebars'
      // hover-reveal triggers; mark it so those triggers go pointer-transparent
      // while it's hovered (see the suppression rules in styles.css) and a reach
      // for a tab can't drag in the file-browser/review panel.
      data-suppress-pane-reveal=""
    >
      <ul
        aria-label={t.rightSidebar.terminalsAria}
        className="flex min-h-0 flex-1 flex-col items-center gap-0.5 self-stretch overflow-y-auto overflow-x-hidden overscroll-contain py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {terminals.map((term, index) => (
          <TerminalRailItem
            active={term.id === activeId}
            canCloseOthers={terminals.length > 1}
            index={index}
            key={term.id}
            term={term}
            toggleHint={toggleHint}
          />
        ))}
        <li className="flex w-full justify-center">
          <Tip
            label={<TipHintLabel hint={newHint && formatCombo(newHint)} text={t.rightSidebar.terminalNew} />}
            side="left"
          >
            <button
              aria-label={t.rightSidebar.terminalNew}
              className={cn(RAIL_ACTION, 'size-7 text-(--ui-text-quaternary)')}
              onClick={() => createTerminal()}
              type="button"
            >
              <Codicon name="add" size="0.8125rem" />
            </button>
          </Tip>
        </li>
      </ul>

      <div className="flex shrink-0 flex-col items-center gap-0.5 pb-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`${t.rightSidebar.wslCliSwitcher}: ${currentCli}`}
              className={cn(RAIL_ACTION, 'size-7')}
              type="button"
            >
              <Codicon name="vm-active" size="0.8125rem" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40" side="left">
            <DropdownMenuLabel>{t.rightSidebar.wslCliMenuLabel}</DropdownMenuLabel>
            <DropdownMenuRadioGroup onValueChange={switchCli} value={currentCli}>
              <DropdownMenuRadioItem value="local">{t.rightSidebar.wslCliLocal}</DropdownMenuRadioItem>
              {enabledClis.map(cli => (
                <DropdownMenuRadioItem key={cli} value={cli}>
                  {cli}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {/* A second level only earns its place when the probe found a real
                choice; a single-distro machine sees the menu exactly as before. */}
            {distros.length > 1 ? (
              <>
                <DropdownMenuLabel>{t.rightSidebar.wslCliDistroLabel}</DropdownMenuLabel>
                <DropdownMenuRadioGroup onValueChange={switchDistro} value={currentDistro}>
                  {distros.map(distro => (
                    <DropdownMenuRadioItem key={distro} value={distro}>
                      {distro}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <Tip label={t.rightSidebar.terminalHide} side="left">
          <button
            aria-label={t.rightSidebar.terminalHide}
            className={cn(RAIL_ACTION, 'opacity-0 transition-opacity group-hover/rail:opacity-100')}
            onClick={() => setTerminalTakeover(false)}
            type="button"
          >
            <Codicon name="chevron-down" size="0.8125rem" />
          </button>
        </Tip>
      </div>
    </div>
  )
}

interface TerminalRailItemProps {
  active: boolean
  canCloseOthers: boolean
  index: number
  term: TerminalEntry
  toggleHint?: string
}

function TerminalRailItem({ active, canCloseOthers, index, term, toggleHint }: TerminalRailItemProps) {
  const { t } = useI18n()
  const label = `${index + 1}. ${term.title}`

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li className="relative flex w-full justify-center [-webkit-app-region:no-drag]">
          {active && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0.5 right-0 w-0.5 rounded-l-sm bg-(--ui-stroke-primary)"
            />
          )}
          <Tip label={<TipHintLabel hint={toggleHint && formatCombo(toggleHint)} text={label} />} side="left">
            <button
              aria-label={label}
              aria-selected={active}
              className={cn(
                'grid size-7 place-items-center rounded-md transition-colors',
                active
                  ? 'bg-(--chrome-action-hover) text-foreground'
                  : 'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
              )}
              {...middleClickHandlers(() => closeTerminal(term.id))}
              // ⌘-click closes (the pane-tab gesture); a plain click selects.
              onClick={event => (isMetaClose(event) ? closeTerminal(term.id) : selectTerminal(term.id))}
              role="tab"
              type="button"
            >
              <Codicon
                className={cn(term.kind === 'agent' && !active && 'text-primary')}
                name={term.kind === 'agent' ? 'agent' : 'terminal'}
                size="0.875rem"
              />
            </button>
          </Tip>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => closeTerminal(term.id)}>{t.common.close}</ContextMenuItem>
        <ContextMenuItem disabled={!canCloseOthers} onSelect={() => closeOtherTerminals(term.id)}>
          {t.rightSidebar.terminalCloseOthers}
        </ContextMenuItem>
        <ContextMenuItem onSelect={closeAllTerminals}>{t.rightSidebar.terminalCloseAll}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => setTerminalTakeover(false)}>{t.rightSidebar.terminalHide}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
