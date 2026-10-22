import { describe, expect, it } from 'vitest'

import { KEYBIND_ACTIONS, KEYBIND_READONLY } from '@/lib/keybinds/actions'

import {
  $keybindsSheetOpen,
  detectKeybindConflicts,
  DISPATCHED_KEYBIND_ENTRIES,
  fixedRowsForGroup,
  groupForAction,
  groupForReadonly,
  KEYBIND_GROUP_ORDER,
  KEYBIND_TABLE,
  keybindSheetRows,
  setKeybindsSheetOpen,
  suggestAlternative,
  toggleKeybindsSheet,
  validateDispatchedKeybinds
} from './keybinds-registry'

// Step 16 · T9 (方案 §3-T9 T9-4): the registry is the single source of truth
// for the four-group table + scope-aware conflict detection. Both the settings
// page and the ? sheet read ONLY from here (A5-⑤ 同源).

describe('four-group mapping (T9-1)', () => {
  it('exposes exactly the four plan groups', () => {
    expect(KEYBIND_GROUP_ORDER).toEqual(['global', 'sessionApproval', 'editing', 'navigationView'])
  })

  it('places the plan-table keys in their plan groups', () => {
    // 全局
    expect(groupForAction('nav.commandPalette')).toBe('global')
    expect(groupForAction('session.new')).toBe('global')
    expect(groupForAction('nav.settings')).toBe('global')
    // 会话与审批: find-in-page / terminal / Esc stop override their categories
    expect(groupForAction('view.findInPage', 'view')).toBe('sessionApproval')
    expect(groupForAction('view.showTerminal', 'view')).toBe('sessionApproval')
    expect(groupForReadonly('composer.cancel', 'composer')).toBe('sessionApproval')
    // 编辑
    expect(groupForReadonly('composer.send', 'composer')).toBe('editing')
    expect(groupForAction('composer.focus', 'composer')).toBe('editing')
    // 导航与视图 (the catch-all)
    expect(groupForAction('view.toggleSidebar', 'view')).toBe('navigationView')
    expect(groupForAction('profile.switch.1', 'profiles')).toBe('navigationView')
  })

  it('maps EVERY built-in action and readonly row into exactly one group (no loss)', () => {
    for (const action of KEYBIND_ACTIONS) {
      expect(KEYBIND_GROUP_ORDER).toContain(groupForAction(action.id, action.category))
    }

    for (const shortcut of KEYBIND_READONLY) {
      expect(KEYBIND_GROUP_ORDER).toContain(groupForReadonly(shortcut.id, shortcut.category))
    }
  })
})

describe('curated T9 table (T9-2 速查页数据源)', () => {
  it('covers every row of the plan keybind table with a label id present in the group map', () => {
    const ids = KEYBIND_TABLE.map(entry => entry.id)

    // 全局 7 rows
    for (const id of [
      'nav.commandPalette',
      'session.new',
      't9.newForensics',
      't9.newCtf',
      't9.newProject',
      't9.quickCapture',
      'nav.settings'
    ]) {
      expect(ids).toContain(id)
    }

    // 会话与审批: slots + find + terminal + stop + approval trio
    for (const id of [
      't9.sessionSlots',
      'view.findInPage',
      'view.showTerminal',
      'composer.cancel',
      't9.approvalOnce',
      't9.approvalSession',
      't9.approvalDeny'
    ]) {
      expect(ids).toContain(id)
    }

    // 编辑: send / newline / history / evidence quote
    for (const id of ['composer.send', 'composer.newline', 'composer.history', 't9.evidenceQuote']) {
      expect(ids).toContain(id)
    }

    expect(ids).toContain('t9.quickSheet')
  })

  it('resolves actionId rows live from store/keybinds (same source as the settings page)', () => {
    const rows = keybindSheetRows()
    const palette = rows.find(row => row.id === 'nav.commandPalette')

    // nav.commandPalette ships mod+k + mod+p — resolved through bindingsFor,
    // not a static copy.
    expect(palette?.actionId).toBe('nav.commandPalette')
    expect(palette?.combos.length).toBeGreaterThanOrEqual(1)
    expect(palette?.combos).toEqual(expect.arrayContaining([expect.stringMatching(/^mod\+k$/)]))
  })

  it('compresses the session-slot row to one chord shape derived from slot 1', () => {
    const row = keybindSheetRows().find(entry => entry.id === 't9.sessionSlots')

    expect(row?.combos).toEqual(['ctrl+1..9'])
  })

  it('marks unimplemented feature chords reserved, never active (T9-5 诚实落地)', () => {
    const reserved = KEYBIND_TABLE.filter(entry => entry.status === 'reserved').map(entry => entry.id)

    // T6 kind-aware creation consumer missing; Ctrl+E evidence-quote chain missing.
    expect(reserved).toEqual(['t9.newForensics', 't9.newCtf', 't9.newProject', 't9.evidenceQuote'])

    for (const entry of KEYBIND_TABLE) {
      if (entry.status === 'active') {
        // Every active row resolves to real chords: an actionId (live bindings),
        // static combos, or — for the slot summary row — the dynamic resolver
        // (asserted separately above).
        const dynamic = entry.id === 't9.sessionSlots'

        expect(entry.actionId !== undefined || (entry.combos?.length ?? 0) > 0 || dynamic).toBe(true)
      }
    }
  })

  it('offers fixed (non-rebindable, non-readonly) rows per group for the settings page', () => {
    const globalFixed = fixedRowsForGroup('global').map(row => row.id)

    expect(globalFixed).toEqual(['t9.newForensics', 't9.newCtf', 't9.newProject', 't9.quickCapture'])
    expect(fixedRowsForGroup('editing').map(row => row.id)).toEqual(['t9.evidenceQuote'])
    // Readonly rows (composer.send …) and the sheet-only slot row stay out —
    // the settings page renders those from their own sources.
    expect(fixedRowsForGroup('sessionApproval').map(row => row.id)).toEqual([
      't9.approvalOnce',
      't9.approvalSession',
      't9.approvalDeny'
    ])
  })
})

