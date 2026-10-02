import { useCallback } from 'react'

import { useTheme } from './context'

// Retired skin names land on the canonical Nous skin so old muscle memory works.
// `default` and `fulilian` name the SHIPPED DEFAULT, so they have to follow
// DEFAULT_SKIN_NAME — step 13 · U2 moved it to apricot, a later pass moved it to
// github's white, and step 15 · T1 moved it to `fulilian-workbench`. Keep these
// two in step with presets.ts or `/skin default` quietly switches to a skin
// that is no longer the default. `gold` / `nous-light` stay pinned to `nous`,
// since they name that skin rather than the default one.
const ALIASES: Record<string, string> = {
  ares: 'ember',
  default: 'fulilian-workbench',
  gold: 'nous',
  fulilian: 'fulilian-workbench',
  'nous-light': 'nous'
}

export function useSkinCommand() {
  const { availableThemes, setTheme, themeName } = useTheme()

  return useCallback(
    (rawArg: string) => {
      const arg = rawArg.trim()

      if (!availableThemes.length) {
        return 'No desktop themes are available.'
      }

      const activeIndex = Math.max(
        0,
        availableThemes.findIndex(t => t.name === themeName)
      )

      if (!arg || arg === 'next') {
        const next = availableThemes[(activeIndex + 1) % availableThemes.length]
        setTheme(next.name)

        return `Desktop theme switched to ${next.label}.`
      }

      if (arg === 'list' || arg === 'ls' || arg === 'status') {
        const rows = availableThemes.map(t => `${t.name === themeName ? '*' : ' '} ${t.name.padEnd(10)} ${t.label}`)

        return ['Desktop themes:', ...rows, '', 'Use /skin <name>, or /skin to cycle.'].join('\n')
      }

      const normalized = arg.toLowerCase()
      const targetName = ALIASES[normalized] || normalized

      const target = availableThemes.find(
        t => t.name.toLowerCase() === targetName || t.label.toLowerCase() === normalized
      )

      if (!target) {
        return `Unknown desktop theme: ${arg}\nAvailable: ${availableThemes.map(t => t.name).join(', ')}`
      }

      setTheme(target.name)

      return `Desktop theme switched to ${target.label}.`
    },
    [availableThemes, setTheme, themeName]
  )
}
