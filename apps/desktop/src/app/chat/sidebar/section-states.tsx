import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { SidebarRowCluster, SidebarRowShell, SidebarRowStack } from './chrome'

// Stands in for session rows, so it borrows their chrome instead of copying
// the grid — a placeholder on a different edge than the rows it resolves into
// makes the list step sideways on load.
export function SidebarSessionSkeletons() {
  return (
    <SidebarRowStack aria-hidden="true">
      {['w-32', 'w-40', 'w-28', 'w-36', 'w-24'].map((width, i) => (
        <SidebarRowShell actions={<Skeleton className="size-3.5 rounded-sm opacity-60" />} key={`${width}-${i}`}>
          <SidebarRowCluster>
            <Skeleton className={cn('h-3 rounded-sm', width)} />
          </SidebarRowCluster>
        </SidebarRowShell>
      ))}
    </SidebarRowStack>
  )
}

export function SidebarBlankState({ onNewProject }: { onNewProject: () => void }) {
  const { t } = useI18n()
  const s = t.sidebar

  return (
    <div className="grid min-h-0 flex-1 place-items-center px-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <Codicon className="text-(--v3-ink-4)" name="root-folder" size="1.25rem" />
        <p className="text-xs text-(--v3-ink-3)">{s.noSessions}</p>
        <Button className="mt-0.5 text-(--v3-ink-2)" onClick={onNewProject} size="sm" variant="ghost">
          <Codicon name="add" size="0.75rem" />
          {s.projects.newButton}
        </Button>
      </div>
    </div>
  )
}
