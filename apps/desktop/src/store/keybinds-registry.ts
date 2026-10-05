import { atom } from 'nanostores'

import { KEYBIND_READONLY, type KeybindCategory, keybindAction } from '@/lib/keybinds/actions'
import { canonicalizeCombo } from '@/lib/keybinds/combo'

import { bindingsFor } from './keybinds'

// Step 16 · T9 (方案 §3-T9): the keybind TABLE — one source of truth that both
// the ? cheat sheet (`components/keybinds-sheet`) and the keybinds settings
// page read. This is an ORGANIZATION + ACCOUNTING layer on top of the
// rebindable-action runtime in `store/keybinds.ts` / `lib/keybinds/actions.ts`:
// it groups actions into the plan's four groups, curates the sheet's fixed
// rows, and owns the scope-aware conflict check over the chords dispatched
// outside the rebindable table (T6 tray / T7 capture / T8 palette).
//
// Honesty rule (T9-5): a chord whose feature chain doesn't exist yet is
// registered with status 'reserved' — never presented as working.

// ── The four T9 groups ──────────────────────────────────────────────────────

export type KeybindGroupId = 'global' | 'sessionApproval' | 'editing' | 'navigationView'

export const KEYBIND_GROUP_ORDER: readonly KeybindGroupId[] = [
  'global',
  'sessionApproval',
  'editing',
  'navigationView'
]

// Legacy five-category → T9-group default mapping. Deriving from the category
// keeps plugin-contributed actions placed automatically (they default to
// `view` → navigation & view).
const GROUP_BY_CATEGORY: Record<KeybindCategory, KeybindGroupId> = {
  composer: 'editing',
  profiles: 'navigationView',
  session: 'sessionApproval',
  navigation: 'navigationView',
  view: 'navigationView'
}

// 方案 §3-T9 键位表 overrides: rows the plan files under a different group
// than their category implies. Everything else follows GROUP_BY_CATEGORY.
const GROUP_OVERRIDES: Record<string, KeybindGroupId> = {
  // 全局: panel / new / settings.
  'nav.commandPalette': 'global',
  'nav.settings': 'global',
  'session.new': 'global',
  // 会话与审批: find-in-page (Ctrl+F), terminal focus (Ctrl+`), Esc stop.
  'view.findInPage': 'sessionApproval',
  'view.showTerminal': 'sessionApproval',
  'composer.cancel': 'sessionApproval',
  // keybinds.openPanel (⌘/) documents the settings page itself → nav & view.
  'keybinds.openPanel': 'navigationView',
  'appearance.toggleMode': 'navigationView'
}

export function groupForAction(id: string, category?: KeybindCategory): KeybindGroupId {
  const override = GROUP_OVERRIDES[id]

  if (override) {
    return override
  }

  const resolved = category ?? keybindAction(id)?.category

  return resolved ? (GROUP_BY_CATEGORY[resolved] ?? 'navigationView') : 'navigationView'
}

// Same mapping for the fixed (non-rebindable) rows of KEYBIND_READONLY.
export function groupForReadonly(id: string, category: KeybindCategory): KeybindGroupId {
  return GROUP_OVERRIDES[id] ?? GROUP_BY_CATEGORY[category]
}

// ── Curated T9 table (the ? sheet's rows) ───────────────────────────────────

/** Where a chord is claimed. Conflicts are only counted WITHIN one scope. */
export type KeybindEntryScope =
  | 'app' // renderer global dispatcher (store/keybinds.ts $comboIndex)
  | 'os' // OS-side: T6 tray-menu accelerators + T7 quick-capture globalShortcut
  | 'palette' // T8 command palette, only while ⌘K is open
  | 'approval' // approval strip, only while the strip holds focus

/** 'reserved' = the chord is documented but its feature chain isn't wired yet. */
export type KeybindEntryStatus = 'active' | 'reserved'

