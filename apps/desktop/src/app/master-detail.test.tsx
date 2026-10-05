import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $paneStates } from '@/store/panes'

import { MasterDetail } from './master-detail'

const SPLIT_ID = 'p7-split'

// rAF is stubbed to a manual queue so a test can prove how many frames a drag
// schedules and fire them deterministically (jsdom has no real animation).
function stubFrames() {
  let nextId = 0
  const queued = new Map<number, FrameRequestCallback>()

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = (nextId += 1)
    queued.set(id, callback)

    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queued.delete(id)
  })

  return {
    flush: () => {
      const pending = [...queued.values()]
      queued.clear()
      pending.forEach(callback => callback(0))
    },
    pending: () => queued.size
  }
}

// jsdom reports zero-size boxes. Give the seam real geometry so the drag maps
// x to a clamped width: max = gridWidth(1000) - SPLIT_MIN_RIGHT_PX(320) = 680,
// starting rail 300px, so a 300px pointer travel lands at 600px.
function renderSplit() {
  const view = render(
    <MasterDetail resizeId={SPLIT_ID}>
      <div>list</div>
      <div>detail</div>
    </MasterDetail>
  )

  const sash = view.container.querySelector<HTMLElement>('.cursor-col-resize')!
  const grid = sash.parentElement!.parentElement as HTMLElement
  const list = grid.children[0] as HTMLElement

  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as unknown as DOMRect)
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ width: 300 } as unknown as DOMRect)

  return sash
}

// Every store write the drag commits (setPaneWidthOverride is a no-op on an
// unchanged value), so the width list IS the sequence of applied frames.
const subscriptions: Array<() => void> = []

function recordWidths() {
  const widths: number[] = []
  subscriptions.push(
    $paneStates.subscribe(states => {
      const width = states[SPLIT_ID]?.widthOverride

      if (width !== undefined) {
        widths.push(width)
      }
    })
  )

  return widths
}

describe('MasterDetail split-seam drag', () => {
  beforeEach(() => {
    $paneStates.set({})
  })

  afterEach(() => {
    cleanup()
    subscriptions.splice(0).forEach(unsubscribe => unsubscribe())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    $paneStates.set({})
  })

  it('coalesces a burst of pointermove into one apply per frame, keeping the last value', () => {
    const frames = stubFrames()
    const widths = recordWidths()
    const sash = renderSplit()

    fireEvent.pointerDown(sash, { button: 0, clientX: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 600, pointerId: 1 })

    // Three moves inside one frame: nothing applied yet, only one frame queued.
    expect(widths).toEqual([])
    expect(frames.pending()).toBe(1)

    act(() => frames.flush())

    // Exactly one apply — and it carries the last position, not the first.
    expect(widths).toEqual([600])
  })

  it('commits the pending width on pointerup so the final value is never dropped', () => {
    stubFrames()
    const widths = recordWidths()
    const sash = renderSplit()

    fireEvent.pointerDown(sash, { button: 0, clientX: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 450, pointerId: 1 })

    expect(widths).toEqual([])

    fireEvent.pointerUp(window, { clientX: 450, pointerId: 1 })

    expect(widths).toEqual([450])
  })

  it('stops applying widths once the drag has ended', () => {
    stubFrames()
    const widths = recordWidths()
    const sash = renderSplit()

    fireEvent.pointerDown(sash, { button: 0, clientX: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 450, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 450, pointerId: 1 })

    expect(widths).toEqual([450])

    fireEvent.pointerMove(window, { clientX: 700, pointerId: 1 })

    expect(widths).toEqual([450])
  })
})
