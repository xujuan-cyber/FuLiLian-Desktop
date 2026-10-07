import { type CSSProperties, useState } from 'react'

import { requestComposerFocus } from '@/app/chat/composer/focus'
import { useI18n } from '@/i18n'
import { FileText, GitBranch, Terminal } from '@/lib/icons'
import { capitalize, normalize } from '@/lib/text'

import introCopyJsonl from './intro-copy.jsonl?raw'

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  personality?: string
  seed?: number
}

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])

const FALLBACK_COPY: IntroCopy[] = [
  {
    headline: 'What are we moving today?',
    body: "Send a bug, branch, plan, or rough idea. I'll inspect the repo and turn it into the next concrete step."
  },
  {
    headline: "What's on your mind?",
    body: "Bring the code, question, or stuck part. I'll read the room before making changes."
  },
  {
    headline: 'What should Fulilian look at?',
    body: "Send the task, failing path, or half-formed plan. I'll help turn it into action."
  },
  {
    headline: 'Where should we start?',
    body: "Bring the problem, goal, or file. I'll inspect first and keep the next step concrete."
  },
  {
    headline: 'What needs attention?',
    body: "Send the context you have. I'll help sort it into a plan or a fix."
  }
]

function normalizeKey(value?: string): string {
  return normalize(value)
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)

function neutralCopy(): IntroCopy[] {
  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy()
  }

  const label = titleize(personalityKey)

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: "Send the task, file, or rough idea. I'll use your configured voice and keep the work grounded in this repo."
    },
    {
      headline: `What does ${label} Fulilian need to see?`,
      body: "Bring the context or the stuck part. I'll adapt to your configured personality."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the problem, file, or idea. I'll follow the personality you've configured."
    },
    {
      headline: `What should ${label} Fulilian tackle?`,
      body: "Drop the task here. I'll keep the work grounded in the repo."
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the context and I'll answer in ${label} mode.`
    }
  ]
}

function pickCopy(copies: IntroCopy[], seed = 0): IntroCopy {
  return copies[Math.abs(seed) % copies.length] || FALLBACK_COPY[0]
}

const WORDMARK = 'FULILIAN AGENT'

function resolveCopy(personality?: string, seed?: number): IntroCopy {
  const personalityKey = normalizeKey(personality)

  const copies = NEUTRAL_PERSONALITIES.has(personalityKey)
    ? INTRO_COPY_BY_PERSONALITY[personalityKey] || neutralCopy()
    : INTRO_COPY_BY_PERSONALITY[personalityKey] || fallbackCopyForPersonality(personalityKey)

  return pickCopy(copies, seed)
}

export function Intro({ personality, seed }: IntroProps) {
  const { t } = useI18n()
  const h = t.home
  const [mountSeed] = useState(() => Math.floor(Math.random() * 100000))
  const copy = resolveCopy(personality, mountSeed + (seed ?? 0))
  // §5.1: the greeting tracks the time of day. Computed at mount — the intro
  // only mounts on a fresh draft, so it never goes stale on screen.
  const [hour] = useState(() => new Date().getHours())
  const greeting = hour < 12 ? h.greeting.morning : hour < 18 ? h.greeting.afternoon : h.greeting.evening

  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center text-muted-foreground sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      <div className="w-full min-w-0">
        <p className="m-0 text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">
          {greeting}
        </p>

        <p
          aria-label={WORDMARK}
          className="fit-text mx-auto mb-1 mt-2 w-[calc(100%-1rem)] font-['Fraunces'] font-bold uppercase leading-[0.9] tracking-[0.02em] text-midground dark:text-foreground/90 dark:mix-blend-plus-lighter"
          style={{ '--fit-min': '2.75rem' } as CSSProperties}
        >
          <span>
            <span>{WORDMARK}</span>
          </span>
          <span aria-hidden="true">{WORDMARK}</span>
        </p>

        <p className="m-0 text-center leading-normal tracking-tight">{copy.body}</p>

        {/* §5.1 quick chips + mode entry cards. The kind metadata has no data
            layer this round: the programming chip performs the one real action
            available (focusing the composer); the forensics/CTF/idle entries
            are honest placeholders — aria-disabled, never fabricating a
            creation flow — and say so in the note beneath the row. */}
        <div className="pointer-events-auto mx-auto mt-5 flex max-w-2xl flex-wrap items-center justify-center gap-2">
          <button
            className="rounded-full border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-3 py-1.5 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary) transition-colors hover:border-(--ui-stroke-secondary) hover:text-foreground"
            data-testid="intro-chip-programming"
            onClick={() => requestComposerFocus('active')}
            title={h.chips.programmingTip}
            type="button"
          >
            {h.chips.programming}
          </button>
          {[
            { key: 'forensics' as const, label: h.chips.forensics },
            { key: 'ctf' as const, label: h.chips.ctf },
            { key: 'idle' as const, label: h.chips.idle }
          ].map(chip => (
            <span
              aria-disabled="true"
              className="rounded-full border border-(--ui-stroke-tertiary) px-3 py-1.5 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)"
              data-testid={`intro-chip-placeholder-${chip.key}`}
              key={chip.key}
              title={h.chips.placeholderTip}
            >
              {chip.label}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-quaternary)">
          {h.chipsNote}
        </p>

        <div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-3">
          {[
            { desc: h.modeCards.forensicsDesc, icon: FileText, key: 'forensics' as const, title: h.modeCards.forensics },
            { desc: h.modeCards.ctfDesc, icon: Terminal, key: 'ctf' as const, title: h.modeCards.ctf },
            { desc: h.modeCards.projectDesc, icon: GitBranch, key: 'project' as const, title: h.modeCards.project }
          ].map(card => (
            <div
              className="rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-3 text-left"
              data-testid={`intro-mode-card-${card.key}`}
              key={card.key}
            >
              <card.icon aria-hidden className="size-4 text-(--ui-text-tertiary)" />
              <div className="mt-1.5 text-[length:var(--conversation-caption-font-size)] font-medium text-foreground">
                {card.title}
              </div>
              <div className="mt-0.5 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                {card.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
