import type { ReactNode } from 'react'

import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import type { ContainerKind } from '../sidebar/container-kind'

/**
 * CONTAINER SIDE CARDS — the right-rail cards of the forensics / CTF session
 * pages (DESIGN_PROPOSAL §5.2 证据清单 + 审计留痕卡, §5.3 flag 保管库 +
 * 提交历史 + 工具箱), as static structure with HONEST empty states.
 *
 * The kind metadata has no data layer this round (§4.1 default: every session
 * is a project), so nothing mounts these cards yet — mounting them into the
 * right-sidebar pane registry needs new visibility atoms (`src/store/`) and a
 * `contrib/controller` registration, both out of the T4 file face. This module
 * is the seam the data-layer round mounts; tests assert the honesty: no
 * fabricated evidence rows, hashes, flags or submission counts. Data values
 * are FulilianMono (§2 原则 6) wherever real data will land.
 */

const CARD = 'rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-3'
const CARD_TITLE = 'text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)'

const CARD_EMPTY =
  'mt-1.5 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)'

function Card({ children, testid, title }: { children: ReactNode; testid: string; title: string }) {
  return (
    <div className={CARD} data-testid={testid}>
      <div className={CARD_TITLE}>{title}</div>
      {children}
    </div>
  )
}

function ForensicsCards() {
  const { t } = useI18n()
  const c = t.container.cards

  return (
    <>
      <Card testid="container-card-evidence" title={c.evidenceTitle}>
        <p className={CARD_EMPTY}>{c.evidenceEmpty}</p>
      </Card>
      <Card testid="container-card-audit" title={c.auditTitle}>
        <p className={CARD_EMPTY}>{c.auditEmpty}</p>
      </Card>
    </>
  )
}

function CtfCards() {
  const { t } = useI18n()
  const c = t.container.cards

  return (
    <>
      <Card testid="container-card-flag-vault" title={c.flagVaultTitle}>
        <p className={cn(CARD_EMPTY, 'font-mono')}>{c.flagEmpty}</p>
      </Card>
      <Card testid="container-card-submissions" title={c.submissionsTitle}>
        <p className={CARD_EMPTY}>{c.submissionsEmpty}</p>
      </Card>
      <Card testid="container-card-toolbox" title={c.toolboxTitle}>
        <p className={CARD_EMPTY}>{c.toolboxEmpty}</p>
      </Card>
    </>
  )
}

/**
 * The right-rail card stack for a session's container kind. `project` renders
 * nothing — the project page's right rail is the existing preview/changes/tool
 * panes (§5.4: 编程模式能力不变).
 */
export function ContainerSideCards({ className, kind }: { className?: string; kind: ContainerKind }) {
  if (kind === 'project') {
    return null
  }

  return (
    <div className={cn('flex flex-col gap-2', className)} data-container-cards-kind={kind}>
      {kind === 'forensics' ? <ForensicsCards /> : <CtfCards />}
    </div>
  )
}
