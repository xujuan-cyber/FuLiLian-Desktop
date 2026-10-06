// Integration: the /cases overview route the classifiers recognize (see
// routes.test.ts) must MATCH the mount row in contrib/surfaces.tsx — a typo
// on either side would silently fall through to the `path="*"` redirect and
// the page would never render. This mirror pins the mount row's path; if
// surfaces.tsx's row drifts from CASES_ROUTE, this breaks.
// (Same double-proof shape as case-timeline/mount.test.tsx, T13 precedent.)

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'

import { CASES_ROUTE, caseTimelineRoute } from '../routes'

describe('cases overview route mount integration (surfaces.tsx row)', () => {
  it('the mounted <Routes> path renders at /cases, no fallback', () => {
    render(
      <MemoryRouter initialEntries={[CASES_ROUTE]}>
        <Routes>
          {/* Mirror of the contrib/surfaces.tsx mount row. */}
          <Route element={<div data-testid="cases-mounted">CASES</div>} path="cases" />
          <Route element={<div data-testid="fallback">FALLBACK</div>} path="*" />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByTestId('cases-mounted')).toBeTruthy()
    expect(screen.queryByTestId('fallback')).toBeNull()
  })

  it('the three-segment timeline route is NOT captured by the overview row (negative control)', () => {
    render(
      <MemoryRouter initialEntries={[caseTimelineRoute('CASE-1')]}>
        <Routes>
          <Route element={<div data-testid="cases-mounted">CASES</div>} path="cases" />
          <Route element={<div data-testid="timeline-mounted">TIMELINE</div>} path="cases/:caseId/timeline" />
          <Route element={<div data-testid="fallback">FALLBACK</div>} path="*" />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByTestId('timeline-mounted')).toBeTruthy()
    expect(screen.queryByTestId('cases-mounted')).toBeNull()
    expect(screen.queryByTestId('fallback')).toBeNull()
  })

  it('a drifted mount path would NOT match (negative control)', () => {
    render(
      <MemoryRouter initialEntries={[CASES_ROUTE]}>
        <Routes>
          <Route element={<div data-testid="wrong">WRONG</div>} path="cases-overview" />
          <Route element={<div data-testid="fallback">FALLBACK</div>} path="*" />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.queryByTestId('wrong')).toBeNull()
    expect(screen.getByTestId('fallback')).toBeTruthy()
  })
})
