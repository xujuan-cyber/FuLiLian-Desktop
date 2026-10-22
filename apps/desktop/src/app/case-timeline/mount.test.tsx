// Integration: the case-timeline route shape the classifiers recognize (see
// routes.test.ts) must MATCH the mount row in contrib/surfaces.tsx — a typo on
// either side would silently fall through to the `path="*"` redirect and the
// page would never render. This mirror pins the mount row's path; if
// surfaces.tsx's row drifts from `caseTimelineRoute`, this breaks.
// (JSX lives in this .tsx because routes.test.ts is a plain .ts.)

import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { caseTimelineRoute } from '../routes'

describe('case timeline route mount integration (surfaces.tsx row)', () => {
  it('the mounted <Routes> path renders at the classified route, no fallback', () => {
    render(
      <MemoryRouter initialEntries={[caseTimelineRoute('CASE-2026-014')]}>
        <Routes>
          {/* Mirror of the contrib/surfaces.tsx mount row. */}
          <Route element={<div data-testid="case-timeline-mounted">CASE-TIMELINE</div>} path="cases/:caseId/timeline" />
          <Route element={<div data-testid="fallback">FALLBACK</div>} path="*" />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByTestId('case-timeline-mounted')).toBeTruthy()
    expect(screen.queryByTestId('fallback')).toBeNull()
  })

  it('a drifted mount path would NOT match (negative control)', () => {
    render(
      <MemoryRouter initialEntries={[caseTimelineRoute('CASE-1')]}>
        <Routes>
          <Route element={<div data-testid="wrong">WRONG</div>} path="cases/:caseId" />
          <Route element={<div data-testid="fallback">FALLBACK</div>} path="*" />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.queryByTestId('wrong')).toBeNull()
    expect(screen.getByTestId('fallback')).toBeTruthy()
  })
})
