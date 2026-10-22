import { useStore } from '@nanostores/react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Layers3 } from '@/lib/icons'
import { CAPABILITY_PRESETS, type CapabilityPreset } from '@/lib/personalities'
import { cn } from '@/lib/utils'
import { $activePreset, $sessionPreset, setActivePreset } from '@/store/presets'

const NO_PRESET = '__none__'

/**
 * The session header's capability-preset chip — always on screen, so which
 * tool surface the open chat actually has is never a guess.
 *
 * Two values, deliberately kept apart:
 *
 * * the **chip label** is what THIS session runs with (baked in when the agent
 *   was built). A preset is not a live switch; showing the pending selection
 *   here would misreport the tools this chat has right now. A session with no
 *   recorded preset — created before presets existed, by another surface, or
 *   with its record cleared — resolves its toolsets from the platform config,
 *   so it shows "no preset" rather than borrowing the pending one. Only a
 *   brand-new draft (no session yet) falls back to the pending selection,
 *   because there that selection IS what the session will be created with.
 * * the **menu's selection** is what the NEXT session will be created with.
 *
 * When they differ the menu says so. That mismatch is the honest state right
 * after switching a preset while an older chat is open, and silently hiding it
 * (or pretending the open chat changed) is exactly the "chip that lies" the
 * phase-13 brief rules out.
 */
export function PresetChip({ storedSessionId }: { storedSessionId: null | string }) {
  const { t } = useI18n()
  const activePreset = useStore($activePreset)
  const sessionPresets = useStore($sessionPreset)
  const copy = t.presets

  const baked = storedSessionId ? (sessionPresets[storedSessionId] ?? null) : null
  // REV-13 §3-B13: an EXISTING session with no recorded preset resolves its
  // toolsets from the platform config — a real, different gate, and never
  // "whatever is currently pending for the next chat". Only a brand-new draft
  // (no session yet) may fall back to the pending selection, because there the
  // pending selection IS what the session will be created with.
  const shown = baked ?? (storedSessionId ? null : activePreset)
  const label = shown ? copy.names[shown].name : copy.none

  const select = (value: string) => {
    triggerHaptic('selection')
    setActivePreset(value === NO_PRESET ? null : (value as CapabilityPreset))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={copy.chipAriaLabel(label)}
          className={cn(
            'pointer-events-auto inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[0.66rem] font-medium transition-colors',
            shown
              ? 'border-(--ui-warm)/35 bg-(--ui-warm)/10 text-(--ui-warm) hover:bg-(--ui-warm)/15'
              : 'border-(--ui-stroke-secondary) text-muted-foreground/75 hover:text-foreground'
          )}
          data-slot="preset-chip"
          type="button"
        >
          <Layers3 className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{label}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>{copy.chipTitle}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup onValueChange={select} value={activePreset ?? NO_PRESET}>
          <DropdownMenuRadioItem value={NO_PRESET}>{copy.none}</DropdownMenuRadioItem>
          {CAPABILITY_PRESETS.map(preset => (
            <DropdownMenuRadioItem key={preset} value={preset}>
              {copy.names[preset].name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {/* Always stated, not only on mismatch: the rule ("new sessions only")
            is the one thing a user picking a preset needs to know, and a note
            that appears only sometimes is a note nobody reads. */}
        <p className="px-2 py-1 text-[0.66rem] leading-snug text-muted-foreground/70">{copy.applyNote}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
