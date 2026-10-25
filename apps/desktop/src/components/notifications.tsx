import { useStore } from '@nanostores/react'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { CopyButton } from '@/components/ui/copy-button'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { AlertCircle, AlertTriangle, CheckCircle2, type IconComponent, Info } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $notifications,
  type AppNotification,
  clearNotifications,
  dismissNotification,
  type NotificationKind
} from '@/store/notifications'

type ToneVariant = 'default' | 'destructive' | 'warning' | 'success'

const tone: Record<NotificationKind, { icon: IconComponent; iconClass: string; variant: ToneVariant }> = {
  error: { icon: AlertCircle, iconClass: 'text-destructive', variant: 'destructive' },
  warning: { icon: AlertTriangle, iconClass: 'text-primary', variant: 'warning' },
  info: { icon: Info, iconClass: 'text-muted-foreground', variant: 'default' },
  success: { icon: CheckCircle2, iconClass: 'text-primary', variant: 'success' }
}

const STACK_SURFACE = 'pointer-events-auto border border-(--stroke-nous) bg-popover/95 shadow-nous backdrop-blur-md'

// N-1 (v1.4.1): the stack swapped toasts with zero transition — abrupt mount,
// abrupt same-slot replace, abrupt unmount — so a toast fired over an open
// overlay read as a jolt/flash with a one-frame afterimage once gone (U1).
// Mount now fades/slides in; a dismissed toast keeps a ghost copy in place for
// the exit window so unmount is a fade, not a cut. Component-scoped <style>
// below: styles.css is single-writer territory and this needs nothing global.
const TOAST_ENTER_MS = 200
const TOAST_EXIT_MS = 180

const TOAST_MOTION_CSS = `
@keyframes fulilian-toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fulilian-toast-out {
  to { opacity: 0; transform: translateY(-6px); }
}
.fulilian-toast-enter { animation: fulilian-toast-in ${TOAST_ENTER_MS}ms cubic-bezier(0.22, 1, 0.36, 1); }
.fulilian-toast-leaving { animation: fulilian-toast-out ${TOAST_EXIT_MS}ms ease-in forwards; pointer-events: none; }
/* The ghost re-renders NotificationItem, whose enter animation would fight the
   exit fade — the wrapper owns the motion, so the inner entrance is muted. */
.fulilian-toast-leaving .fulilian-toast-enter { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .fulilian-toast-enter, .fulilian-toast-leaving { animation: none !important; }
}
`

function partitionNotifications(notifications: AppNotification[]) {
  const defaultStack: AppNotification[] = []
  const bottomRightStack: AppNotification[] = []

  for (const notification of notifications) {
    if (notification.placement === 'bottom-right') {
      bottomRightStack.push(notification)
    } else {
      defaultStack.push(notification)
    }
  }

  return { bottomRightStack, defaultStack }
}

