/**
 * Request algebra (F2 / T-F2a): generation tokens that keep stale async
 * responses from landing in gateway state.
 *
 * ZCode reference (`subagentsStore.ts`): `nextAgentLoadRequestId()` +
 * `isLatestAgentLoadRequest(requestId)` — concurrent loads may resolve out of
 * order, and only the newest request's response may commit. FuLilian's
 * authoritative gateway write surface is `use-gateway-boot.ts` (P10), where
 * the authoritative flows (initial boot, soft switch, HMR adopt) each ISSUE a
 * fresh generation on entry; subordinate async responders (the post-boot
 * reconnect attempt in `use-gateway-boot.ts`, the request-time reconnect in
 * `use-gateway-request.ts`) capture the current generation when they START
 * and may only write shared state while it is still the newest.
 *
 * Why a module singleton rather than per-hook refs: the competing flows live
 * in different hook instances but contend for the same atoms (`$connection`,
 * boot state, the primary socket), so the algebra must be shared across them.
 * Module state survives HMR exactly like the gateway store does, which also
 * keeps generation continuity across a hot adopt.
 */
export interface RequestAlgebra {
  /** Capture the generation a subordinate responder must still match to land. */
  current: () => number
  /** True iff `generation` is still the newest issued one. */
  isLatest: (generation: number) => boolean
  /** Issue a new generation, invalidating every earlier one. */
  issue: () => number
}

export function createRequestAlgebra(): RequestAlgebra {
  let latest = 0

  return {
    current: () => latest,
    isLatest: generation => generation === latest,
    issue: () => {
      latest += 1

      return latest
    }
  }
}

/**
 * The gateway state algebra: one per renderer process. Authoritative flows
 * issue in `use-gateway-boot.ts` (boot / softSwitch / adoptBoot); subordinate
 * responders capture + check in `use-gateway-boot.ts` (attemptReconnect) and
 * `use-gateway-request.ts` (ensureGatewayOpen).
 */
export const gatewayStateAlgebra = createRequestAlgebra()
