// Notification center bell (step 16 · T15, 方案 §5-T15).
//
// The titlebar bell + its dropdown panel. Three groups (需审批 / 自动化结果 /
// 系统) read straight from `store/notification-center.ts`, which joins the
// SAME sources the tray dot and the sidebar already paint — no second
// aggregation. The panel DISPLAYS and NAVIGATES only: clicking a row focuses
// the matching session; no approval is ever executed from here (the approval
// bar / tool/approval.tsx primitives keep that authority — 护栏语义).
//
// Visual language: titlebar tool cluster primitives (`titlebarButtonClass`,
// Button `icon-titlebar`, 6px dot) + the shared Popover; ~100ms motion only.

import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

import { openSession } from '@/app/open-session'
import { titlebarButtonClass } from '@/app/shell/titlebar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { Bell } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $centerGroups,
  $notificationCenterUnread,
  markNotificationRead,
  type NotificationCenterGroup,
  type NotificationCenterRow,
  startNotificationCenterFeed
} from '@/store/notification-center'

/** 6px status dot — the DESIGN_PROPOSAL §3.5 size, tinted per group. */
function GroupDot({ group }: { group: NotificationCenterGroup }) {
  const tint =
    group === 'approval' ? 'bg-warning' : group === 'automation' ? 'bg-info' : 'bg-(--ui-text-tertiary)'

  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', tint)} />
}

function CenterRow({ row, onOpen }: { row: NotificationCenterRow; onOpen: (row: NotificationCenterRow) => void }) {
  const { t } = useI18n()
  const a = t.notificationCenter

  const hint =
    row.group === 'approval' ? a.approvalRowHint : row.id.startsWith('cron:') ? a.cronRowHint : row.id.startsWith('note:') ? a.noteRowHint : null

  return (
    <button
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-100',
        'hover:bg-(--ui-control-hover-background)'
      )}
      data-read={row.read ? 'true' : 'false'}
      data-slot="notification-center-row"
      onClick={() => onOpen(row)}
      type="button"
    >
      {!row.read && <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-info" />}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-xs', row.read ? 'text-(--ui-text-secondary)' : 'text-foreground')}>
          {row.title}
        </span>
        {row.body && <span className="mt-0.5 block truncate text-[0.6875rem] text-(--ui-text-tertiary)">{row.body}</span>}
        {hint && <span className="mt-0.5 block text-[0.6875rem] text-(--ui-text-tertiary)">{hint}</span>}
      </span>
    </button>
  )
}

function GroupSection({
  heading,
  group,
  rows,
  onOpen
}: {
  heading: string
  group: NotificationCenterGroup
  rows: readonly NotificationCenterRow[]
  onOpen: (row: NotificationCenterRow) => void
}) {
  if (rows.length === 0) {
    return null
  }

  return (
    <div data-group={group} data-slot="notification-center-section">
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-2">
        <GroupDot group={group} />
        <span className="text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)">{heading}</span>
      </div>
      {rows.map(row => (
        <CenterRow key={row.id} onOpen={onOpen} row={row} />
      ))}
    </div>
  )
}

export function NotificationCenterBell() {
  const { t } = useI18n()
  const a = t.notificationCenter
  const navigate = useNavigate()
  const groups = useStore($centerGroups)
  const unread = useStore($notificationCenterUnread)

  // Feed wiring: main double-writes accepted OS notifications; subscribe once.
  useEffect(() => startNotificationCenterFeed(), [])

  const open = (row: NotificationCenterRow) => {
    markNotificationRead(row.id)

    if (row.sessionId) {
      openSession(row.sessionId, navigate)
    }
  }

  const sections: Array<{ group: NotificationCenterGroup; heading: string; rows: readonly NotificationCenterRow[] }> = [
    { group: 'approval', heading: a.approvalHeading, rows: groups.approval },
    { group: 'automation', heading: a.automationHeading, rows: groups.automation },
    { group: 'system', heading: a.systemHeading, rows: groups.system }
  ]

  return (
    <Popover>
      <Tip label={a.label}>
        <PopoverTrigger asChild>
          <Button
            aria-label={a.label}
            className={cn(titlebarButtonClass, 'bg-transparent select-none')}
            data-tour="notification-center"
            data-unread={unread.total > 0 ? 'true' : 'false'}
            size="icon-titlebar"
            type="button"
            variant="ghost"
          >
            <span className="relative inline-flex">
              <Bell />
              {unread.total > 0 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-1 -right-1 inline-block size-1.5 rounded-full bg-warning"
                />
              )}
            </span>
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        align="end"
        aria-label={a.label}
        className="w-72 p-1"
        data-slot="notification-center-panel"
        side="bottom"
      >
        {unread.total === 0 && groups.approval.length === 0 && groups.automation.length === 0 && groups.system.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-(--ui-text-tertiary)">{a.empty}</p>
        ) : (
          sections.map(section => (
            <GroupSection group={section.group} heading={section.heading} key={section.group} onOpen={open} rows={section.rows} />
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}
