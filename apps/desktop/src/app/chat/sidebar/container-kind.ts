import type { SessionInfo } from '@/fulilian'

/** The three work-mode containers of the sidebar (DESIGN_PROPOSAL §4.1):
 *  forensics cases, CTF challenges, and plain project work. */
export type ContainerKind = 'ctf' | 'forensics' | 'project'

/** Which container a session belongs to. The kind metadata has NO data layer
 *  this round (`src/store/` is out of scope, DESIGN_PROPOSAL §4.1 persists it
 *  with the session) — every existing session is a project by the §4.1
 *  default. The forensics/CTF groups therefore render as static structure with
 *  honest empty states until the kind column lands; this single lookup is the
 *  seam they will switch on. */
export const sessionContainerKind = (_session?: SessionInfo): ContainerKind => 'project'

/** Which filter a container kind answers to in the kind chips row. */
export type ContainerKindFilter = 'all' | ContainerKind

export const CONTAINER_KIND_FILTERS = ['all', 'forensics', 'ctf', 'project'] as const

/** Group visibility under a kind filter: `all` shows everything, a concrete
 *  kind narrows the sidebar to its own container. Pure so tests (and the
 *  honest-empty-state assertions) can drive it without a sidebar mount. */
export function kindGroupsVisible(filter: ContainerKindFilter): { ctf: boolean; forensics: boolean; project: boolean } {
  if (filter === 'all') {
    return { ctf: true, forensics: true, project: true }
  }

  return { ctf: filter === 'ctf', forensics: filter === 'forensics', project: filter === 'project' }
}
