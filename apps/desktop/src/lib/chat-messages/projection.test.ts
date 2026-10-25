import { describe, expect, it } from 'vitest'

import type { SessionMessage } from '@/types/fulilian'

import { isSettledToolOnlyAssistant, isVisibleAssistantMessage, messageVisibility, projectMessage, projectSessionMessage } from './projection'
import type { ChatMessage, ChatMessagePart } from './types'

// ── fixtures ────────────────────────────────────────────────────────────────
const msg = (over: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage =>
  ({
    parts: [],
    ...over
  }) as ChatMessage

const toolCallPart = (id: string): ChatMessagePart =>
  ({ type: 'tool-call', toolCallId: id, state: 'output-available', input: {} }) as unknown as ChatMessagePart

const sessionMsg = (over: Partial<SessionMessage> & Pick<SessionMessage, 'id' | 'role'>): SessionMessage =>
  ({ ...over }) as SessionMessage

// ── projectMessage — visibility 四值 ────────────────────────────────────────
describe('projectMessage — visibility 四值', () => {
  it('realUser：role=user 且未隐藏的提交气泡', () => {
    const message = msg({ id: 'u1', role: 'user', attachmentRefs: ['@file:a.txt'] })

    expect(projectMessage(message).visibility).toBe('realUser')
    expect(messageVisibility(message)).toBe('realUser')
  })

  it('realUser：mid-turn 插入的用户行（appendMidTurnUserMessage 产物形态）', () => {
    const message = msg({ id: 'u-live', role: 'user', timestamp: 1000 })

    expect(projectMessage(message).visibility).toBe('realUser')
  })

  it('visibleAssistant：普通 settled assistant 行', () => {
    const message = msg({ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] })

    expect(projectMessage(message).visibility).toBe('visibleAssistant')
  })

  it('visibleAssistant：system 通告行（hydration displayRole 产物 / live review 行）', () => {
    const notice = msg({ id: 's1', role: 'system', parts: [{ type: 'text', text: 'model changed' }] })

    expect(projectMessage(notice).visibility).toBe('visibleAssistant')
    expect(messageVisibility(notice)).toBe('visibleAssistant')
  })

  it('visibleAssistant：role 缺失/未知值时按 toRuntimeMessage 兜底语义归 assistant', () => {
    const toolRole = msg({ id: 't1', role: 'tool' as unknown as ChatMessage['role'] })

    expect(messageVisibility(toolRole)).toBe('visibleAssistant')
  })

  it('hiddenSynthetic：hidden=true 的分支替代行（applyReloadOptimistic 产物）', () => {
    const message = msg({
      id: 'a-old',
      role: 'assistant',
      hidden: true,
      branchGroupId: 'branch:u1'
    })

    expect(projectMessage(message).visibility).toBe('hiddenSynthetic')
  })

  it('hiddenSynthetic：hidden=true 的非活动分支行（applyBranchVisibility 产物）', () => {
    const message = msg({ id: 'a-branch', role: 'assistant', hidden: true })

    expect(messageVisibility(message)).toBe('hiddenSynthetic')
  })

  it('hiddenSynthetic：hidden=true 的用户行不归 realUser（hidden 优先于 role）', () => {
    const message = msg({ id: 'u-h', role: 'user', hidden: true })

    expect(messageVisibility(message)).toBe('hiddenSynthetic')
  })

  it('不变量：ChatMessage 层不产出 providerContextOnly（折叠属 hydration）', () => {
    const roles: ChatMessage['role'][] = ['user', 'assistant', 'system', 'tool' as ChatMessage['role']]

    for (const role of roles) {
      for (const hidden of [false, true]) {
        expect(messageVisibility(msg({ id: 'x', role, hidden }))).not.toBe('providerContextOnly')
      }
    }
  })
})

// ── projectMessage — 形态修饰轴 ─────────────────────────────────────────────
describe('projectMessage — 形态修饰轴', () => {
  it('interim=true 行：visibility=visibleAssistant 且 interim 修饰为真', () => {
    const message = msg({ id: 'a-i', role: 'assistant', interim: true })

    const projection = projectMessage(message)

    expect(projection.visibility).toBe('visibleAssistant')
    expect(projection.interim).toBe(true)
  })

  it('toolOnly：settled 全 tool-call parts 行；pending/error/hidden/空 parts 行 toolOnly=false', () => {
    const settled = msg({ id: 'a-t', role: 'assistant', parts: [toolCallPart('c1')] })
    const pending = msg({ id: 'a-p', role: 'assistant', pending: true, parts: [toolCallPart('c1')] })
    const failed = msg({ id: 'a-e', role: 'assistant', error: 'boom', parts: [toolCallPart('c1')] })
    const hidden = msg({ id: 'a-h', role: 'assistant', hidden: true, parts: [toolCallPart('c1')] })
    const empty = msg({ id: 'a-0', role: 'assistant' })
    const mixed = msg({ id: 'a-m', role: 'assistant', parts: [{ type: 'text', text: 'x' }, toolCallPart('c1')] })

    expect(projectMessage(settled).toolOnly).toBe(true)
    expect(isSettledToolOnlyAssistant(settled)).toBe(true)
    expect(projectMessage(pending).toolOnly).toBe(false)
    expect(projectMessage(failed).toolOnly).toBe(false)
    expect(projectMessage(hidden).toolOnly).toBe(false)
    expect(projectMessage(empty).toolOnly).toBe(false)
    expect(projectMessage(mixed).toolOnly).toBe(false)
  })

  it('failed：error 行 failed=true 且 visibility 仍为 visibleAssistant', () => {
    const message = msg({ id: 'a-f', role: 'assistant', error: 'turn failed' })

    const projection = projectMessage(message)

    expect(projection.failed).toBe(true)
    expect(projection.visibility).toBe('visibleAssistant')
  })

  it('pending：流式行 pending=true', () => {
    const projection = projectMessage(msg({ id: 'a-s', role: 'assistant', pending: true }))

    expect(projection.pending).toBe(true)
  })
})

