/**
 * Unit tests for the extracted state.db pre-flight guard (T12 third cut, #68474).
 *
 * The guard is the pre-update safety net main.ts calls before mutating the
 * install: it verifies state.db exists, checks the 16-byte SQLite magic header
 * when the file is large enough, and takes a timestamped emergency backup that
 * it prunes back to the two most recent copies.
 *
 * Everything here runs against a real temp directory and a captured log sink —
 * the module pulls in no Electron runtime, so the guard's behaviour (log
 * strings, the `size > 100` gate, the header comparison and the prune rule) is
 * asserted directly.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { preflightStateDb } from './state-db-preflight'

const SQLITE_MAGIC = 'SQLite format 3\0'
const BACKUP_PREFIX = 'state.db.pre-update-emergency-'

function withTempDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fulilian-state-db-preflight-'))

  try {
    return run(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function collectLogs() {
  const lines = []

  return { lines, rememberLog: message => lines.push(message) }
}

function listBackups(directory) {
  return fs
    .readdirSync(directory)
    .filter(name => name.startsWith(BACKUP_PREFIX) && name.endsWith('.bak'))
    .sort()
}

/** A well-formed SQLite file: the 16-byte magic + filler past the 100-byte gate. */
function writeValidStateDb(directory, size = 4096) {
  const filePath = path.join(directory, 'state.db')
  const bytes = Buffer.alloc(size)
  Buffer.from(SQLITE_MAGIC).copy(bytes, 0)
  fs.writeFileSync(filePath, bytes)

  return { filePath, bytes }
}

test('missing state.db returns early with a single log and no backup', () =>
  withTempDir(directory => {
    const { lines, rememberLog } = collectLogs()

    preflightStateDb(directory, rememberLog)

    assert.deepEqual(lines, ['[updates] state.db pre-flight: not found (fresh install?)'])
    assert.deepEqual(listBackups(directory), [])
  }))

test('a file at or below 100 bytes skips the header check', () =>
  withTempDir(directory => {
    const filePath = path.join(directory, 'state.db')
    fs.writeFileSync(filePath, Buffer.alloc(10))
    const { lines, rememberLog } = collectLogs()

    preflightStateDb(directory, rememberLog)

    assert.deepEqual(lines, ['[updates] state.db too small (10 bytes) for a valid SQLite database'])
    assert.equal(
      lines.some(line => line.includes('headerOk')),
      false
    )
    assert.deepEqual(listBackups(directory), [])
  }))

test('a valid SQLite header is reported as headerOk=true', () =>
  withTempDir(directory => {
    const { bytes } = writeValidStateDb(directory)
    const { lines, rememberLog } = collectLogs()

    preflightStateDb(directory, rememberLog)

    assert.equal(
      lines.some(line => line === `[updates] state.db pre-flight: size=${bytes.length}, headerOk=true, headerHex=${bytes.subarray(0, 16).toString('hex')}`),
      true
    )
    assert.equal(
      lines.some(line => line.includes('INVALID')),
      false
    )
  }))

test('an invalid header logs the INVALID corruption warning', () =>
  withTempDir(directory => {
    const filePath = path.join(directory, 'state.db')
    const bytes = Buffer.alloc(4096, 0x58)
    fs.writeFileSync(filePath, bytes)
    const { lines, rememberLog } = collectLogs()

    preflightStateDb(directory, rememberLog)

    assert.equal(
      lines.some(line => line === `[updates] state.db pre-flight: size=${bytes.length}, headerOk=false, headerHex=${bytes.subarray(0, 16).toString('hex')}`),
      true
    )
    assert.equal(
      lines.some(
        line =>
          line.includes('state.db header is INVALID before update') && line.includes('pre-existing corruption')
      ),
      true
    )
  }))

test('an emergency backup is created with a timestamped name and the live contents', () =>
  withTempDir(directory => {
    const { bytes } = writeValidStateDb(directory)
    const { lines, rememberLog } = collectLogs()

    preflightStateDb(directory, rememberLog)

    const backups = listBackups(directory)
    assert.equal(backups.length, 1)
    assert.match(backups[0], /^state\.db\.pre-update-emergency-.+\.bak$/)

    const backupPath = path.join(directory, backups[0])
    assert.deepEqual(fs.readFileSync(backupPath), bytes)
    assert.equal(
      lines.some(
        line =>
          line.startsWith('[updates] emergency state.db backup: ') &&
          line.includes(backupPath) &&
          line.includes(`(${bytes.length} bytes)`)
      ),
      true
    )
  }))

test('emergency backups are pruned to the two most recent copies', () =>
  withTempDir(directory => {
    writeValidStateDb(directory)

    const seeded = [
      `${BACKUP_PREFIX}2020-01-01T00-00-00-000Z.bak`,
      `${BACKUP_PREFIX}2021-01-01T00-00-00-000Z.bak`,
      `${BACKUP_PREFIX}2022-01-01T00-00-00-000Z.bak`,
      `${BACKUP_PREFIX}2023-01-01T00-00-00-000Z.bak`
    ]

    for (const name of seeded) {
      fs.writeFileSync(path.join(directory, name), Buffer.alloc(16))
    }

    // Decoys the prune filter must ignore.
    fs.writeFileSync(path.join(directory, 'keep-me.txt'), 'unrelated')
    fs.writeFileSync(path.join(directory, `${BACKUP_PREFIX}not-a-backup.txt`), 'wrong suffix')

    const { rememberLog } = collectLogs()

    preflightStateDb(directory, rememberLog)

    const survivors = listBackups(directory)
    // The freshly created copy plus the two newest seeded copies; the older two seed
    // files are unlinked.
    assert.equal(survivors.length, 3)
    assert.equal(
      survivors.includes(seeded[2]),
      true
    )
    assert.equal(
      survivors.includes(seeded[3]),
      true
    )
    assert.equal(
      survivors.includes(seeded[0]),
      false
    )
    assert.equal(
      survivors.includes(seeded[1]),
      false
    )
    // Decoys untouched.
    assert.equal(fs.existsSync(path.join(directory, 'keep-me.txt')), true)
    assert.equal(fs.existsSync(path.join(directory, `${BACKUP_PREFIX}not-a-backup.txt`)), true)
  }))
