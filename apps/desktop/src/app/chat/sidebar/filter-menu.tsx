import { useStore } from '@nanostores/react'

import { sessionDotClassName } from '@/app/chat/session-status-dot'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { desktopGit } from '@/lib/desktop-git'
import { cn } from '@/lib/utils'
import {
  $sidebarCardRows,
  $sidebarFiltersActive,
  $sidebarGrouping,
  $sidebarOrdering,
  $sidebarPrFilter,
  $sidebarProfileFilter,
  $sidebarProjectFilter,
  $sidebarRowMeta,
  $sidebarShowArchived,
  $sidebarStatusFilter,
  $sidebarViewCustomized,
  $sidebarWorkspaceNodeOpen,
  resetSidebarView,
  setSidebarCardRows,
  setSidebarGrouping,
  setSidebarOrdering,
  setSidebarShowArchived,
  setWorkspaceNodesOpen,
  type SidebarGrouping,
  type SidebarOrdering,
  type SidebarRowMeta,
  toggleSidebarPrFilter,
  toggleSidebarProfileFilter,
  toggleSidebarProjectFilter,
  toggleSidebarRowMeta,
  toggleSidebarStatusFilter
} from '@/store/layout'
import {
  $profiles,
  $showAllProfiles,
  normalizeProfileKey,
  requestProfileCreate,
  toggleShowAllProfiles
} from '@/store/profile'
import { runImportProfileFlow } from '@/store/profile-share'
import { $projectTree } from '@/store/projects'
import type { PullRequestBucket } from '@/store/pull-requests'
import { $unreadFinishedSessionIds, markAllSessionsRead } from '@/store/session'
import type { SessionStatusBucket } from '@/store/session-dot-state'
import { $sessionsHaveCost } from '@/store/sidebar-archive'

import { CONTAINER_KIND_FILTERS, type ContainerKindFilter } from './container-kind'

interface Option<T extends string = string> {
  /** A status dot's full className, from the row's own vocabulary. */
  dot?: string
  icon?: string
  id: T
  label: string
}

// Labels resolve from `sidebar.filterMenu` at render time — the option tables
// stay key-only so the five-locale files own every user-visible word.
type FilterMenuCopy = Record<string, string>

const GROUPINGS: Pick<Option<SidebarGrouping>, 'icon' | 'id'>[] = [
  { icon: 'clock', id: 'date' },
  { icon: 'root-folder', id: 'project' },
  { icon: 'pulse', id: 'status' },
  { icon: 'account', id: 'profile' }
]

const ORDERINGS: Pick<Option<SidebarOrdering>, 'icon' | 'id'>[] = [
  { icon: 'clock', id: 'updated' },
  { icon: 'add', id: 'created' },
  { icon: 'pulse', id: 'status' },
  { icon: 'symbol-numeric', id: 'tokens' },
  { icon: 'credit-card', id: 'cost' },
  { icon: 'list-ordered', id: 'manual' }
]

const ROW_META: Pick<Option<SidebarRowMeta>, 'icon' | 'id'>[] = [
  { icon: 'clock', id: 'updated' },
  { icon: 'comment', id: 'preview' },
  { icon: 'symbol-numeric', id: 'tokens' },
  { icon: 'credit-card', id: 'cost' },
  { icon: 'git-pull-request', id: 'pr' },
  { icon: 'account', id: 'profile' }
]

const PR_FILTERS: Pick<Option<PullRequestBucket>, 'icon' | 'id'>[] = [
  { icon: 'git-pull-request', id: 'open' },
  { icon: 'git-pull-request-draft', id: 'draft' },
  { icon: 'git-merge', id: 'merged' },
  { icon: 'git-pull-request-closed', id: 'closed' },
  { icon: 'circle-slash', id: 'none' }
]

const STATUS_FILTERS: Pick<Option<SessionStatusBucket>, 'dot' | 'id'>[] = [
  { dot: sessionDotClassName('needs-input'), id: 'needs-input' },
  { dot: sessionDotClassName('working'), id: 'working' },
  { dot: sessionDotClassName('unread'), id: 'unread' },
  { dot: sessionDotClassName('draft'), id: 'draft' },
  { dot: cn(sessionDotClassName('idle'), 'bg-(--ui-text-quaternary)'), id: 'idle' }
]

function OptionGlyph({ option }: { option: Option }) {
  if (option.dot) {
    return <span aria-hidden="true" className={cn('shrink-0', option.dot)} />
  }

  return option.icon ? <Codicon className="text-(--ui-text-tertiary)" name={option.icon} size="0.8125rem" /> : null
}

/** Every option row — single or multi select — leaves the menu open, so a whole
 *  view can be set up in one pass. Only the actions at the bottom dismiss it. */
const keepOpen = (event: Event) => event.preventDefault()