export interface KeybindTableEntry {
  /** Label id under `t.keybinds.actions`. */
  id: string
  group: KeybindGroupId
  /** Live-resolved row: combos come from the user's bindings for this action. */
  actionId?: string
  /** Static combos (canonical form) for fixed / reserved rows. */
  combos?: readonly string[]
  scope: KeybindEntryScope
  status: KeybindEntryStatus
}

export const KEYBIND_TABLE: readonly KeybindTableEntry[] = [
  // ── 全局 (方案 §3-T9: 面板 / 新建 / 三模式 / 捕获 / 设置) ──────────────────
  { id: 'nav.commandPalette', group: 'global', actionId: 'nav.commandPalette', scope: 'app', status: 'active' },
  { id: 'session.new', group: 'global', actionId: 'session.new', scope: 'app', status: 'active' },
  // T6 tray accelerators (electron/tray.ts TRAY_ACCELERATORS). The menu items
  // dispatch kind payloads over IPC, but the renderer's kind-aware creation
  // consumer doesn't exist yet (T6 回执 §6.1) → reserved, honestly shown.
  { id: 't9.newForensics', group: 'global', combos: ['ctrl+1'], scope: 'os', status: 'reserved' },
  { id: 't9.newCtf', group: 'global', combos: ['ctrl+2'], scope: 'os', status: 'reserved' },
  { id: 't9.newProject', group: 'global', combos: ['ctrl+3'], scope: 'os', status: 'reserved' },
  // T7 quick capture — real merged global key (electron/quick-entry.ts).
  { id: 't9.quickCapture', group: 'global', combos: ['ctrl+shift+space'], scope: 'os', status: 'active' },
  { id: 'nav.settings', group: 'global', actionId: 'nav.settings', scope: 'app', status: 'active' },

  // ── 会话与审批 (方案 §3-T9: 切换 / 查找 / 终端 / 停止 + 审批三键) ──────────
  // One compact row for the nine session slots; per-slot live bindings stay on
  // the settings page (group sessionApproval there too, via groupForAction).
  { id: 't9.sessionSlots', group: 'sessionApproval', scope: 'app', status: 'active' },
  { id: 'view.findInPage', group: 'sessionApproval', actionId: 'view.findInPage', scope: 'app', status: 'active' },
  { id: 'view.showTerminal', group: 'sessionApproval', actionId: 'view.showTerminal', scope: 'app', status: 'active' },
  { id: 'composer.cancel', group: 'sessionApproval', combos: ['escape'], scope: 'app', status: 'active' },
  // Approval three-key row set — wired in tool/approval.tsx, only while the
  // approval strip holds focus (scope 'approval').
  { id: 't9.approvalOnce', group: 'sessionApproval', combos: ['y'], scope: 'approval', status: 'active' },
  { id: 't9.approvalSession', group: 'sessionApproval', combos: ['a'], scope: 'approval', status: 'active' },
  { id: 't9.approvalDeny', group: 'sessionApproval', combos: ['n'], scope: 'approval', status: 'active' },

  // ── 编辑 (方案 §3-T9: 发送 / 换行 / 历史 / 引用证据) ───────────────────────
  { id: 'composer.send', group: 'editing', combos: ['enter'], scope: 'app', status: 'active' },
  { id: 'composer.newline', group: 'editing', combos: ['shift+enter'], scope: 'app', status: 'active' },
  // Shipped history keys are the bare ↑/↓ (KEYBIND_READONLY), NOT the plan's
  // Alt+↑↓ — the composer side is outside T9's file face, so the sheet shows
  // the real chords and the deviation is recorded in the T9 回执.
  { id: 'composer.history', group: 'editing', combos: ['up', 'down'], scope: 'app', status: 'active' },
  // Ctrl+E 引用证据: no existing handler chain (T9-5 诚实落地) → reserved.
  { id: 't9.evidenceQuote', group: 'editing', combos: ['ctrl+e'], scope: 'app', status: 'reserved' },

  // ── 导航与视图 ─────────────────────────────────────────────────────────────
  { id: 'session.next', group: 'navigationView', actionId: 'session.next', scope: 'app', status: 'active' },
  { id: 'session.prev', group: 'navigationView', actionId: 'session.prev', scope: 'app', status: 'active' },
  { id: 'view.flipPanes', group: 'navigationView', actionId: 'view.flipPanes', scope: 'app', status: 'active' },
  // Zoom lives in the application menu (electron/application-menu.ts); the
  // Plus accelerator is rendered as '=' (same physical key, avoids the '+'
  // combo separator).
  { id: 't9.zoom', group: 'navigationView', combos: ['mod+0', 'mod+=', 'mod+-'], scope: 'app', status: 'active' },
  { id: 'keybinds.openPanel', group: 'navigationView', actionId: 'keybinds.openPanel', scope: 'app', status: 'active' },
  // This sheet itself.
  { id: 't9.quickSheet', group: 'navigationView', combos: ['?'], scope: 'app', status: 'active' }
]

