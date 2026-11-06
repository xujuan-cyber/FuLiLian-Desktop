import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BUILTIN_PERSONALITIES, CAPABILITY_PRESETS, PRESET_TOOLSETS, presetToolsets } from './personalities'

// A6 — the two sides of the personality/preset mirror must be equal.
//
// `fulilian_cli/personality.py` is the single owner; `lib/personalities.ts` is
// the desktop mirror, and its file header says "Keep in sync" — which is a
// comment, not an invariant. This test turns it into one by reading the Python
// source itself: a name added on one side and not the other fails here rather
// than as a silently missing entry in the picker.
//
// It parses the source rather than importing it because there is no Python
// runtime in this test project; the shapes it reads are two declaration blocks
// with a fixed indent, which is exactly what those `Dict[...] = { ... }`
// literals are.

const here = path.dirname(fileURLToPath(import.meta.url))
const PERSONALITY_PY = path.resolve(here, '../../../../fulilian_cli/personality.py')

const source = readFileSync(PERSONALITY_PY, 'utf8')

/** The body of a `NAME: <type> = { ... }` declaration (brace-matched). */
function blockOf(declaration: string): string {
  const start = source.indexOf(declaration)
  expect(start, `${declaration} not found in personality.py`).toBeGreaterThan(-1)

  // The declaration string ends with `{`, so the brace-match starts there.
  const open = start + declaration.length - 1
  let depth = 0

  for (let i = open; i < source.length; i += 1) {
    const char = source[i]

    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1

      if (depth === 0) {
        return source.slice(open + 1, i)
      }
    }
  }

  throw new Error(`unbalanced braces after ${declaration}`)
}

const KEY_AT_4 = /^ {4}(?:"([A-Za-z0-9-]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*:/gm

const keysAtTopLevel = (block: string): string[] =>
  Array.from(block.matchAll(KEY_AT_4))
    .map(match => match[1] ?? match[2]!)
    .sort()

const BUILTIN_BLOCK = blockOf('BUILTIN_PERSONALITIES: Dict[str, Any] = {')
const PRESET_BLOCK = blockOf('PRESET_TOOLSETS: Dict[str, List[str]] = {')

const pythonPersonalityNames = keysAtTopLevel(BUILTIN_BLOCK)

const pythonPresetKeys = Array.from(PRESET_BLOCK.matchAll(/"([A-Za-z0-9-]+)": \[/g))
  .map(match => match[1]!)
  .sort()

/** The toolset list the Python table binds to `preset`. */
function pythonToolsetsFor(preset: string): string[] {
  const keyAt = PRESET_BLOCK.indexOf(`"${preset}": [`)

  expect(keyAt, `PRESET_TOOLSETS has no entry for ${preset}`).toBeGreaterThan(-1)

  const open = PRESET_BLOCK.indexOf('[', keyAt)
  const close = PRESET_BLOCK.indexOf(']', open)

  return Array.from(PRESET_BLOCK.slice(open + 1, close).matchAll(/"([^"]+)"/g))
    .map(match => match[1]!)
    .sort()
}

describe('desktop personality mirror', () => {
  it('stays in sync with fulilian_cli/personality.py', () => {
    expect(pythonPersonalityNames).toEqual([...BUILTIN_PERSONALITIES].sort())
  })

  it('declares exactly the five phase-13 capability presets', () => {
    expect(pythonPresetKeys).toEqual([...CAPABILITY_PRESETS].sort())
    expect([...CAPABILITY_PRESETS]).toHaveLength(5)
  })

  it('does not implement the deferred presets', () => {
    for (const deferred of ['doc', 'minimal']) {
      expect(pythonPersonalityNames).not.toContain(deferred)
      expect(pythonPresetKeys).not.toContain(deferred)
      expect([...BUILTIN_PERSONALITIES]).not.toContain(deferred)
    }
  })

  it('mirrors every preset toolset list verbatim', () => {
    for (const preset of CAPABILITY_PRESETS) {
      expect([...PRESET_TOOLSETS[preset]].sort(), preset).toEqual(pythonToolsetsFor(preset))
    }
  })

  it('binds only toolset names, never tool names', () => {
    // Toolset-level granularity is the whole design: a table that named
    // `read_file` would silently resolve to nothing on the backend.
    for (const preset of CAPABILITY_PRESETS) {
      for (const name of PRESET_TOOLSETS[preset]) {
        expect(name, `${preset}/${name}`).toMatch(/^[a-z][a-z0-9_]*(-[a-z0-9]+)*$/)
      }
    }
  })

  it('keeps the preset tool surfaces pairwise distinct', () => {
    const seen = new Map<string, string>()

    for (const preset of CAPABILITY_PRESETS) {
      const surface = [...PRESET_TOOLSETS[preset]].sort().join(',')

      expect(seen.has(surface), `${preset} duplicates ${seen.get(surface)}`).toBe(false)
      seen.set(surface, preset)
    }
  })

  it('hands back a copy, never the table itself', () => {
    const toolsets = presetToolsets('dev')

    expect(toolsets).toEqual(['coding'])
    toolsets!.push('terminal')
    expect(PRESET_TOOLSETS.dev).toEqual(['coding'])
    expect(presetToolsets('helpful')).toBeNull()
    expect(presetToolsets(null)).toBeNull()
  })
})