function OptionCheckbox({ checked, onCheck, option }: { checked: boolean; onCheck: () => void; option: Option }) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onSelect={event => {
        keepOpen(event)
        onCheck()
      }}
    >
      <OptionGlyph option={option} />
      {option.label}
    </DropdownMenuCheckboxItem>
  )
}

function OptionRadio({ option }: { option: Option }) {
  return (
    <DropdownMenuRadioItem onSelect={keepOpen} value={option.id}>
      <OptionGlyph option={option} />
      {option.label}
    </DropdownMenuRadioItem>
  )
}

/** The kind chips row (§4.3 wireframe: 全部|取证|CTF|项目). The kind metadata
 *  has no data layer yet, so the two work-mode chips narrow the sidebar to
 *  their (honestly empty) container groups — see container-groups.tsx. Local
 *  state lives in the ChatSidebar; it is a view filter, not a persisted view. */
export function SidebarKindFilterRow({
  onChange,
  value
}: {
  onChange: (filter: ContainerKindFilter) => void
  value: ContainerKindFilter
}) {
  const { t } = useI18n()
  const k = t.sidebar.kind

  const copy: Record<ContainerKindFilter, string> = {
    all: k.all,
    ctf: k.ctf,
    forensics: k.forensics,
    project: k.project
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5 px-2 pb-1" data-testid="sidebar-kind-filter" role="radiogroup">
      {CONTAINER_KIND_FILTERS.map(id => {
        const active = value === id

        return (
          <button
            aria-checked={active}
            aria-label={copy[id]}
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[0.65rem] leading-none transition-colors duration-100 ease-out',
              active
                ? 'bg-(--ui-control-active-background) text-foreground'
                : 'text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground'
            )}
            key={id}
            onClick={() => onChange(id as ContainerKindFilter)}
            role="radio"
            type="button"
          >
            {copy[id]}
          </button>
        )
      })}
    </div>
  )
}

