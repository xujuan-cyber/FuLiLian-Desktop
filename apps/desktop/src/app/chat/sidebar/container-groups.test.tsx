import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidebarKindGroups } from './container-groups'
import { kindGroupsVisible } from './container-kind'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        kind: {
          all: 'All',
          forensics: 'Forensics',
          ctf: 'CTF',
          project: 'Projects',
          forensicsEmpty: 'No forensics cases yet',
          ctfEmpty: 'No CTF challenges yet'
        }
      }
    }
  })
}))

afterEach(cleanup)

describe('kindGroupsVisible', () => {
  it('shows every container under the All filter', () => {
    expect(kindGroupsVisible('all')).toEqual({ ctf: true, forensics: true, project: true })
  })

  it('narrows to a single container under a concrete kind', () => {
    expect(kindGroupsVisible('forensics')).toEqual({ ctf: false, forensics: true, project: false })
    expect(kindGroupsVisible('ctf')).toEqual({ ctf: true, forensics: false, project: false })
    expect(kindGroupsVisible('project')).toEqual({ ctf: false, forensics: false, project: true })
  })
})

describe('SidebarKindGroups honest empty states', () => {
  it('renders both kind groups with their empty-state copy under All', () => {
    render(<SidebarKindGroups filter="all" />)

    expect(screen.getByText('Forensics')).toBeTruthy()
    expect(screen.getByTestId('sidebar-kind-empty-forensics').textContent).toBe('No forensics cases yet')
    expect(screen.getByText('CTF')).toBeTruthy()
    expect(screen.getByTestId('sidebar-kind-empty-ctf').textContent).toBe('No CTF challenges yet')
  })

  it('fabricates NOTHING: a kind group body is text only — no rows, no buttons, no case numbers', () => {
    const { container } = render(<SidebarKindGroups filter="all" />)

    expect(container.querySelectorAll('button, a, [role="listitem"], [role="menuitem"], [data-testid^="sidebar-kind-row"]')).toHaveLength(0)
    // No synthetic identifiers either — the empty state is the whole body.
    expect(container.textContent).not.toContain('CASE-')
    expect(container.textContent).toContain('No forensics cases yet')
    expect(container.textContent).toContain('No CTF challenges yet')
  })

  it('hides the CTF group when the filter narrows to forensics', () => {
    render(<SidebarKindGroups filter="forensics" />)

    expect(screen.getByTestId('sidebar-kind-empty-forensics')).toBeTruthy()
    expect(screen.queryByTestId('sidebar-kind-empty-ctf')).toBeNull()
  })

  it('renders nothing at all when narrowed to projects', () => {
    const { container } = render(<SidebarKindGroups filter="project" />)

    expect(container.textContent).toBe('')
  })
})
