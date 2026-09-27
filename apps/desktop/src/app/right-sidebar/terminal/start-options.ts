import type { WslCliTarget } from '@/store/wsl-cli'

/**
 * Builds the `fulilian:terminal:start` payload. Extracted as a pure function so
 * the WSL pass-through (step09 contract §四 C) is unit-testable without mounting
 * xterm: the `wsl` key is emitted ONLY for WSL tabs, so local/SSH tabs keep
 * sending the exact pre-step09 payload and the main process's existing
 * local/SSH routing is untouched.
 */
export interface TerminalStartInput {
  cols: number
  rows: number
  cwd: string
  /** Last observed shell cwd from a prior session; wins over `cwd` when set. */
  restoreCwd?: string
  wsl?: null | WslCliTarget
}

export interface TerminalStartOptions {
  cols: number
  cwd: string
  rows: number
  wsl?: { distro: string; cli: WslCliTarget['cli'] }
}

export function terminalStartOptions({ cols, rows, cwd, restoreCwd, wsl }: TerminalStartInput): TerminalStartOptions {
  return {
    cols,
    // Prefer the prior session's last cwd so a reopened tab lands where the user
    // last `cd`'d; the main side falls back to the launch cwd (then home) if that
    // dir no longer exists. For a WSL tab the main process owns the POSIX
    // translation of this path (contract §四 C.4).
    cwd: restoreCwd || cwd,
    rows,
    ...(wsl ? { wsl: { distro: wsl.distro, cli: wsl.cli } } : {})
  }
}