export function SidebarFilterMenu({ className }: { className?: string }) {
  const { t } = useI18n()
  const fm: FilterMenuCopy = t.sidebar.filterMenu
  const grouping = useStore($sidebarGrouping)
  const ordering = useStore($sidebarOrdering)
  const rowMeta = useStore($sidebarRowMeta)
  const cardRows = useStore($sidebarCardRows)
  const statusFilter = useStore($sidebarStatusFilter)
  const projectFilter = useStore($sidebarProjectFilter)
  const profileFilter = useStore($sidebarProfileFilter)
  const showAllProfiles = useStore($showAllProfiles)
  const profileNames = useStore($profiles).map(profile => normalizeProfileKey(profile.name))
  const narrowsByProfile = showAllProfiles && profileNames.length > 1
  const prFilter = useStore($sidebarPrFilter)
  const showArchived = useStore($sidebarShowArchived)
  const filtersActive = useStore($sidebarFiltersActive)
  const viewCustomized = useStore($sidebarViewCustomized)
  const nodeOpen = useStore($sidebarWorkspaceNodeOpen)
  const projects = useStore($projectTree)
  const hasCost = useStore($sessionsHaveCost)
  const unreadIds = useStore($unreadFinishedSessionIds)
  // PR state comes from `gh` on whichever machine holds the checkout — Electron
  // locally, the gateway's REST mirror remotely. Resolved per render, not once
  // at module load: switching to a remote profile swaps the bridge underneath.
  const prAvailable = Boolean(desktopGit()?.review?.prList)
  // Project rows default open, so "all collapsed" means every one of them has
  // been explicitly shut.
  const projectsCollapsed = projects.length > 0 && projects.every(project => nodeOpen[project.id] === false)

  const label = (key: string): string => fm[key] ?? key

  const withLabel = <T extends string>(option: Pick<Option<T>, 'icon' | 'id' | 'dot'>): Option<T> => ({
    ...option,
    label: label(option.id)
  })

  const groupingLabel = label(grouping)

  // Two options are conditional: dragging a row is what picks manual, so it
  // only appears as a way back out once there's a hand-picked order to leave;
  // and cost is hidden until some session actually reports spend.
  const orderings = ORDERINGS.filter(option => {
    if (option.id === 'manual') {
      return ordering === 'manual'
    }

    return option.id !== 'cost' || hasCost || ordering === 'cost'
  })

  const rowMetaOptions = ROW_META.filter(option => {
    if (option.id === 'cost') {
      return hasCost || rowMeta.includes('cost')
    }

    // Preview is a card line; the one-line row has nowhere to put it.
    if (option.id === 'preview') {
      return cardRows
    }

    return option.id !== 'pr' || prAvailable
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={fm.title}
          className={cn(
            className,
            'data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground data-[state=open]:opacity-100',
            // Active filters read as "this control is engaged", the same way the
            // open menu does — never as an accent, which the sidebar reserves
            // for a session that is actually doing something.
            filtersActive && 'bg-(--ui-control-active-background) text-foreground opacity-100'
          )}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Codicon name="list-filter" size="0.75rem" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger hideChevron>
              {fm.grouping}
              <span className="ml-auto flex items-center gap-1 pl-4 text-(--ui-text-tertiary)">
                {groupingLabel}
                <Codicon name="chevron-right" size="1rem" />
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={value => setSidebarGrouping(value as SidebarGrouping)}
                value={grouping}
              >
                {GROUPINGS.map(option => (
                  <OptionRadio key={option.id} option={withLabel(option)} />
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{fm.ordering}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={value => setSidebarOrdering(value as SidebarOrdering)}
                value={ordering}
              >
                {orderings.map(option => (
                  <OptionRadio key={option.id} option={withLabel(option)} />
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{fm.show}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {rowMetaOptions.map(option => (
                <OptionCheckbox
                  checked={rowMeta.includes(option.id)}
                  key={option.id}
                  onCheck={() => toggleSidebarRowMeta(option.id)}
                  option={withLabel(option)}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* A render variant, not a grouping: three-line cards (project · age /
              title / model · size) compose with whichever grouping is active. */}
          <OptionCheckbox
            checked={cardRows}
            onCheck={() => setSidebarCardRows(!cardRows)}
            option={{ icon: 'inbox', id: 'card-rows', label: fm.inboxStyle }}
          />
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>{fm.filters}</DropdownMenuLabel>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{fm.filterStatus}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {STATUS_FILTERS.map(option => (
                <OptionCheckbox
                  checked={statusFilter.includes(option.id)}
                  key={option.id}
                  onCheck={() => toggleSidebarStatusFilter(option.id)}
                  option={{ dot: option.dot, id: option.id, label: label(option.id) }}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* `gh` only exists where the checkout does, so on a remote backend
              this submenu never appears rather than filtering everything out. */}
          {prAvailable && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{fm.filterPullRequest}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {PR_FILTERS.map(option => (
                  <OptionCheckbox
                    checked={prFilter.includes(option.id)}
                    key={option.id}
                    onCheck={() => toggleSidebarPrFilter(option.id)}
                    option={withLabel(option)}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{fm.filterProfile}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
              {/* Scoped to one profile the rail is already the filter, so the
                  per-profile boxes only appear where they can narrow something.
                  The actions below stand on their own. */}
              {narrowsByProfile && (
                <>
                  {profileNames.map(name => (
                    <OptionCheckbox
                      checked={profileFilter.includes(name)}
                      key={name}
                      onCheck={() => toggleSidebarProfileFilter(name)}
                      option={{ icon: 'account', id: name, label: name }}
                    />
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onSelect={requestProfileCreate}>{t.profiles.newProfile}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void runImportProfileFlow()}>
                {t.profiles.importProfile}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {projects.length > 1 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{fm.filterProject}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                {projects.map(project => (
                  <OptionCheckbox
                    checked={projectFilter.includes(project.id)}
                    key={project.id}
                    onCheck={() => toggleSidebarProjectFilter(project.id)}
                    option={{
                      icon: project.isNoProject ? 'home' : 'root-folder',
                      id: project.id,
                      // Home is synthetic, so its label is ours to translate.
                      label: project.isNoProject ? t.sidebar.projects.home : project.label
                    }}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {/* Off by default: one profile's sessions are what the rail selected.
              Nothing to widen to until a second profile exists — but stay
              visible while it's on, or deleting your way back down to one
              profile would strand the sidebar in a mode nothing can leave (the
              rail hides its switcher at one profile too). */}
          {(profileNames.length > 1 || showAllProfiles) && (
            <OptionCheckbox
              checked={showAllProfiles}
              onCheck={toggleShowAllProfiles}
              option={{ id: 'all-profiles', label: t.profiles.allProfiles }}
            />
          )}

          <OptionCheckbox
            checked={showArchived}
            onCheck={() => setSidebarShowArchived(!showArchived)}
            option={{ id: 'archived', label: fm.archived }}
          />

          {/* One way back rather than two near-identical ones: this drops the
              grouping and sort too, which "clear filters" left behind. */}
          {viewCustomized && <DropdownMenuItem onSelect={resetSidebarView}>{fm.resetToDefaults}</DropdownMenuItem>}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Only the project rows fold, and only when they're what you're
            looking at — sweeping Pinned and Cron shut alongside them is not
            what "collapse all" means here. Their lanes underneath keep their
            own state, so re-opening a project shows it as you left it. */}
        {grouping === 'project' && projects.length > 0 && (
          <DropdownMenuItem
            onSelect={() =>
              setWorkspaceNodesOpen(
                projects.map(project => project.id),
                projectsCollapsed
              )
            }
          >
            {projectsCollapsed ? fm.expandAll : fm.collapseAll}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={unreadIds.length === 0} onSelect={markAllSessionsRead}>
          {t.sidebar.markAllRead}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
