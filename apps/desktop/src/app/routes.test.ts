import { describe, expect, it } from 'vitest'

import {
  APP_ROUTES,
  appViewForPath,
  CASES_ROUTE,
  caseTimelineCaseId,
  caseTimelineRoute,
  isOverlayView,
  NEW_CHAT_ROUTE,
  primaryRouteSelectedSessionId,
  routeSessionId,
  sessionRoute,
  SETTINGS_ROUTE
} from './routes'

const SESS_A = 'sess-a'
const SESS_B = 'sess-b'

describe('primaryRouteSelectedSessionId', () => {
  it('prefers the routed session id over a stale/different store selection (#59305)', () => {
    // The route already committed to B while the store selection hasn't
    // caught up yet (still reads A) — the route wins.
    expect(primaryRouteSelectedSessionId(sessionRoute(SESS_B), SESS_A)).toBe(SESS_B)
  })

  it('returns null on the new-chat route even with a leftover selection from the previous chat', () => {
    expect(primaryRouteSelectedSessionId(NEW_CHAT_ROUTE, SESS_A)).toBeNull()
  })

  it('falls back to the store selection on a non-chat route (settings, overlays)', () => {
    expect(primaryRouteSelectedSessionId(SETTINGS_ROUTE, SESS_A)).toBe(SESS_A)
  })

  it('falls back to the store selection when the route matches the same session', () => {
    expect(primaryRouteSelectedSessionId(sessionRoute(SESS_A), SESS_A)).toBe(SESS_A)
  })

  it('returns null on a non-chat route with no store selection', () => {
    expect(primaryRouteSelectedSessionId(SETTINGS_ROUTE, null)).toBeNull()
  })
})

describe('case timeline route (step 16 · T13)', () => {
  it('round-trips: caseTimelineRoute builds, caseTimelineCaseId extracts', () => {
    expect(caseTimelineRoute('CASE-2026-014')).toBe('/cases/CASE-2026-014/timeline')
    expect(caseTimelineCaseId(caseTimelineRoute('CASE-2026-014'))).toBe('CASE-2026-014')
  })

  it('percent-encodes exotic case ids and decodes on parse', () => {
    const route = caseTimelineRoute('case/x y')

    expect(route).toBe('/cases/case%2Fx%20y/timeline')
    expect(caseTimelineCaseId(route)).toBe('case/x y')
    // The encoded id must never classify as a session route.
    expect(routeSessionId(route)).toBeNull()
  })

  it('classifies as the case-timeline workspace page (not chat, not overlay-able)', () => {
    expect(appViewForPath(caseTimelineRoute('CASE-1'))).toBe('case-timeline')
    expect(appViewForPath(`${caseTimelineRoute('CASE-1')}?q=1`)).toBe('case-timeline')
  })

  it('near-miss shapes never classify: /cases/x, wrong suffix, extra segments', () => {
    expect(caseTimelineCaseId('/cases/CASE-1')).toBeNull()
    expect(caseTimelineCaseId('/cases/CASE-1/other')).toBeNull()
    expect(caseTimelineCaseId('/cases/CASE-1/other/timeline')).toBeNull()
    expect(caseTimelineCaseId('/timeline/CASE-1')).toBeNull()
    expect(caseTimelineCaseId('/cases//timeline')).toBeNull()
    // The exact `/cases` path is the T14 overview's reserved APP_ROUTES path
    // (see cases overview describe below) — not a timeline and not a session.
    expect(caseTimelineCaseId('/cases')).toBeNull()
    expect(routeSessionId('/cases')).toBeNull()
  })

  it('query/hash suffixes are stripped before classification', () => {
    expect(caseTimelineCaseId(`${caseTimelineRoute('CASE-2')}#anchor`)).toBe('CASE-2')
  })
})

describe('cases overview route (step 16 · T14)', () => {
  it('registers /cases as a reserved workspace page (not a session id)', () => {
    expect(CASES_ROUTE).toBe('/cases')
    expect(appViewForPath('/cases')).toBe('cases')
    // A session literally named `cases` can never parse: the path is reserved.
    expect(routeSessionId('/cases')).toBeNull()
    // Not an overlay — it renders inside the workspace pane.
    expect(isOverlayView(appViewForPath('/cases'))).toBe(false)
  })

  it('query/hash suffixes still land on the overview', () => {
    expect(appViewForPath('/cases?q=1')).toBe('cases')
    expect(appViewForPath('/cases#top')).toBe('cases')
  })

  it('the timeline route is untouched: three segments stay the T13 page', () => {
    expect(appViewForPath(caseTimelineRoute('CASE-1'))).toBe('case-timeline')
  })

  it('APP_ROUTES carries the overview so deep-link restore resolves it', () => {
    expect(APP_ROUTES.find(route => route.id === 'cases')).toEqual({ id: 'cases', path: '/cases', view: 'cases' })
  })
})
