import { type ComponentProps, useEffect, useRef, useState } from 'react'

import { prefersReducedMotion } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'

/**
 * DecodeText — the "CONNECTING" scramble-decode effect as a reusable
 * primitive (extracted from gateway-connecting-overlay.tsx; same mechanics):
 *
 *  - Even-weight mono ascii charset so cycling glyphs never jump width
 *    (matches the nousnet-web download-button decode effect).
 *  - Decode resolves half a character per 45ms tick; when fully resolved it
 *    holds for 16 ticks, then (in loop mode) replays.
 *  - The first `prefix` characters NEVER scramble — split at render level so
 *    no timer logic (even a stale HMR one) can garble them.
 *  - Optional blinking dither-cursor square.
 *
 * Typography (mono, small, uppercase, wide tracking) is baked in; color comes
 * from the caller via className/text color so the same primitive works on the
 * boot overlay (--theme-primary) and quiet surfaces (--ui-text-quaternary).
 */

export const DECODE_SCRAMBLE_CHARS = '/\\|-_=+<>~:*'
const TICK_MS = 45
const HOLD_TICKS = 16

function scrambled(tail: string, resolvedCount: number): string {
  return Array.from(tail, (ch, i) =>
    ch === ' ' || i < resolvedCount ? ch : DECODE_SCRAMBLE_CHARS[(Math.random() * DECODE_SCRAMBLE_CHARS.length) | 0]
  ).join('')
}

export interface DecodeTextProps extends Omit<ComponentProps<'span'>, 'prefix'> {
  text: string
  /** Leading character count that stays legible at all times. */
  prefix?: number
  /** Run the decode. When false, renders the plain resolved text (used to
   *  freeze the word during exit choreography). */
  active?: boolean
  /** Replay after the hold, or resolve once and stop. */
  loop?: boolean
  /** Blinking dither-cursor square after the text. */
  cursor?: boolean
}

export function DecodeText({
  active = true,
  className,
  cursor = false,
  loop = true,
  prefix = 0,
  text,
  ...props
}: DecodeTextProps) {
  const staticPrefix = text.slice(0, prefix)
  const tailText = text.slice(prefix)
  const [tail, setTail] = useState(tailText)
  // Offscreen/hidden gating: this primitive also decorates permanent
  // empty-state panes ("LOGS", the workspace idle ticker), which sit inside
  // collapsed `display:none` zones. In loop mode the 45 ms interval would
  // otherwise scramble + setState forever while nothing can see it — a
  // permanent 22 Hz render heartbeat per mounted instance. The observer flips
  // a ref (not state, so visibility changes never re-render); the tick reads
  // it and skips the churn while offscreen.
  const hostRef = useRef<HTMLSpanElement>(null)
  const offscreenRef = useRef(false)

  // The rule below targets atom→ref mirrors; this effect wires a DOM
  // IntersectionObserver into a gate flag that is never rendered from, so the
  // stale-read hazard it guards against cannot occur.
  // eslint-disable-next-line no-restricted-syntax -- DOM-visibility gate, not an atom mirror
  useEffect(() => {
    const el = hostRef.current

    if (!el || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(entries => {
      // Gate flag only — never rendered from, so a stale read is impossible;
      // it exists precisely because render-time state would churn on flips.
      offscreenRef.current = !entries.some(entry => entry.isIntersecting)
    })

    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!active) {
      setTail(tailText)

      return
    }

    // Under reduced motion, skip the scramble interval and render the fully
    // resolved text immediately. The cursor blink (CSS animation) is also
    // killed by the blanket reduced-motion CSS rule.
    if (prefersReducedMotion()) {
      setTail(tailText)

      return
    }

    let resolved = 0
    let hold = 0

    const id = window.setInterval(() => {
      if (offscreenRef.current || document.visibilityState === 'hidden') {
        return
      }

      if (resolved >= tailText.length) {
        hold += 1

        if (hold > HOLD_TICKS) {
          if (loop) {
            resolved = 0
            hold = 0
          } else {
            window.clearInterval(id)
          }
        }

        setTail(tailText)

        return
      }

      resolved += 0.5
      setTail(scrambled(tailText, Math.floor(resolved)))
    }, TICK_MS)

    return () => window.clearInterval(id)
  }, [active, loop, tailText])

  return (
    <span
      className={cn(
        'inline-flex items-center font-mono text-[0.64rem] font-semibold uppercase tracking-[0.4em] tabular-nums',
        className
      )}
      ref={hostRef}
      {...props}
    >
      {cursor && <style>{'@keyframes decode-cursor { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }'}</style>}
      {staticPrefix}
      {tail}
      {cursor && (
        <span
          aria-hidden="true"
          className="dither ml-0.5 inline-block size-2 shrink-0 -translate-y-px rounded-[1px]"
          style={{ animation: 'decode-cursor 1s step-end infinite' }}
        />
      )}
    </span>
  )
}
