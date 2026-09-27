import { atom, computed } from 'nanostores'

import type { WslCliName, WslCliOptin, WslCliOptinState, WslCliProbeEntry, WslCliProbeResult } from '@/global'

/**
 * A concrete terminal target: a CLI inside a named WSL distro. This is the exact
 * shape frozen by the step09 contract (§四 C) for `terminal.start({ wsl })` and
 * for the per-tab `TerminalEntry.wsl` field; `null` means the local shell.
 */
export interface WslCliTarget {
  distro: string
  cli: WslCliName
}

/** Last probe snapshot (`error !== null` ⇒ degraded, availability unknown). */
export const $wslCliProbe = atom<null | WslCliProbeResult>(null)
/** Opt-in table mirrored from the main process; null until the first load. */
export const $wslCliOptin = atom<null | WslCliOptinState>(null)
/** Last CLI the user picked in the terminal switcher (global mirror; the tab
 *  itself is the source of truth for what a session actually runs). */
export const $wslCliSelected = atom<null | WslCliTarget>(null)

/**
 * CLIs the terminal switcher may offer: opted in AND probed available, in
 * contract order (probe entries are already ordered by `WSL_CLI_NAMES`).
 *
 * A degraded probe (`error !== null`) has every entry `available:false`, so this
 * list is empty — by design: we never offer a launch target whose binary we
 * could not confirm. The opt-in TABLE is deliberately untouched by a failed
 * probe, so the user's checkboxes survive (see `probeWslClis` below).
 */
export const $wslCliEnabledClis = computed(
  [$wslCliProbe, $wslCliOptin],
  (probe, optin): WslCliName[] => {
    if (!probe || !optin) {
      return []
    }

    const flags: WslCliOptin = optin.optin

    return probe.entries
      .filter((entry: WslCliProbeEntry) => entry.available && flags[entry.name] === true)
      .map((entry: WslCliProbeEntry) => entry.name)
  }
)

/** The preload bridge, or undefined outside the desktop shell (tests, web). */
function bridge() {
  return typeof window === 'undefined' ? undefined : window.fulilianDesktop?.wslCli
}

/**
 * Load the persisted opt-in table. Every action degrades silently when the
 * bridge is absent or the IPC call rejects — these are pure conveniences for
 * the UI and must never throw into render.
 */
export async function loadWslCliOptin(): Promise<null | WslCliOptinState> {
  const api = bridge()

  if (!api) {
    return null
  }

  try {
    const state = await api.getOptin()

    $wslCliOptin.set(state)

    return state
  } catch {
    return null
  }
}

/**
 * Probe the WSL CLIs. Mirrors the result into `$wslCliProbe` and NOTHING else —
 * in particular it never rewrites `$wslCliOptin`: a degraded probe must not
 * erase the user's selections (contract §四 D).
 */
export async function probeWslClis(options?: {
  distro?: string
  force?: boolean
}): Promise<null | WslCliProbeResult> {
  const api = bridge()

  if (!api) {
    return null
  }

  try {
    const result = await api.probe(options)

    $wslCliProbe.set(result)

    return result
  } catch {
    return null
  }
}

/**
 * Merge-write opt-in flags (the main process merges the patch over all five
 * keys). Returns the resulting state, or null when the bridge is unavailable —
 * the caller decides whether that warrants a notification.
 */
export async function setWslCliOptin(patch: Partial<WslCliOptin>): Promise<null | WslCliOptinState> {
  const api = bridge()

  if (!api) {
    return null
  }

  try {
    const state = await api.setOptin({ optin: patch })

    $wslCliOptin.set(state)

    return state
  } catch {
    return null
  }
}

/** Mirror the switcher's pick (null = back to the local shell). */
export function selectWslCli(target: null | WslCliTarget): void {
  $wslCliSelected.set(target)
}
