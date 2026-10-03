// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ContainerSideCards } from './container-cards'

afterEach(cleanup)

describe('ContainerSideCards (right-rail static structure, honest empty states)', () => {
  it('renders nothing for a project session — the project rail is the existing panes', () => {
    const { container } = render(<ContainerSideCards kind="project" />)

    expect(container.textContent).toBe('')
  })

  it('forensics: evidence + audit cards show their empty states and fabricate no evidence rows', () => {
    render(<ContainerSideCards kind="forensics" />)

    expect(screen.getByTestId('container-card-evidence').textContent).toContain(
      'Import evidence to begin — SHA256 is computed on import.'
    )
    expect(screen.getByTestId('container-card-audit').textContent).toContain('No audit entries yet.')

    // Honesty: no fabricated filenames, hashes or verify dots.
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/CASE-\d/)
    expect(text).not.toMatch(/\.(dd|zip|raw|E01)\b/i)
    expect(text).not.toMatch(/[0-9a-f]{8,}/i)
  })

  it('CTF: flag vault / submissions / toolbox cards fabricate no flag or submission data', () => {
    render(<ContainerSideCards kind="ctf" />)

    expect(screen.getByTestId('container-card-flag-vault').textContent).toContain('No saved flags.')
    expect(screen.getByTestId('container-card-submissions').textContent).toContain('No submissions recorded.')
    expect(screen.getByTestId('container-card-toolbox').textContent).toContain(
      'Quick launchers arrive with the data layer.'
    )

    const text = document.body.textContent ?? ''
    // No masked-or-real flag content, no solved/failed counts.
    expect(text).not.toMatch(/flag\{/)
    expect(text).not.toMatch(/[•✓✗]/)
  })
})
