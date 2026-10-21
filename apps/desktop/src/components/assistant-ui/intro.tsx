import { type ReactNode, useState } from 'react'

import { requestComposerFocus } from '@/app/chat/composer/focus'
import { useI18n } from '@/i18n'
import { ChevronRight, FileText, GitBranch, Terminal } from '@/lib/icons'

export type IntroProps = {
  /** v3 §8.3: the empty-state composer node, mounted by the caller and
   *  rendered between the lede and the chips (design order, not after cards). */
  composer?: ReactNode
  /** Kept for the `Thread` call site; v3 shows one lede for every personality. */
  personality?: string
  seed?: number
}

const CHIP_CLASS =
  'inline-flex h-7 items-center rounded-lg bg-(--v3-sunken) px-3 text-xs leading-none text-(--v3-ink-2) transition-colors'

export function Intro({ composer }: IntroProps) {
  const { t } = useI18n()
  const h = t.home
  // §5.1: the greeting tracks the time of day. Computed at mount — the intro
  // only mounts on a fresh draft, so it never goes stale on screen.
  const [hour] = useState(() => new Date().getHours())
  const greeting = hour < 12 ? h.greeting.morning : hour < 18 ? h.greeting.afternoon : h.greeting.evening

  const cards = [
    { desc: h.modeCards.forensicsDesc, icon: FileText, key: 'forensics' as const, title: h.modeCards.forensics },
    { desc: h.modeCards.ctfDesc, icon: Terminal, key: 'ctf' as const, title: h.modeCards.ctf },
    { desc: h.modeCards.projectDesc, icon: GitBranch, key: 'project' as const, title: h.modeCards.project }
  ]

  const pendingChips = [
    { key: 'forensics' as const, label: h.chips.forensics },
    { key: 'ctf' as const, label: h.chips.ctf },
    { key: 'idle' as const, label: h.chips.idle }
  ]

  return (
    // v3 empty state: one left axis inside a centred column. The row gap below
    // the block (28px) is the breathing room the inline composer sits on.
    <div
      className="pointer-events-none w-full min-w-0 max-h-full overflow-y-auto overscroll-contain px-6 pb-7 pt-6 [line-break:strict]"
      data-slot="aui_intro"
    >
      <div className="v3-column">
        <h1 className="v3-display m-0">{greeting}</h1>

        <p className="v3-lede mt-3 mb-0 max-w-[52ch] text-pretty">{h.lede}</p>

        {/* v3 §8.3: the empty-state composer sits between the lede and the
            chips — caller mounts it, we only own the 28px breathing room and
            re-enable pointer events (the intro root is pointer-events-none). */}
        {composer ? (
          <div className="pointer-events-auto mt-7" data-slot="intro-composer">
            {composer}
          </div>
        ) : null}

        {/* §5.1 quick chips. Only the first one acts (it focuses the composer);
            the rest are honest placeholders — aria-disabled, dimmed, explained
            by their own tooltip, never styled as clickable actions. */}
        <div className="pointer-events-auto mt-3 flex flex-wrap items-center gap-2" data-testid="intro-chips">
          <button
            className={`${CHIP_CLASS} cursor-pointer hover:bg-(--v3-hover) hover:text-(--v3-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--v3-ink-3)`}
            data-testid="intro-chip-programming"
            onClick={() => requestComposerFocus('active')}
            title={h.chips.programmingTip}
            type="button"
          >
            {h.chips.programming}
          </button>
          {pendingChips.map(chip => (
            <span
              aria-disabled="true"
              className={`${CHIP_CLASS} opacity-60`}
              data-testid={`intro-chip-placeholder-${chip.key}`}
              key={chip.key}
              title={h.chips.placeholderTip}
            >
              {chip.label}
            </span>
          ))}
        </div>

        <div className="mt-10 flex items-baseline justify-between gap-3">
          <span className="v3-label">{h.section.title}</span>
          {/* Not clickable yet — the template library lands with the data
              layer, so this stays plain text rather than a dead link. */}
          <span className="v3-meta inline-flex items-center gap-1" data-testid="intro-more">
            {h.section.more}
            <ChevronRight aria-hidden className="size-3 text-(--v3-ink-3) rtl:-scale-x-100" />
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {cards.map(card => (
            <div
              className="flex min-h-28 flex-col rounded-xl border border-(--v3-line) bg-(--v3-surface) p-4"
              data-testid={`intro-mode-card-${card.key}`}
              key={card.key}
            >
              <card.icon aria-hidden className="size-4 shrink-0 text-(--v3-ink-3)" />
              <div className="mt-3 text-[13px] font-semibold leading-[1.45] text-(--v3-ink)">{card.title}</div>
              <div className="mt-1.5 line-clamp-3 text-xs leading-[1.6] text-(--v3-ink-2) text-pretty [:lang(ja)_&]:leading-[1.75]">
                {card.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
