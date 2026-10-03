// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ContainerMeta } from './container-meta'

afterEach(cleanup)

describe('ContainerMeta (session header work-mode strip)', () => {
  it('renders the project mode marker for the reachable default kind', () => {
    render(<ContainerMeta />)

    const root = screen.getByText('Project').closest('[data-container-kind]')
    expect(root?.getAttribute('data-container-kind')).toBe('project')
  })

  it('renders the project structure when the kind is explicitly project', () => {
    render(<ContainerMeta kind="project" />)

    expect(screen.getByText('Project')).toBeTruthy()
    // No forensics/CTF stat fields on a project session.
    expect(screen.queryByText('Case')).toBeNull()
    expect(screen.queryByText('Category·Points')).toBeNull()
  })

  it('forensics strip: stat fields carry honest empty placeholders, never a fabricated case number', () => {
    render(<ContainerMeta kind="forensics" />)

    for (const label of ['Case', 'Evidence', 'Audit', 'Report']) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    // Every data field is the em-dash placeholder, never an invented value.
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBe(4)
    expect(screen.queryByText(/CASE-\d/)).toBeNull()
    expect(screen.queryByText(/\d{3,}/)).toBeNull()
  })

  it('CTF strip: honest placeholders, never a fabricated score or countdown', () => {
    render(<ContainerMeta kind="ctf" />)

    for (const label of ['Event', 'Category·Points', 'Countdown']) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    expect(screen.getAllByText('—').length).toBe(2)
    expect(screen.getByText('No deadline')).toBeTruthy()
    expect(screen.queryByText(/\d{2,}/)).toBeNull()
  })
})