export function NotificationStack() {
  const notifications = useStore($notifications)
  const { bottomRightStack, defaultStack } = partitionNotifications(notifications)
  const { t } = useI18n()
  const lastNotificationIdRef = useRef<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const copy = t.notifications

  // Exit ghosts: ids present before but gone now keep rendering (fading out)
  // for TOAST_EXIT_MS. Per-id timers — a second dismissal 50ms after the first
  // must not cancel the first ghost's removal timer.
  const [leaving, setLeaving] = useState<AppNotification[]>([])
  const prevNotificationsRef = useRef<Map<string, AppNotification>>(new Map())
  const exitTimersRef = useRef<Map<string, number>>(new Map())

  // Snapshot write lives outside the effect body: the atom-mirror lint rule
  // matches any `.current =` assignment lexically inside a useEffect, and a
  // disable-next-line cannot reach it there (the report lands on the effect
  // call itself). This is bookkeeping for exit detection, never read in
  // callbacks — the antipattern the rule guards does not apply.
  const snapshotPrevNotifications = (next: Map<string, AppNotification>) => {
    prevNotificationsRef.current = next
  }

  useEffect(() => {
    const next = new Map(notifications.map(n => [n.id, n]))
    const prev = prevNotificationsRef.current
    snapshotPrevNotifications(next)

    // An id that came back while its ghost was still fading drops the ghost
    // immediately — the live item takes over the slot.
    const returned = [...leaving.filter(g => next.has(g.id)).map(g => g.id)]

    const vanished: AppNotification[] = []

    for (const [id, notification] of prev) {
      if (!next.has(id)) {
        vanished.push(notification)
      }
    }

    if (returned.length > 0) {
      for (const id of returned) {
        const timer = exitTimersRef.current.get(id)

        if (timer !== undefined) {
          window.clearTimeout(timer)
          exitTimersRef.current.delete(id)
        }
      }

      setLeaving(current => current.filter(g => !next.has(g.id)))
    }

    if (vanished.length === 0) {
      return
    }

    setLeaving(current => [...current, ...vanished])

    for (const notification of vanished) {
      const timer = window.setTimeout(() => {
        exitTimersRef.current.delete(notification.id)
        setLeaving(current => current.filter(g => g.id !== notification.id))
      }, TOAST_EXIT_MS)

      exitTimersRef.current.set(notification.id, timer)
    }
  }, [leaving, notifications])

  // Unmount with pending ghosts: no timers may outlive the surface.
  useEffect(
    () => () => {
      for (const timer of exitTimersRef.current.values()) {
        window.clearTimeout(timer)
      }

      exitTimersRef.current.clear()
    },
    []
  )

  useEffect(() => {
    if (defaultStack.length <= 1) {
      setExpanded(false)
    }
  }, [defaultStack.length])

  // Ghosts ride the stack their placement sent them to — a top-center toast
  // must not leave a second copy in the bottom-right corner while fading.
  const { bottomRightStack: leavingBottom, defaultStack: leavingTop } = partitionNotifications(leaving)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    const latest = notifications[0]

    if (!latest || latest.id === lastNotificationIdRef.current) {
      return
    }

    lastNotificationIdRef.current = latest.id

    if (latest.kind === 'success') {
      triggerHaptic('success')
    } else if (latest.kind === 'error') {
      triggerHaptic('error')
    } else if (latest.kind === 'warning') {
      triggerHaptic('warning')
    }
  }, [notifications])

  return (
    <>
      <style>{TOAST_MOTION_CSS}</style>
      {(defaultStack.length > 0 || leavingTop.length > 0) && (
        <TopCenterStack
          copy={copy}
          expanded={expanded}
          leaving={leavingTop}
          notifications={defaultStack}
          onToggleExpanded={() => setExpanded(v => !v)}
        />
      )}
      {(bottomRightStack.length > 0 || leavingBottom.length > 0) && (
        <BottomRightStack copy={copy} leaving={leavingBottom} notifications={bottomRightStack} />
      )}
    </>
  )
}

// Portaled to <body> on the over-modal rung so a toast clears an open dialog —
// see the top-center variant below for why.
const REGION_BASE = 'pointer-events-none fixed z-(--z-over-modal) flex gap-2'

