// Pre-flight state.db integrity guard for the desktop updater (step 16 · T12
// third cut, #68474).
//
// Before any update mutates the install, the desktop Electron process takes an
// emergency timestamped snapshot of state.db and verifies the live copy's
// SQLite header — a separate safety net from the Python-level pre-update
// snapshot inside `fulilian update`. The two call sites (Windows updater spawn
// and the macOS/Linux posix hand-off) stay in main.ts; this module only owns
// the guard.
//
// Extracted verbatim from main.ts: the log strings, the backup filename format,
// the `size > 100` threshold, the `SQLite format 3\0` magic and the prune-to-2
// rule are equivalent to the pre-extraction implementation.
//
// The module carries its own private `fileExists` (a 3-line statSync try/catch)
// rather than importing main.ts's shared helper: that helper is referenced 33
// times across main.ts and must not move, so a local copy keeps the guard
// self-contained and side-effect free — importable by a plain node test with no
// Electron runtime.

import fs from 'node:fs'
import path from 'node:path'

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

// ── Pre-flight state.db integrity guard (#68474) ─────────────────────
// Take an emergency snapshot of state.db and verify the live copy is
// intact before any update process mutates the install.  Runs in the
// desktop Electron process itself, before the backend is killed and
// before the updater is spawned — a separate safety net from the
// Python-level pre-update snapshot inside `fulilian update`.
export function preflightStateDb(fulilianHome, rememberLog) {
  const stateDbPath = path.join(fulilianHome, 'state.db')

  if (!fileExists(stateDbPath)) {
    rememberLog('[updates] state.db pre-flight: not found (fresh install?)')

    return
  }

  try {
    const stat = fs.statSync(stateDbPath)

    if (stat.size > 100) {
      const fd = fs.openSync(stateDbPath, 'r')
      const header = Buffer.alloc(16)

      fs.readSync(fd, header, 0, 16, 0)
      fs.closeSync(fd)

      const expectedHeader = Buffer.from('SQLite format 3\0')
      const headerOk = header.equals(expectedHeader)

      rememberLog(
        `[updates] state.db pre-flight: size=${stat.size}, ` +
          `headerOk=${headerOk}, headerHex=${header.toString('hex')}`
      )

      if (!headerOk) {
        rememberLog(
          '[updates] state.db header is INVALID before update — ' +
            'this indicates pre-existing corruption or a concurrent write issue'
        )
      }

      // Emergency timestamped backup, separate from the Python-level snapshot.
      const ts = new Date().toISOString().replace(/[:.]/g, '-')

      const emergencyPath = path.join(fulilianHome, `state.db.pre-update-emergency-${ts}.bak`)

      try {
        fs.copyFileSync(stateDbPath, emergencyPath)
        const emergStat = fs.statSync(emergencyPath)

        rememberLog(`[updates] emergency state.db backup: ${emergencyPath} ` + `(${emergStat.size} bytes)`)

        // Prune to the 2 most recent emergency backups.
        try {
          const homeDir = fs.readdirSync(fulilianHome)

          const backups = homeDir
            .filter(
              f =>
                f.startsWith('state.db.pre-update-emergency-') &&
                f.endsWith('.bak') &&
                f !== path.basename(emergencyPath)
            )
            .sort()
            .reverse()

          for (const old of backups.slice(2)) {
            try {
              fs.unlinkSync(path.join(fulilianHome, old))
            } catch {
              void 0
            }
          }
        } catch {
          void 0
        }
      } catch (copyErr) {
        rememberLog(`[updates] emergency state.db backup failed: ${copyErr.message}`)
      }
    } else {
      rememberLog(`[updates] state.db too small (${stat.size} bytes) for a valid SQLite database`)
    }
  } catch (statErr) {
    rememberLog(`[updates] could not stat state.db before update: ${statErr.message}`)
  }
}
