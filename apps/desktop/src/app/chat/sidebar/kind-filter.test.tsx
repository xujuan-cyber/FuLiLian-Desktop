import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidebarKindFilterRow } from './filter-menu'

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

describe('SidebarKindFilterRow', () => {
  it('renders the four kind chips as a radio group', () => {
    render(<SidebarKindFilterRow onChange={() => undefined} value="all" />)

    const radios = screen.getAllByRole('radio')

    expect(radios).toHaveLength(4)
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Forensics' }).getAttribute('aria-checked')).toBe('false')
  })

  it('forwards the picked kind to onChange', () => {
    const onChange = vi.fn()

    render(<SidebarKindFilterRow onChange={onChange} value="all" />)

    fireEvent.click(screen.getByRole('radio', { name: 'CTF' }))

    expect(onChange).toHaveBeenCalledWith('ctf')
  })
})