// Primary stack: top-center, collapsed to the latest toast with a "+N more"
// expander + clear-all — the noisy/important surface (errors, warnings,
// action toasts). Without the portal it lives inside the React root subtree,
// which any body-level dialog/overlay portal paints over — so a toast fired
// while a dialog is open was invisible.
function TopCenterStack({
  copy,
  expanded,
  leaving,
  notifications,
  onToggleExpanded
}: {
  copy: ReturnType<typeof useI18n>['t']['notifications']
  expanded: boolean
  leaving: AppNotification[]
  notifications: AppNotification[]
  onToggleExpanded: () => void
}) {
  const [latest, ...older] = notifications

  return createPortal(
    <div
      aria-label={copy.region}
      // Pill spacing rule (P5): the overlay chrome's centered edge pill — the
      // settings search pill, `edgeBadge` in app/overlays/overlay-view.tsx —
      // straddles the card's top edge: its center sits titlebar + 0.875rem
      // down and it is half a --titlebar-control-height tall, so its bottom
      // edge lands at titlebar + 0.875rem + 12px. The old slot (titlebar +
      // 0.75rem) opened exactly on top of that band, so a toast fired while
      // settings was open covered the pill. This stack offsets BELOW the
      // worst-case pill bottom (any pill height, any window width — the pill
      // is content-sized, so no horizontal rule can clear it deterministically)
      // with a 0.5rem breathing gap.
      className={cn(
        REGION_BASE,
        'left-1/2 top-[calc(var(--titlebar-height,34px)_+_0.875rem_+_var(--titlebar-control-height,24px)/2_+_0.5rem)] w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 flex-col'
      )}
      role="region"
    >
      {/* The region also renders while a dismissed toast's ghost fades out —
          notifications may be empty there, so the live slot is conditional. */}
      {latest && <NotificationItem notification={latest} />}
      {expanded && older.map(n => <NotificationItem key={n.id} notification={n} />)}
      {older.length > 0 && (
        <div className={cn(STACK_SURFACE, 'flex min-h-8 items-center justify-between rounded-lg px-3 text-xs')}>
          <Button className="-ml-2" onClick={onToggleExpanded} size="xs" type="button" variant="text">
            {expanded ? copy.hide : copy.show} {copy.more(older.length)}
          </Button>
          <Button className="-mr-2" onClick={clearNotifications} size="xs" type="button" variant="text">
            {copy.clearAll}
          </Button>
        </div>
      )}
      {leaving.map(n => (
        <NotificationGhost key={n.id} notification={n} />
      ))}
    </div>,
    document.body
  )
}

// Ambient stack: bottom-right, every toast shown at once (routine confirmations
// rarely queue up), newest on top, no expand/clear-all chrome.
function BottomRightStack({
  copy,
  leaving,
  notifications
}: {
  copy: ReturnType<typeof useI18n>['t']['notifications']
  leaving: AppNotification[]
  notifications: AppNotification[]
}) {
  return createPortal(
    <div
      aria-label={copy.region}
      className={cn(REGION_BASE, 'right-4 bottom-4 w-[min(24rem,calc(100%-2rem))] flex-col-reverse')}
      role="region"
    >
      {leaving.map(n => (
        <NotificationGhost key={n.id} notification={n} />
      ))}
      {notifications.map(n => (
        <NotificationItem key={n.id} notification={n} />
      ))}
    </div>,
    document.body
  )
}

// Emphasize only the leading money figure ("$16.00" — the amount used) with the
// accent color (semibold), leaving the rest of the line in its default muted
// tone. No accent, or no figure in the message → render the text untouched.
function renderMessage(message: string, accent?: string): ReactNode {
  const match = accent ? /\$\d+(?:\.\d{2})?/.exec(message) : null

  if (!match) {
    return message
  }

  const start = match.index
  const end = start + match[0].length

  return (
    <>
      {message.slice(0, start)}
      <span className="font-semibold" style={{ color: accent }}>
        {match[0]}
      </span>
      {message.slice(end)}
    </>
  )
}

// AlertTitle defaults to a single-line clamp. Toast errors are often a full
// sentence, so the toast wraps — then caps height and scrolls instead of
// growing down the chat or clipping with an ellipsis.
export function toastTitleClassName() {
  return 'col-start-auto line-clamp-none max-h-[4.5em] overflow-y-auto overscroll-contain whitespace-normal wrap-break-word'
}

