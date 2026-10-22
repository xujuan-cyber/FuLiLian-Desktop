import { describe, expect, it } from 'vitest'

import { redactLogLine, redactLogLines, redactLogText } from './log-redaction'

// P1-3: the recovery screen used to print desktop.log verbatim, exposing the
// user's home directory, the install root and safe-delete guard JSON. These
// rules run in the main process before any log reaches the renderer.

const STAMP = '[2026-10-22T06:12:33.123Z] [fulilian]'

function redact(body: string) {
  return redactLogLine(`${STAMP} ${body}`)
}

describe('redactLogLine — absolute paths (rule 1)', () => {
  it('folds a Windows drive path to its last two segments', () => {
    const out = redact('reading C:\\Users\\Administrator\\AppData\\Roaming\\fulilian\\desktop.log now')

    expect(out).toContain('…\\fulilian\\desktop.log')
    expect(out).not.toMatch(/[A-Za-z]:\\/)
    expect(out).not.toContain('Administrator')
    // Surrounding prose survives.
    expect(out).toContain('reading')
    expect(out).toContain('now')
  })

  it('drops the account name when a path ends on the home directory', () => {
    expect(redact('cwd C:\\Users\\Administrator')).toContain('…\\Users\\*')
    expect(redact('cwd C:\\Users\\Administrator')).not.toContain('Administrator')
  })

  it('folds UNC paths and drops the host', () => {
    const out = redact('imported \\\\wsl.localhost\\Ubuntu\\home\\me\\project\\agent\\__pycache__ ok')

    expect(out).toContain('…\\agent\\__pycache__')
    expect(out).not.toContain('wsl.localhost')
    expect(out).not.toContain('Ubuntu')
  })

  it('folds POSIX paths under absolute roots', () => {
    const out = redact('trace /mnt/c/Users/Administrator/fulilian/agent/main.py failed')

    expect(out).toContain('…/agent/main.py')
    expect(out).not.toMatch(/\/mnt\/c\//)
    expect(redact('cfg /home/me/.config/fulilian')).not.toContain('/home/me')
  })

  it('leaves relative module paths and URLs readable', () => {
    const out = redact('module src/components/ui/button.tsx served from http://127.0.0.1:5174/app.js')

    expect(out).toContain('src/components/ui/button.tsx')
    expect(out).toContain('http://127.0.0.1:5174/app.js')
  })
})

describe('redactLogLine — credentials (rule 2)', () => {
  it('masks sk-, Bearer, xox and long hex blobs', () => {
    const out = redact(
      'auth sk-abcdef1234567890 Bearer eyJhbGciOiJIUzI1NiJ9.payload xoxb-123456789012-abcdef ' +
        'hmac 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    )

    expect(out).not.toContain('sk-')
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(out).not.toContain('xoxb-')
    expect(out).not.toContain('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
    expect(out).toContain('[redacted]')
    // The label around the secret is still there for diagnosis.
    expect(out).toContain('auth')
    expect(out).toContain('hmac')
  })
})

describe('redactLogLine — guard protocol (rule 3)', () => {
  it('collapses a safe-delete JSON line but keeps the timestamp prefix', () => {
    const line = `${STAMP} [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]{"count":104,"root":"C:\\\\Users\\\\Administrator\\\\tmp"}`
    const out = redactLogLine(line)

    expect(out).toBe(`${STAMP} [redacted]`)
    expect(out).not.toContain('safe-delete')
    expect(out).not.toContain('count')
    expect(out).not.toContain('Administrator')
  })

  it('also collapses guard lines carrying only the flag name', () => {
    const out = redact('[SAFE_DELETE_BULK_CONFIRM_REQUIRED] waiting for user')

    expect(out).toContain('[redacted]')
    expect(out).not.toContain('SAFE_DELETE')
    expect(out).toContain(STAMP)
  })
})

describe('redactLogLine — diagnosability (rule 4)', () => {
  it('preserves timestamps and log-line number prefixes', () => {
    const numbered = `1234: ${STAMP} boot failed at C:\\Users\\Administrator\\fulilian\\run.py`
    const out = redactLogLine(numbered)

    expect(out.startsWith(`1234: ${STAMP} `)).toBe(true)
    expect(out).toContain('boot failed at')
  })

  it('keeps the human-readable failure reason intact', () => {
    const out = redact('后端未就绪: gateway did not answer on 127.0.0.1:8123 within 30000ms')

    expect(out).toContain('后端未就绪')
    expect(out).toContain('127.0.0.1:8123')
    expect(out).toContain('30000ms')
  })

  it('passes empty and plain lines through untouched', () => {
    expect(redactLogLine('')).toBe('')
    expect(redactLogLine(`${STAMP} plain progress line`)).toBe(`${STAMP} plain progress line`)
  })

  it('is idempotent', () => {
    const once = redactLogLine(
      `${STAMP} [safe-delete]{"count":2} sk-abcdef1234567890 C:\\Users\\Administrator\\a\\b.log`
    )

    expect(redactLogLine(once)).toBe(once)
    expect(redactLogLines([once])[0]).toBe(once)
  })
})

describe('redactLogText', () => {
  it('scrubs a multi-line boot-failure body while keeping line structure', () => {
    const text = [
      'Fulilian backend exited before it became ready (1). Log: C:\\Users\\Administrator\\fulilian\\desktop.log',
      'Recent backend output:',
      '[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]{"count":104}',
      '  File "E:\\FuLilian-Desktop\\agent\\__pycache__\\x.py"'
    ].join('\n')

    const out = redactLogText(text)
    const lines = out.split('\n')

    expect(lines).toHaveLength(4)
    expect(out).not.toMatch(/[A-Za-z]:\\/)
    expect(out).not.toContain('safe-delete')
    expect(out).toContain('Fulilian backend exited before it became ready')
    expect(out).toContain('Recent backend output')
  })
})
