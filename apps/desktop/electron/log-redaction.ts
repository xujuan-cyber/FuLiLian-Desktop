/**
 * Log redaction for every log surface the main process hands to the renderer
 * (recovery screen "recent logs", boot-failure error text, connection
 * descriptors). The on-disk `desktop.log` stays verbatim — it never leaves the
 * machine and keeps full diagnostic value; only the renderer-facing copies are
 * scrubbed, because a boot failure renders them on screen for screenshots,
 * clipboard copies and bug reports (P1-3).
 *
 * Four rules (D2):
 *   1. absolute paths fold to `…<last two segments>` (Windows drive, UNC, POSIX);
 *   2. long hex / `sk-*` / `Bearer …` / `xox*-*` credentials are masked;
 *   3. guard-protocol lines (`[safe-delete]…`) collapse to `[redacted]`;
 *   4. timestamps and line-number prefixes survive — diagnosability must not
 *      be thrown away with the secrets.
 */

const REDACTED = '[redacted]'

// 3 ── guard protocol -----------------------------------------------------------------
// safe-delete emits a JSON envelope naming the exact files it intends to delete.
// Nothing after the marker (or the flag name, when the marker is missing) is
// diagnostic, so the tail is dropped wholesale while the prefix is kept.
const GUARD_MARKERS = [/\[safe-delete\]/i, /\bSAFE_DELETE_[A-Z_]+\b/]

function redactGuardLine(line: string): string | null {
  for (const marker of GUARD_MARKERS) {
    const match = marker.exec(line)

    if (!match) {
      continue
    }

    if (match.index === 0) {
      return REDACTED
    }

    return `${line.slice(0, match.index).replace(/\s+$/, ' ')}${REDACTED}`
  }

  return null
}

// 2 ── credentials --------------------------------------------------------------------
// Order matters: mask secrets before path folding so a token containing `/` or
// `\` cannot confuse the path scanner.
const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{8,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // Opaque hex blobs: HMACs, session ids, sha256 digests used as keys.
  [/\b[0-9a-fA-F]{32,}\b/g, REDACTED]
]

// 1 ── absolute paths -----------------------------------------------------------------
// Segments are whitespace-free; a path with spaces (`C:\Program Files\…`) still
// loses its drive prefix, only the tail is less pretty. Trailing prose
// punctuation is peeled off before folding and re-attached after.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/
const USER_CONTAINERS = new Set(['Users', 'home', 'Documents and Settings'])

function foldSegments(segments: string[], separator: string): string {
  const parts = segments.filter(Boolean)

  if (parts.length === 0) {
    return '…'
  }

  const tail = parts.slice(-2)

  // A path ending on a home directory would otherwise print the account name:
  // `C:\Users\Administrator` -> `…\Users\*`.
  if (tail.length === 2 && USER_CONTAINERS.has(tail[0])) {
    return `…${separator}${tail[0]}${separator}*`
  }

  return `…${separator}${tail.join(separator)}`
}

function splitTrailing(text: string): { body: string; suffix: string } {
  const match = TRAILING_PUNCTUATION.exec(text)

  return match ? { body: text.slice(0, match.index), suffix: match[0] } : { body: text, suffix: '' }
}

// Windows drive paths: `C:\Users\…`, `e:\fu\agent\__pycache__`.
const WINDOWS_DRIVE_PATH = /(^|[\s"'`=([{,:;])([A-Za-z]:\\[^\s"'`<>|?*]+)/g
// UNC paths: `\\wsl.localhost\Ubuntu\home\me\x`, `\\server\share\dir\file`.
const UNC_PATH = /(^|[\s"'`=([{,:;])(\\\\[^\s"'`<>|?*]+)/g

// POSIX paths under the usual absolute roots only — relative module paths
// (`src/components/foo.tsx`) and URLs stay readable.
const POSIX_PATH =
  /(^|[\s"'`=([{,:;])(\/(?:mnt\/[a-zA-Z]|cygdrive\/[a-zA-Z]|home|Users|root|tmp|var|opt|usr|etc|srv|private|Volumes|nix\/store|run)\/[^\s"'`<>|?*]+)/g

function foldAbsolutePaths(line: string): string {
  const fold = (separator: string) => (match: string, lead: string, path: string) => {
    const { body, suffix } = splitTrailing(path)

    return `${lead}${foldSegments(body.split(separator), separator)}${suffix}`
  }

  return line
    .replace(UNC_PATH, fold('\\'))
    .replace(WINDOWS_DRIVE_PATH, fold('\\'))
    .replace(POSIX_PATH, fold('/'))
}

/**
 * Redact one log line. Idempotent: re-running over already-redacted text is a
 * no-op, which matters because the renderer applies the same rules as a
 * fallback over lines the main process already scrubbed.
 */
export function redactLogLine(line: string): string {
  if (!line) {
    return line
  }

  const guard = redactGuardLine(line)

  if (guard !== null) {
    return guard
  }

  let out = line

  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, replacement)
  }

  return foldAbsolutePaths(out)
}

export function redactLogLines(lines: readonly string[]): string[] {
  return lines.map(line => redactLogLine(line))
}

/** Multi-line convenience for composed messages (boot-failure error bodies). */
export function redactLogText(text: string): string {
  if (!text) {
    return text
  }

  return redactLogLines(text.split(/\r?\n/)).join('\n')
}
