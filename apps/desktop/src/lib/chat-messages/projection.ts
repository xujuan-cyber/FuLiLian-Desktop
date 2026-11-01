import type { SessionMessage } from '@/types/fulilian'

import type { ChatMessage } from './types'

/**
 * FuLilian 消息投影分类学（对齐 ZCode projection policy 的四值子集；
 * ZCode 第五值 timelineOnly 在 FuLilian 无对应物，出现时须从 ACP 事件模型
 * 文档取既有术语命名，不自造同义词）。
 *
 * 本模块是消息「该不该显示 / 以什么形态显示」判断的唯一权威：渲染层与
 * hooks 不得自行书写 role/hidden 判断分支（T-F1a 设计稿 §2.0）。
 */
export const MESSAGE_PROJECTION_CLASSES = ['realUser', 'visibleAssistant', 'providerContextOnly', 'hiddenSynthetic'] as const

export type MessageProjectionClass = (typeof MESSAGE_PROJECTION_CLASSES)[number]

/** 系统通告形态——取值原样沿用 gateway 既有 display_kind 术语，不自造同义词。 */
export type SystemNoticeKind = 'model_switch' | 'auto_continue' | 'personality_switch' | 'async_delegation_complete'

const SYSTEM_NOTICE_KINDS: readonly SystemNoticeKind[] = [
  'model_switch',
  'auto_continue',
  'personality_switch',
  'async_delegation_complete'
]

/**
 * 单条 ChatMessage 的可见性类。纯函数、零分配（同 lastVisibleMessageIsUser
 * 的热路径纪律）——热路径扫描请直接调用本函数而非 projectMessage。
 *
 * - hiddenSynthetic: `hidden === true`（rewind 分支替代行 / 非活动分支行）。
 *   role 兜底收敛后仍可见的 system 通告行不在此列。
 * - realUser: `role === 'user' && !hidden`（提交乐观气泡、mid-turn 插入、
 *   hydration 持久用户行）。
 * - visibleAssistant: 其余行——assistant 行、system 通告行（hydration
 *   displayRole 产物与 live review.summary 行），以及 `role: 'tool'`/未知值
 *   按 toRuntimeMessage 的既有兜底语义收敛为 assistant 渲染。
 * - providerContextOnly 在 ChatMessage 层不产出（tool 行折叠属 hydration），
 *   由 projectSessionMessage 在 SessionMessage 层表达。
 */
export function messageVisibility(message: ChatMessage): MessageProjectionClass {
  if (message.hidden) {
    return 'hiddenSynthetic'
  }

  if (message.role === 'user') {
    return 'realUser'
  }

  return 'visibleAssistant'
}

/** 严格 assistant 气泡谓词：`role === 'assistant' && !hidden`。
 *
 *  四值 visibility 把 system 通告行归入 visibleAssistant（它们确实上屏），
 *  但既有消费端（coalesce 前邻检查、reconcileLocalAssistantTimeline、
 *  collectUnspokenTurnSpeech）在语义上要求「assistant 行且非 system 通告行」
 *  ——例如把 tool-only 后续行 coalesce 进 system 行会让其 tool parts 在
 *  system 渲染分支中丢失。这些点必须经本谓词等价迁移，而非四值 visibility
 *  （T-F1b 回执偏差申报 #1）。 */
export interface AssistantMessageLike {
  hidden?: boolean | undefined
  role: string
}

export function isVisibleAssistantMessage(message: AssistantMessageLike): boolean {
  return message.role === 'assistant' && !message.hidden
}

/**
 * Settled tool-only assistant 行：无 prose、无 reasoning 的纯工具调用行。
 * 模型常把后续一批调用作为独立的无文本消息发出；判定语义与迁移前
 * chat-runtime.ts 的 isToolOnlyAssistant 逐字节一致（含 role/hidden 前件，
 * 四值兜底不扩散进本谓词——T-F1b 回执偏差申报 #2）。
 */
export function isSettledToolOnlyAssistant(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    !message.pending &&
    !message.error &&
    !message.hidden &&
    message.parts.length > 0 &&
    message.parts.every(part => part.type === 'tool-call')
  )
}

export interface MessageProjection {
  /** 可见性类：这条消息「该不该显示」。 */
  visibility: MessageProjectionClass
  /** 形态修饰（与 visibility 正交）：sealed mid-turn commentary（message.interim），
   *  上屏但无 action footer。 */
  interim: boolean
  /** 形态修饰：settled tool-only assistant 行（coalesce 进前邻工具组的候选）。 */
  toolOnly: boolean
  /** 形态修饰：系统通告改写（hydration display_kind 系）；非通告为 null。
   *  ChatMessage 层恒为 null——display_kind 只存在于 SessionMessage，
   *  ChatMessage 的 system 行是其折叠产物，不携带 kind 信息。 */
  systemNotice: SystemNoticeKind | null
  /** 形态修饰：失败回合（错误卡形态）。 */
  failed: boolean
  /** 形态修饰：流式进行中。 */
  pending: boolean
}

/** 单条 ChatMessage 的完整投影。非热路径消费端使用；热路径扫描请用
 *  messageVisibility / isVisibleAssistantMessage（零分配）。 */
export function projectMessage(message: ChatMessage): MessageProjection {
  return {
    visibility: messageVisibility(message),
    interim: Boolean(message.interim),
    toolOnly: isSettledToolOnlyAssistant(message),
    systemNotice: null,
    failed: Boolean(message.error),
    pending: Boolean(message.pending)
  }
}

export interface SessionMessageProjection {
  visibility: MessageProjectionClass
  systemNotice: SystemNoticeKind | null
}

/**
 * SessionMessage 层分类（hydration display_kind 系的分类表达）。
 *
 * F1b 只要求本函数定义 + 单测齐备；toChatMessages 的控制流原样不动，
 * 后续包（F2/F4）才把它升级为 hydration 的实际判据（T-F1a 设计稿 §2.4）。
 *
 * - `role === 'tool'` → providerContextOnly（durable tool 行：hydration 将其
 *   折叠为 assistant 行的 tool-call part，从不独立成行）。
 * - `display_kind === 'hidden'` → hiddenSynthetic（transcriptContent 丢弃语义）。
 * - `display_kind` ∈ 系统通告四值 → visibleAssistant + systemNotice。
 * - 其余 → visibleAssistant / realUser（按 role）。
 */
export function projectSessionMessage(message: SessionMessage): SessionMessageProjection {
  if (message.role === 'tool') {
    return { visibility: 'providerContextOnly', systemNotice: null }
  }

  if (message.display_kind === 'hidden') {
    return { visibility: 'hiddenSynthetic', systemNotice: null }
  }

  if (message.display_kind !== undefined && SYSTEM_NOTICE_KINDS.includes(message.display_kind as SystemNoticeKind)) {
    return { visibility: 'visibleAssistant', systemNotice: message.display_kind as SystemNoticeKind }
  }

  return {
    visibility: message.role === 'user' ? 'realUser' : 'visibleAssistant',
    systemNotice: null
  }
}