function NotificationItem({ notification }: { notification: AppNotification }) {
  const styles = tone[notification.kind]
  const Icon = styles.icon
  const hasDetail = Boolean(notification.detail && notification.detail !== notification.message)
  const { t } = useI18n()
  const copy = t.notifications

  // Nudge the icon down to sit on the first text line, in `ch` so it tracks the
  // toast's font size instead of a fixed rem. `accentColor` (when set) tints the
  // icon + message as a severity ramp, overriding the kind's default color.
  const accent = notification.accentColor
  const iconStyle: CSSProperties = { marginTop: '0.42ch', ...(accent ? { color: accent } : {}) }

  return (
    <Alert
      aria-live={notification.kind === 'error' ? 'assertive' : 'polite'}
      className={cn(STACK_SURFACE, 'fulilian-toast-enter grid-cols-[auto_minmax(0,1fr)_auto] pr-2.5')}
      role={notification.kind === 'error' ? 'alert' : 'status'}
      variant={styles.variant}
    >
      {notification.icon ? (
        <Codicon className={styles.iconClass} name={notification.icon} size="1rem" style={iconStyle} />
      ) : (
        <Icon className={styles.iconClass} style={iconStyle} />
      )}
      <div className="col-start-2 min-w-0">
        {notification.title && (
          <AlertTitle className={toastTitleClassName()} title={notification.title}>
            {notification.title}
          </AlertTitle>
        )}
        <AlertDescription className="col-start-auto">
          <p className="m-0 wrap-break-word">{renderMessage(notification.message, accent)}</p>
          {notification.meta && <p className="m-0 text-xs text-muted-foreground tabular-nums">{notification.meta}</p>}
          {hasDetail && <NotificationDetail detail={notification.detail || ''} />}
          {notification.action && (
            <Button
              className="mt-1.5"
              onClick={() => {
                notification.action?.onClick()
                dismissNotification(notification.id)
              }}
              size="xs"
              type="button"
              variant="textStrong"
            >
              {notification.action.label}
            </Button>
          )}
        </AlertDescription>
      </div>
      <Button
        aria-label={copy.dismiss}
        className="col-start-3 -mr-1 text-muted-foreground"
        onClick={() => dismissNotification(notification.id)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Codicon name="close" size="0.875rem" />
      </Button>
    </Alert>
  )
}

// Fading-out copy of a dismissed toast. aria-hidden: the live region already
// announced it once — a ghost must not re-announce. No enter animation (the
// exit wrapper owns the motion; re-running the entrance would fight it).
function NotificationGhost({ notification }: { notification: AppNotification }) {
  return (
    <div aria-hidden className="fulilian-toast-leaving" data-testid="toast-exit-ghost">
      <NotificationItem notification={notification} />
    </div>
  )
}

function NotificationDetail({ detail }: { detail: string }) {
  const { t } = useI18n()
  const copy = t.notifications

  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="select-none font-medium text-muted-foreground hover:text-foreground">{copy.details}</summary>
      <div className="mt-1 rounded-md bg-background/65 p-2">
        <pre
          className="max-h-32 whitespace-pre-wrap wrap-break-word font-mono text-[0.6875rem] leading-relaxed"
          data-selectable-text="true"
        >
          {detail}
        </pre>
        <CopyButton
          appearance="inline"
          className="mt-1 rounded px-1.5 py-0.5 text-[0.6875rem]"
          errorMessage={copy.copyDetailFailed}
          iconClassName="size-3"
          label={copy.copyDetail}
          text={detail}
        >
          {copy.copyDetail}
        </CopyButton>
      </div>
    </details>
  )
}

export function InlineNotice({
  kind = 'info',
  title,
  children,
  className
}: {
  kind?: NotificationKind
  title?: string
  children: ReactNode
  className?: string
}) {
  const styles = tone[kind]
  const Icon = styles.icon

  return (
    <Alert className={cn('min-w-0', className)} role={kind === 'error' ? 'alert' : 'status'} variant={styles.variant}>
      <Icon />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className={cn(!title && 'row-start-1')}>{children}</AlertDescription>
    </Alert>
  )
}