// ── projectSessionMessage — hydration 分类 ──────────────────────────────────
describe('projectSessionMessage — hydration 分类', () => {
  it('providerContextOnly：role=tool 的持久行', () => {
    const message = sessionMsg({ id: 1, role: 'tool', tool_name: 'read' })

    expect(projectSessionMessage(message)).toEqual({ visibility: 'providerContextOnly', systemNotice: null })
  })

  it('providerContextOnly 优先：tool 行即使带 display_kind 也不归其他类', () => {
    const message = sessionMsg({ id: 2, role: 'tool', display_kind: 'hidden' })

    expect(projectSessionMessage(message).visibility).toBe('providerContextOnly')
  })

  it('hiddenSynthetic：display_kind=hidden（hydration transcriptContent 丢弃语义）', () => {
    const message = sessionMsg({ id: 3, role: 'assistant', display_kind: 'hidden', content: 'old branch' })

    expect(projectSessionMessage(message)).toEqual({ visibility: 'hiddenSynthetic', systemNotice: null })
  })

  it('systemNotice：model_switch / auto_continue / personality_switch / async_delegation_complete 四值逐一', () => {
    const kinds = ['model_switch', 'auto_continue', 'personality_switch', 'async_delegation_complete'] as const

    for (const kind of kinds) {
      const message = sessionMsg({ id: 4, role: 'assistant', display_kind: kind })

      expect(projectSessionMessage(message)).toEqual({ visibility: 'visibleAssistant', systemNotice: kind })
    }
  })

  it('systemNotice=null：无 display_kind 的普通行（user→realUser，assistant→visibleAssistant）', () => {
    expect(projectSessionMessage(sessionMsg({ id: 5, role: 'user', content: 'hello' }))).toEqual({
      visibility: 'realUser',
      systemNotice: null
    })
    expect(projectSessionMessage(sessionMsg({ id: 6, role: 'assistant', content: 'reply' }))).toEqual({
      visibility: 'visibleAssistant',
      systemNotice: null
    })
    expect(projectSessionMessage(sessionMsg({ id: 7, role: 'system', content: 'plain' }))).toEqual({
      visibility: 'visibleAssistant',
      systemNotice: null
    })
  })
})

// ── 投影消费等价性（A3 变异红证靶点）────────────────────────────────────────
describe('投影消费等价性', () => {
  const cases: ChatMessage[] = [
    msg({ id: 'u1', role: 'user' }),
    msg({ id: 'u2', role: 'user', hidden: true }),
    msg({ id: 'a1', role: 'assistant' }),
    msg({ id: 'a2', role: 'assistant', hidden: true }),
    msg({ id: 's1', role: 'system' }),
    msg({ id: 't1', role: 'tool' as unknown as ChatMessage['role'] })
  ]

  it('对拍：messageVisibility realUser 判定 ⟺ 既有 isVisibleUserMessage 分支（映射 #7/#16）', () => {
    for (const message of cases) {
      expect(messageVisibility(message) === 'realUser').toBe(message.role === 'user' && !message.hidden)
    }
  })

  it('对拍：visibility 非 hiddenSynthetic 判定 ⟺ 既有 !hidden 扫描（映射 #10/#12/#13）', () => {
    for (const message of cases) {
      expect(messageVisibility(message) !== 'hiddenSynthetic').toBe(!message.hidden)
    }
  })

  it('对拍：isVisibleAssistantMessage ⟺ 既有 assistant 气泡分支（映射 #2/#3/#4/#11/#14/#15）', () => {
    for (const message of cases) {
      expect(isVisibleAssistantMessage(message)).toBe(message.role === 'assistant' && !message.hidden)
    }
  })

  it('system 通告行不是 assistant 气泡（语音序数/收集不读通告，行为钉点）', () => {
    const notice = msg({ id: 's2', role: 'system', parts: [{ type: 'text', text: 'model changed' }] })

    expect(messageVisibility(notice)).toBe('visibleAssistant')
    expect(isVisibleAssistantMessage(notice)).toBe(false)
  })

  it('红证①靶点：hidden 行在可见父链扫描（runtime-repository 语义）中被跳过', () => {
    const messages = [msg({ id: 'u1', role: 'user' }), msg({ id: 'a1', role: 'assistant', hidden: true })]
    const lastVisible = [...messages].reverse().find(message => messageVisibility(message) !== 'hiddenSynthetic')

    expect(lastVisible?.id).toBe('u1')
  })

  it('红证②靶点：role=tool 持久行在 SessionMessage 层不独立成行（providerContextOnly）', () => {
    const projection = projectSessionMessage(sessionMsg({ id: 8, role: 'tool', tool_name: 'bash' }))

    expect(projection.visibility).toBe('providerContextOnly')
    expect(projection.visibility).not.toBe('visibleAssistant')
  })
})
