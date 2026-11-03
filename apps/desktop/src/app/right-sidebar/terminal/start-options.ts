/**
 * Builds the `fulilian:terminal:start` payload. Extracted as a pure function so
 * the payload shape is unit-testable without mounting xterm.
 */
export interface TerminalStartInput {
  cols: number
  rows: number
  cwd: string
  /** Last observed shell cwd from a prior session; wins over `cwd` when set. */
  restoreCwd?: string
}

export interface TerminalStartOptions {
  cols: number
  cwd: string
  rows: number
}

export function terminalStartOptions({ cols, rows, cwd, restoreCwd }: TerminalStartInput): TerminalStartOptions {
  return {
    cols,
    // Prefer the prior session's last cwd so a reopened tab lands where the user
    // last `cd`'d; the main side falls back to the launch cwd (then home) if that
    // dir no longer exists.
    cwd: restoreCwd || cwd,
    rows
  }
}
