import { StatusDot } from '@/components/status-dot'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { kindGroupsVisible, type ContainerKindFilter } from './container-kind'

// Kind markers ride the StatusDot primitive's 6px geometry; the color is the
// mode color, not a status (DESIGN_PROPOSAL §2 原则 5 — 模式色只做 6px 点与
// 10.5px 徽标). Forensics=info blue, CTF=accentBright orange; the whitelist
// covers the CTF mode marker, and one sidebar shows one of each at most.
const KIND_DOT: Record<'ctf' | 'forensics', string> = {
  ctf: 'bg-accent-bright',
  forensics: 'bg-info'
}

// Group-header badge typography: 10.5px per the §4.3 wireframe.
const KIND_BADGE = 'text-[10.5px] font-medium leading-none text-(--ui-text-secondary)'

interface SidebarKindGroupsProps {
  filter: ContainerKindFilter
}

/**
 * FORENSICS / CTF CONTAINER GROUPS — the two work-mode sections of the
 * sidebar (§4.3 wireframe), above the project content. The kind metadata has
 * no data layer yet, so both render as static structure with an HONEST empty
 * state: no fabricated case numbers, no synthetic challenge rows. The group
 * header is real (it is where §4.3's kind badge lives); the body says
 * plainly that there is nothing to list. Tests assert the honesty — a row
 * appearing here without a kind column in the store is a bug.
 */
export function SidebarKindGroups({ filter }: SidebarKindGroupsProps) {
  const { t } = useI18n()
  const g = t.sidebar.kind
  const visible = kindGroupsVisible(filter)

  if (!visible.ctf && !visible.forensics) {
    return null
  }

  const group = (kind: 'ctf' | 'forensics') => (
    <div className="shrink-0" data-container-kind={kind}>
      <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1.5">
        <StatusDot aria-hidden="true" className={cn('shrink-0', KIND_DOT[kind])} />
        <span className={KIND_BADGE}>{kind === 'forensics' ? g.forensics : g.ctf}</span>
      </div>
      <div
        className="px-2 py-1 text-[0.75rem] leading-[1.35] text-(--ui-text-quaternary)"
        data-testid={`sidebar-kind-empty-${kind}`}
      >
        {kind === 'forensics' ? g.forensicsEmpty : g.ctfEmpty}
      </div>
    </div>
  )

  return (
    <>
      {visible.forensics && group('forensics')}
      {visible.ctf && group('ctf')}
    </>
  )
}
