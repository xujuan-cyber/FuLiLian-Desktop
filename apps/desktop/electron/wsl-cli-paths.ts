// Windows → WSL/POSIX path translation for the terminal WSL target (step09 v2).
//
// The embedded terminal already bridges the POSIX → Windows direction (see
// wsl-path-bridge.ts: wslPosixToWindowsAccessible / resolvePickerDefaultPath),
// and the reverse direction is normally handled gateway-side by
// fulilian_constants.translate_cwd_for_wsl_backend. Neither is usable here: the
// PTY host runs in the desktop process and has to hand `wsl.exe --cd` a POSIX
// path *before* any gateway is involved.
//
// Kept in its own module (rather than bolted onto the frozen wsl-path-bridge.ts
// export list, or into the CLI probe module) so the terminal target depends on
// nothing but this one pure function.
const WIN_DRIVE_ABS_RE = /^([A-Za-z]):[\\/](.*)$/

/**
 * Translate a Windows absolute path to the POSIX path WSL sees for it.
 *
 * Rules:
 * - `X:\foo\bar` / `X:/foo/bar` → `/mnt/x/foo/bar` (drive letter lower-cased;
 *   both separators accepted, so MSYS/Git-style input works too).
 * - `X:\foo` → `/mnt/x/foo`; `X:\` → `/mnt/x`.
 * - an already-POSIX absolute path (`/home/me`) passes through unchanged.
 * - a relative path, a bare drive (`C:`), a UNC path, or an empty string passes
 *   through unchanged — there is no correct mount point to invent, and the
 *   caller treats an unchanged/invalid value by simply omitting `--cd`.
 *
 * Deliberately does NOT trim: "原样返回" for the non-Windows cases means the
 * caller (terminal-ipc) owns any normalization of the incoming cwd.
 */
export function windowsToWslPosix(winPath: string): string {
  const value = String(winPath ?? '')

  if (!value || value.startsWith('/')) {
    return value
  }

  const match = value.match(WIN_DRIVE_ABS_RE)

  if (!match) {
    return value
  }

  const drive = match[1].toLowerCase()
  const tail = match[2].replace(/\\/g, '/').replace(/\/+$/, '')

  return tail ? `/mnt/${drive}/${tail}` : `/mnt/${drive}`
}