export interface ResolvedKeybindRow extends KeybindTableEntry {
  combos: readonly string[]
}

// The sheet's session-slot row compresses slots 1-9 into one chord shape
// derived from slot 1's live binding (so a rebind of the modifiers shows up);
// the per-slot rows live on the settings page.
function sessionSlotSummaryCombos(): string[] {
  const first = bindingsFor('session.slot.1')[0]

  if (!first) {
    return ['ctrl+1..9']
  }

  const tokens = first.split('+')

  tokens[tokens.length - 1] = '1..9'

  return [tokens.join('+')]
}

/** Table rows with their display combos resolved (live for actionId rows). */
export function keybindSheetRows(): ResolvedKeybindRow[] {
  return KEYBIND_TABLE.map(entry => {
    if (entry.id === 't9.sessionSlots') {
      return { ...entry, combos: sessionSlotSummaryCombos() }
    }

    if (entry.actionId) {
      return { ...entry, combos: bindingsFor(entry.actionId) }
    }

    return { ...entry, combos: [...(entry.combos ?? [])] }
  })
}

/** Fixed (non-rebindable) T9 rows for a group, for the settings page. */
export function fixedRowsForGroup(group: KeybindGroupId): ResolvedKeybindRow[] {
  return keybindSheetRows().filter(
    row => row.group === group && !row.actionId && row.id !== 't9.sessionSlots' && !isReadonlyRow(row.id)
  )
}

// Rows whose label/combos come from KEYBIND_READONLY (composer.send etc.) are
// rendered by the settings page's ReadonlyRow already — the fixed T9 rows here
// are only the ones with no existing panel row.
function isReadonlyRow(id: string): boolean {
  return KEYBIND_READONLY.some(shortcut => shortcut.id === id)
}

// ── Conflict detection (pure) ───────────────────────────────────────────────

export interface KeybindConflictInput {
  id: string
  combos: readonly string[]
  scope: KeybindEntryScope
}

export interface KeybindConflict {
  /** Canonical (scope-folded) combo shared by every id below. */
  canonical: string
  scope: KeybindEntryScope
  /** Distinct entry ids claiming the same combo in the same scope. */
  ids: string[]
}

/**
 * Scope-aware conflict detection (方案 §3-T9 T9-4): two entries conflict iff
 * they claim the same canonical combo in the SAME scope. Cross-scope pairs
 * (e.g. the palette's Ctrl 1-9 zone jump vs the tray's Ctrl 1/2/3) never
 * collide by construction — that's what the scope bookkeeping documents.
 */
