import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import { useCallback } from 'react'

import { getSkills } from '@/api/skills'
import type { SkillInfo } from '@/types/fulilian'

import { normalize } from '@/lib/text'

import type { CompletionEntry, CompletionPayload } from './use-live-completion-adapter'
import { useLiveCompletionAdapter } from './use-live-completion-adapter'

interface DollarItemMetadata extends Record<string, string> {
  display: string
  meta: string
  /** The `/command` the pick inserts — serialize reads this verbatim. */
  rawText: string
}

// One catalog fetch per app run: the skills list changes when the user installs
// or toggles something, which is a rare, deliberate act — and the Skills page
// invalidates nobody else's cache either. A stale row costs one submit.
let skillsCache: Promise<SkillInfo[]> | null = null

function skillsOnce(): Promise<SkillInfo[]> {
  skillsCache ??= getSkills().catch(error => {
    // A failed fetch must not poison the cache forever: drop it so the next
    // keystroke retries instead of locking the popover empty for the session.
    skillsCache = null

    throw error
  })

  return skillsCache
}

function skillEntries(query: string, skills: SkillInfo[]): CompletionEntry[] {
  const needle = normalize(query)

  return skills
    .filter(skill => {
      if (!skill.enabled) {
        return false
      }

      if (!needle) {
        return true
      }

      return normalize(skill.name).includes(needle) || normalize(skill.description).includes(needle)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(skill => ({
      display: skill.name,
      meta: skill.description,
      text: skill.name
    }))
}

/** Live `$` completions — skill invocation. Picking a row inserts the skill's
 *  `/name` slash command as text, exactly as typing it by hand would: at the
 *  start of the draft it submits as the command itself, mid-prose it stays an
 *  inline reference (the same two shapes `/` already has). The list is the
 *  enabled skills from the REST catalog, filtered by name and description. */
export function useDollarCompletions(options: { enabled: boolean }): {
  adapter: Unstable_TriggerAdapter
  loading: boolean
} {
  const { enabled } = options

  const fetcher = useCallback(async (query: string): Promise<CompletionPayload> => {
    try {
      const skills = await skillsOnce()

      return { items: skillEntries(query, skills), query }
    } catch {
      return { items: [], query }
    }
  }, [])

  const toItem = useCallback((entry: CompletionEntry, index: number): Unstable_TriggerItem => {
    const name = typeof entry.text === 'string' ? entry.text : ''
    const command = `/${name}`
    const meta = typeof entry.meta === 'string' ? entry.meta : ''

    const metadata: DollarItemMetadata = {
      display: command,
      meta,
      rawText: command
    }

    return {
      id: `${entry.text}|${index}`,
      type: 'skill',
      label: command,
      ...(meta ? { description: meta } : {}),
      metadata
    }
  }, [])

  const isCached = useCallback(() => skillsCache !== null, [])

  return useLiveCompletionAdapter({ enabled, fetcher, isCached, toItem })
}
