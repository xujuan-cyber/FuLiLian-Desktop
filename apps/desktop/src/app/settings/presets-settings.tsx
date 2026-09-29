import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { CAPABILITY_PRESETS, type CapabilityPreset, PRESET_TOOLSETS } from '@/lib/personalities'
import { cn } from '@/lib/utils'
import { $activePreset, setActivePreset } from '@/store/presets'

import { SettingsContent } from './primitives'

// Settings → Agent preset.
//
// The card grid is the user-facing half of the phase-13 capability presets; the
// other half the user never sees is the toolset gate the backend enforces from
// the same table (`fulilian_cli/personality.py PRESET_TOOLSETS`, mirrored in
// `lib/personalities.ts`). Card anatomy follows the reference design: badge →
// title → body → mono identifier. The identifier is not decoration — it is the
// exact string that shows up in the session header chip and in the backend's
// own toolset resolution, which is why it stays in mono even when the title is
// translated.
//
// Selecting only changes what the NEXT session is created with: a preset is
// baked into an agent when the session is built, so pretending an open chat
// switched under the user would be a lie. `applyNote` says so on the page.

interface PresetCard {
  description: string
  id: CapabilityPreset
  name: string
  toolsets: readonly string[]
}

export function PresetsSettings() {
  const { t } = useI18n()
  const activePreset = useStore($activePreset)
  const [query, setQuery] = useState('')

  const copy = t.presets

  const cards = useMemo<PresetCard[]>(() => {
    const needle = query.trim().toLowerCase()

    const all = CAPABILITY_PRESETS.map(id => ({
      description: copy.names[id].description,
      id,
      name: copy.names[id].name,
      toolsets: PRESET_TOOLSETS[id]
    }))

    if (!needle) {
      return all
    }

    return all.filter(
      card =>
        card.id.includes(needle) ||
        card.name.toLowerCase().includes(needle) ||
        card.description.toLowerCase().includes(needle)
    )
  }, [copy, query])

  const select = (id: CapabilityPreset) => {
    triggerHaptic('selection')
    setActivePreset(id)
  }

  return (
    <SettingsContent>
      <header className="mb-3 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
            {copy.title}
          </h2>
          <Badge size="xs" variant="muted">
            {copy.badgeBuiltin}
          </Badge>
        </div>
        <p className="max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {copy.subtitle}
        </p>
        <p className="text-[0.68rem] text-muted-foreground/60">{copy.applyNote}</p>
      </header>

      <div className="mb-3 flex items-center gap-2">
        <SearchField
          containerClassName="w-full max-w-sm"
          onChange={setQuery}
          placeholder={copy.searchPlaceholder}
          value={query}
        />
        {activePreset !== null ? (
          <Button className="shrink-0" onClick={() => setActivePreset(null)} size="xs" variant="text">
            {copy.none}
          </Button>
        ) : (
          <span className="shrink-0 text-[0.68rem] text-muted-foreground/60">{copy.none}</span>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="grid place-items-center gap-1 py-12 text-center">
          <p className="text-sm font-medium text-foreground/90">{copy.emptyTitle}</p>
          <p className="text-xs text-muted-foreground/75">{copy.emptyDesc}</p>
        </div>
      ) : (
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            {cards.map(card => (
              <PresetCardTile
                active={activePreset === card.id}
                card={card}
                key={card.id}
                onSelect={() => select(card.id)}
              />
            ))}
          </div>
        </div>
      )}
    </SettingsContent>
  )
}

function PresetCardTile({
  active,
  card,
  onSelect
}: {
  active: boolean
  card: PresetCard
  onSelect: () => void
}) {
  const { t } = useI18n()
  const copy = t.presets

  return (
    <button
      aria-pressed={active}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border p-3 text-left transition-colors',
        active
          ? 'border-primary/45 bg-primary/[0.06] hover:bg-primary/[0.09]'
          : 'border-(--ui-stroke-secondary) hover:bg-(--ui-row-hover-background)'
      )}
      data-slot="preset-card"
      onClick={onSelect}
      type="button"
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
          {card.name}
        </span>
        <Badge size="xs" variant="muted">
          {copy.badgeBuiltin}
        </Badge>
        {active ? <Badge size="xs">{copy.badgeActive}</Badge> : null}
      </span>

      <span className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {card.description}
      </span>

      <span className="mt-auto grid gap-1">
        <span className="font-mono text-[0.68rem] text-muted-foreground/60">{card.id}</span>
        <span className="font-mono text-[0.66rem] text-muted-foreground/45">
          {copy.toolsetCount(card.toolsets.length)}
        </span>
        <span className="flex flex-wrap gap-1">
          {card.toolsets.map(name => (
            <span
              className="rounded-[3px] border border-(--ui-stroke-tertiary) px-1 py-px font-mono text-[0.6rem] text-muted-foreground/55"
              key={name}
            >
              {name}
            </span>
          ))}
        </span>
      </span>
    </button>
  )
}
