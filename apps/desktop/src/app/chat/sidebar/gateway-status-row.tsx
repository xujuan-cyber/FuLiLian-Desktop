import { useStore } from '@nanostores/react'

import { StatusDot } from '@/components/status-dot'
import { useI18n } from '@/i18n'
import { $gatewayState } from '@/store/session'

/** The bottom status line of the sidebar (§4.3 wireframe: 本地网关 · 已连接).
 *  A display of the gateway's connection state — the switcher that changes it
 *  lives in the statusbar; this row only reports it. The dot comes from the
 *  StatusDot primitive: running=connected, failed=error, grey=everything else
 *  (idle/connecting/closed) — nothing is being asked of the user in those. */
export function SidebarGatewayStatusRow() {
  const { t } = useI18n()
  const g = t.sidebar.gateway
  const state = useStore($gatewayState)

  const dotState = state === 'open' ? 'running' : state === 'error' ? 'failed' : 'background'

  const label =
    state === 'open' ? g.connected : state === 'connecting' ? g.connecting : state === 'error' ? g.error : g.offline

  const text = `${g.local} · ${label}`

  return (
    <div aria-label={text} className="flex items-center gap-1.5 rounded-md px-2 py-1" data-testid="sidebar-gateway-status" role="status">
      <StatusDot state={dotState} />
      <span className="min-w-0 truncate text-[0.6875rem] leading-[1.35] text-(--ui-text-tertiary)">{text}</span>
    </div>
  )
}