export function detectKeybindConflicts(entries: readonly KeybindConflictInput[]): KeybindConflict[] {
  const claims = new Map<string, { scope: KeybindEntryScope; ids: Set<string> }>()

  for (const entry of entries) {
    for (const combo of entry.combos) {
      const canonical = canonicalizeCombo(combo)
      const key = `${entry.scope}::${canonical}`
      const claim = claims.get(key) ?? { ids: new Set<string>(), scope: entry.scope }

      claim.ids.add(entry.id)
      claims.set(key, claim)
    }
  }

  return [...claims.entries()]
    .filter(([, claim]) => claim.ids.size > 1)
    .map(([key, claim]) => ({ canonical: key.split('::')[1] ?? '', ids: [...claim.ids].sort(), scope: claim.scope }))
    .sort((a, b) => (a.scope + a.canonical).localeCompare(b.scope + b.canonical))
}

// Chords dispatched OUTSIDE the rebindable table (T6 / T7 / T8), recorded so
// the unified check covers them. The T6 tray trio and T7 capture ARE the
// table's os-scope rows (t9.new* / t9.quickCapture) — they enter through
// KEYBIND_TABLE and are not duplicated here; T8's ⌘K likewise comes in via the
// table's `nav.commandPalette` actionId row.
export const DISPATCHED_KEYBIND_ENTRIES: readonly KeybindConflictInput[] = [
  { id: 't6.openMainWindow', combos: ['ctrl+shift+f'], scope: 'os' },
  {
    id: 't8.paletteZoneJump',
    combos: ['mod+1', 'mod+2', 'mod+3', 'mod+4', 'mod+5', 'mod+6', 'mod+7', 'mod+8', 'mod+9'],
    scope: 'palette'
  }
]

/**
 * Unified zero-conflict check (T9-4): the fixed dispatched chords (T6/T7/T8)
 * plus every active table row must be pairwise conflict-free within a scope.
 * Returns [] when clean — asserted by `keybinds-registry.test.ts`.
 */
export function validateDispatchedKeybinds(): KeybindConflict[] {
  const tableEntries: KeybindConflictInput[] = KEYBIND_TABLE.filter(entry => entry.status === 'active').map(
    entry => ({
      combos:
        entry.id === 't9.sessionSlots'
          ? sessionSlotSummaryCombos()
          : (entry.actionId ? bindingsFor(entry.actionId) : entry.combos) ?? [],
      id: entry.actionId ?? entry.id,
      scope: entry.scope
    })
  )

  return detectKeybindConflicts([...DISPATCHED_KEYBIND_ENTRIES, ...tableEntries])
}

const SUGGEST_LADDER: readonly (readonly string[])[] = [['shift'], ['alt'], ['shift', 'alt']]

/**
 * First free variant of `combo` by stacking modifiers (mod+shift → mod+alt →
 * mod+shift+alt), checked against the canonical set of taken chords. null when
 * the whole ladder is taken (caller falls back to showing no suggestion).
 */
export function suggestAlternative(combo: string, takenCanonical: ReadonlySet<string>): string | null {
  const canonical = canonicalizeCombo(combo)
  const parts = canonical.split('+')
  const base = parts[parts.length - 1] ?? ''

  if (!base || ['mod', 'ctrl', 'alt', 'shift'].includes(base)) {
    return null
  }

  const has = (mod: string) => parts.includes(mod)

  for (const extras of SUGGEST_LADDER) {
    if (extras.some(mod => has(mod))) {
      continue
    }

    const mods = ['mod', ...extras]
    const candidate = [...mods, base].join('+')

    if (!takenCanonical.has(candidate)) {
      return candidate
    }
  }

  return null
}

// ── ? cheat-sheet open state ────────────────────────────────────────────────
// Session-only. The sheet component owns the ?/Esc listeners; this atom is the
// state both the sheet and tests drive.

export const $keybindsSheetOpen = atom(false)

export function setKeybindsSheetOpen(open: boolean): void {
  $keybindsSheetOpen.set(open)
}

export function toggleKeybindsSheet(): void {
  $keybindsSheetOpen.set(!$keybindsSheetOpen.get())
}