describe('detectKeybindConflicts (pure, scope-aware)', () => {
  it('flags two entries claiming one combo in the SAME group and scope', () => {
    const conflicts = detectKeybindConflicts([
      { combos: ['mod+k'], id: 'a', scope: 'app' },
      { combos: ['mod+k'], id: 'b', scope: 'app' }
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.canonical).toBe('mod+k')
    expect(conflicts[0]?.ids).toEqual(['a', 'b'])
  })

  it('flags conflicts across GROUPS when the scope matches (cross-group sample)', () => {
    const conflicts = detectKeybindConflicts([
      { combos: ['mod+g'], id: 'global-row', scope: 'app' },
      { combos: ['ctrl+g'], id: 'editing-row', scope: 'app' } // ctrl folds to mod off macOS
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.ids).toEqual(['editing-row', 'global-row'])
  })

  it('never flags the same combo across scopes (cross-scope sample)', () => {
    expect(
      detectKeybindConflicts([
        { combos: ['ctrl+1'], id: 'tray-new-forensics', scope: 'os' },
        { combos: ['mod+1'], id: 'palette-zone-jump', scope: 'palette' },
        { combos: ['ctrl+1'], id: 'session-slot-1', scope: 'app' }
      ])
    ).toEqual([])
  })

  it('keeps distinct combos conflict-free', () => {
    expect(
      detectKeybindConflicts([
        { combos: ['mod+k'], id: 'a', scope: 'app' },
        { combos: ['mod+n'], id: 'b', scope: 'app' }
      ])
    ).toEqual([])
  })
})

describe('validateDispatchedKeybinds (T9-4 硬验收: 零冲突)', () => {
  it('T6 (tray Ctrl+1/2/3, Ctrl+Shift+F) + T7 (Ctrl+Shift+Space) + T8 (Ctrl+K + palette Ctrl 1-9) + the active table are pairwise conflict-free', () => {
    expect(validateDispatchedKeybinds()).toEqual([])
  })

  it('records the dispatched chords under their own scopes', () => {
    const scopes = DISPATCHED_KEYBIND_ENTRIES.map(entry => entry.scope)

    expect(scopes).toContain('os')
    expect(scopes).toContain('palette')
  })

  it('would catch a collision if a new dispatched chord double-claimed an existing one', () => {
    // Mutation probe of the check itself: claim Ctrl+Shift+Space (the T7 row
    // the table carries) in the same os scope and the validator must report it.
    const conflicts = detectKeybindConflicts([
      ...DISPATCHED_KEYBIND_ENTRIES,
      ...keybindSheetRows(),
      { combos: ['ctrl+shift+space'], id: 't6.bogus-double-claim', scope: 'os' }
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.ids).toEqual(['t6.bogus-double-claim', 't9.quickCapture'])
  })
})

describe('suggestAlternative (冲突替代建议)', () => {
  it('stacks shift first, then alt, then both, skipping taken candidates', () => {
    const taken = new Set(['mod+shift+k', 'mod+alt+k'])

    expect(suggestAlternative('mod+k', taken)).toBe('mod+shift+alt+k')
  })

  it('returns the first free rung of the ladder', () => {
    expect(suggestAlternative('mod+k', new Set())).toBe('mod+shift+k')
    expect(suggestAlternative('mod+k', new Set(['mod+shift+k']))).toBe('mod+alt+k')
  })

  it('respects modifiers the combo already carries', () => {
    // mod+shift+1 already has shift → alt rung first.
    expect(suggestAlternative('mod+shift+1', new Set())).toBe('mod+alt+1')
  })

  it('returns null for bare modifiers and exhausted ladders', () => {
    expect(suggestAlternative('mod+shift', new Set())).toBeNull()
    expect(suggestAlternative('mod+k', new Set(['mod+shift+k', 'mod+alt+k', 'mod+shift+alt+k']))).toBeNull()
  })
})

describe('? cheat-sheet open state', () => {
  it('toggles and sets session-only state', () => {
    setKeybindsSheetOpen(false)
    expect($keybindsSheetOpen.get()).toBe(false)

    toggleKeybindsSheet()
    expect($keybindsSheetOpen.get()).toBe(true)

    toggleKeybindsSheet()
    expect($keybindsSheetOpen.get()).toBe(false)

    setKeybindsSheetOpen(true)
    expect($keybindsSheetOpen.get()).toBe(true)
    setKeybindsSheetOpen(false)
  })
})
