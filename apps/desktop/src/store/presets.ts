import { type CapabilityPreset, isCapabilityPreset, presetToolsets } from '@/lib/personalities'
import { type Codec, Codecs, persistentAtom } from '@/lib/persisted'

// Phase-13 capability presets, client side.
//
// A preset has two halves: instruction text (backend `personality.py`) and a
// **toolset whitelist** (backend `PRESET_TOOLSETS`). Only the whitelist is
// load-bearing for the gate — it rides on `session.create` as the optional
// `toolsets` parameter, and the backend resolves it in preference to
// `platform_toolsets` for that one session. Nothing here can widen a preset:
// the renderer ships names, the backend decides what they mean.
//
// Two separate records, because they answer different questions:
//
// * `$activePreset` — which preset the NEXT session is created with (the
//   user's current selection, shown as "in use" in the picker);
// * `$sessionPreset` — which preset a LIVE session was actually created with.
//   A preset is baked into the agent when the session is built; switching
//   mid-session is deliberately not a thing (it would need a whole rebuild
//   RPC), so the chip must report the session's own preset, not the pending
//   selection, or it would be lying about what tools that chat has.

const ACTIVE_PRESET_KEY = 'fulilian.desktop.preset.active'
const SESSION_PRESET_KEY = 'fulilian.desktop.preset.bySession'

const activePresetCodec: Codec<CapabilityPreset | null> = {
  decode: raw => (isCapabilityPreset(raw) ? raw : null),
  encode: value => value
}

const sessionPresetCodec = Codecs.json<Record<string, CapabilityPreset>>(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, CapabilityPreset] =>
        typeof entry[1] === 'string' && isCapabilityPreset(entry[1])
    )
  )
})

/** The preset new sessions are created with; `null` = the platform default. */
export const $activePreset = persistentAtom<CapabilityPreset | null>(ACTIVE_PRESET_KEY, null, activePresetCodec)

/** Preset each created session runs under, keyed by its stored session id. */
export const $sessionPreset = persistentAtom<Record<string, CapabilityPreset>>(
  SESSION_PRESET_KEY,
  {},
  sessionPresetCodec
)

/** The preset a live session was created with (`null` when none / unknown). */
export function sessionPreset(storedSessionId: null | string | undefined): CapabilityPreset | null {
  if (!storedSessionId) {
    return null
  }

  return $sessionPreset.get()[storedSessionId] ?? null
}

/** Select the preset applied to subsequent `session.create` calls. */
export function setActivePreset(preset: CapabilityPreset | null): void {
  $activePreset.set(preset)
}

/** Record the preset a freshly created session actually got. */
export function rememberSessionPreset(storedSessionId: null | string | undefined, preset: CapabilityPreset | null): void {
  if (!storedSessionId) {
    return
  }

  const current = $sessionPreset.get()

  if (preset === null) {
    if (!(storedSessionId in current)) {
      return
    }

    const { [storedSessionId]: _dropped, ...rest } = current
    $sessionPreset.set(rest)

    return
  }

  if (current[storedSessionId] === preset) {
    return
  }

  $sessionPreset.set({ ...current, [storedSessionId]: preset })
}

/**
 * The `toolsets` value to ship on `session.create` for the active preset.
 * `undefined` (not `[]`) when there is no preset: the parameter is then
 * omitted entirely and the backend keeps its platform resolution, which is the
 * whole zero-behaviour-change contract.
 */
export function activePresetToolsets(): string[] | undefined {
  return presetToolsets($activePreset.get()) ?? undefined
}

/** True when the preset is a real one — guards the picker against stale ids. */
export function isValidPreset(value: null | string | undefined): value is CapabilityPreset {
  return isCapabilityPreset(value)
}
