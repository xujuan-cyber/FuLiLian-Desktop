// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ContainerPills } from './container-pills'

afterEach(cleanup)

describe('ContainerPills (composer work-mode strip, static placeholders)', () => {
  it('renders nothing for a project session — the strip is unchanged', () => {
    const { container } = render(<ContainerPills kind="project" />)

    expect(container.textContent).toBe('')
  })

  it('forensics: case/evidence pills carry the em-dash placeholder, never a fabricated case number', () => {
    render(<ContainerPills kind="forensics" />)

    expect(screen.getByTestId('container-pill-Case').textContent).toBe('Case—')
    expect(screen.getByTestId('container-pill-Evidence').textContent).toBe('Evidence—')
    expect(document.body.textContent).not.toMatch(/CASE-\d/)
  })

  it('CTF: category·points and countdown pills fabricate no score and show the honest no-deadline state', () => {
    render(<ContainerPills kind="ctf" />)

    expect(screen.getByTestId('container-pill-Category·Points').textContent).toBe('Category·Points—')
    expect(screen.getByTestId('container-pill-Countdown').textContent).toBe('CountdownNo deadline')
    expect(document.body.textContent).not.toMatch(/\d{2,}/)
  })
})
