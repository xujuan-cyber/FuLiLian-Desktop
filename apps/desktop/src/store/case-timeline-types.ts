// Case timeline shared types (step 16 · T13). Kept in a leaf module so both
// the electron bridge surface (via global.d.ts consumers) and the renderer
// store can import without pulling nanostores or React into type position.

export const TIMELINE_EVENT_SOURCES = ['registry', 'log', 'pcap', 'file'] as const

export type TimelineSource = (typeof TIMELINE_EVENT_SOURCES)[number]

/** 方案 §5-T13 数据结构：{ at, source, event, confidence, tags[] }. */
export interface TimelineEvent {
  /** Epoch ms. */
  at: number
  source: TimelineSource
  event: string
  /** 0–100. */
  confidence: number
  tags: string[]
}

/** Payload of the `forensics:timeline` bridge. `mockGenerated` is the honest
 *  provenance marker: true ⇒ synthesized dataset, not real extraction. */
export interface TimelinePayload {
  caseId: string
  events: TimelineEvent[]
  mockGenerated: boolean
  mockReason?: string
}
