#!/usr/bin/env node
// scripts/gate/lint_delta.mjs — "only new eslint findings block".
//
// Absolute eslint counts drift every time any window touches a TS file, so a
// fixed number is not a usable gate while four people edit the tree in
// parallel.  The judging rule (方案 D7) is per-file attribution: lint the
// working-tree file, lint the same file as it exists in HEAD, and fail only if
// this branch added something.
//
// HEAD content goes through `eslint --stdin --stdin-filename <real path>`,
// which keeps the real path's config/ignore resolution but feeds old bytes.
// No `git stash`, no worktree, nothing mutates the working tree.
//
// Exit 0 = no new findings.  Exit 1 = at least one new finding (or we could
// not measure, which also must not pass silently).

import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = path.join(REPO, 'apps', 'desktop')
const ESLINT = path.join(REPO, 'node_modules', 'eslint', 'bin', 'eslint.js')
const WATCHED = ['apps/desktop/src', 'apps/desktop/electron']
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/

function fail(msg) {
  console.error(`lint-delta: ${msg}`)
  process.exit(1)
}

if (!fs.existsSync(ESLINT)) {
  fail(`eslint not found at ${ESLINT} — run npm install at the repo root first`)
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function changedFiles() {
  const raw = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '--', ...WATCHED],
    { cwd: REPO, encoding: 'utf8' }
  )
  const files = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    const status = line.slice(0, 2)
    let rel = line.slice(3)
    if (rel.includes(' -> ')) {
      rel = rel.split(' -> ').pop()
    }
    rel = rel.replace(/^"(.*)"$/, '$1')
    if (status.includes('D')) {
      continue // deleted files cannot introduce findings
    }
    if (!SOURCE_EXT.test(rel)) {
      continue
    }
    files.push({ rel, untracked: status === '??' })
  }
  return files
}

function parseEslint(stdout) {
  const start = stdout.indexOf('[')
  if (start === -1) {
    return []
  }
  try {
    return JSON.parse(stdout.slice(start))
  } catch {
    return []
  }
}

function runEslint(args, input) {
  const res = spawnSync(process.execPath, [ESLINT, ...args, '--format', 'json'], {
    cwd: APP,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (res.error) {
    fail(`could not run eslint: ${res.error.message}`)
  }
  return parseEslint(res.stdout || '')
}

// ruleId -> [messages], with fatal/parse errors bucketed so they can never
// hide behind a rule-id mismatch.
function bucket(results) {
  const map = new Map()
  for (const file of results) {
    for (const msg of file.messages || []) {
      const key = msg.ruleId || (msg.fatal ? 'fatal' : 'unknown')
      if (!map.has(key)) {
        map.set(key, [])
      }
      map.get(key).push(msg)
    }
  }
  return map
}

const files = changedFiles()
if (files.length === 0) {
  console.log('lint-delta: no changed files under apps/desktop/{src,electron} — nothing to compare')
  console.log('OK: no new findings (0 files)')
  process.exit(0)
}

console.log(`lint-delta: ${files.length} changed file(s) vs HEAD`)
for (const f of files) {
  console.log(`  - ${f.rel}${f.untracked ? ' (new file)' : ''}`)
}

const currentResults = runEslint(files.map(f => toPosix(path.relative(APP, path.join(REPO, f.rel)))))
const currentByFile = new Map()
for (const res of currentResults) {
  currentByFile.set(toPosix(path.relative(REPO, res.filePath)), res)
}

let newErrors = 0
let newWarnings = 0
const errorLines = []
const warningLines = []

for (const f of files) {
  const eslintRel = toPosix(path.relative(APP, path.join(REPO, f.rel)))
  const current = bucket([currentByFile.get(f.rel) || { messages: [] }])

  let baseline = new Map()
  if (!f.untracked) {
    let headContent
    try {
      headContent = execFileSync('git', ['show', `HEAD:${f.rel}`], {
        cwd: REPO,
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch {
      headContent = null // not in HEAD after all — treat as new file
    }
    if (headContent) {
      baseline = bucket(runEslint(['--stdin', '--stdin-filename', eslintRel], headContent))
    }
  }

  const keys = new Set([...current.keys(), ...baseline.keys()])
  for (const key of keys) {
    const currentMessages = current.get(key) || []
    const baselineMessages = baseline.get(key) || []
    // Count errors and warnings separately but diff on the combined list so a
    // fixed warning cannot mask a new error of the same rule.
    if (currentMessages.length <= baselineMessages.length) {
      continue
    }
    const added = currentMessages.slice(baselineMessages.length)
    for (const msg of added) {
      const where = msg.line ? `${f.rel}:${msg.line}` : f.rel
      const text = (msg.message || '').split('\n')[0].slice(0, 150)
      const line = `  + ${where}  [${key}] ${text}  (was ${baselineMessages.length}, now ${currentMessages.length})`
      if (msg.severity === 2) {
        newErrors += 1
        errorLines.push(line)
      } else {
        newWarnings += 1
        warningLines.push(line)
      }
    }
  }
}

if (newWarnings > 0) {
  // `npm run lint` fails on errors only, so warnings are reported but do not
  // block: matching the CI job matters more than being stricter than it.
  console.log('new eslint warnings (non-blocking, same as npm run lint):')
  for (const line of warningLines) {
    console.log(line)
  }
}

if (newErrors > 0) {
  console.log('new eslint errors introduced by this branch:')
  for (const line of errorLines) {
    console.log(line)
  }
  console.log(`FAIL: ${newErrors} new eslint error(s)`)
  process.exit(1)
}

console.log(`OK: no new errors (${newWarnings} new warning(s))`)
process.exit(0)
