import { describe, it, expect, vi } from 'vitest'

// turn-request.ts pulls value constants from page-context.ts, which imports
// 'server-only' -- neutralized here so the pure parser/windower can be unit
// tested in-process (the predict.test.ts convention). No spawned server, no
// Supabase: these are pure functions.
vi.mock('server-only', () => ({}))

import {
  windowMessages,
  HISTORY_WINDOW_TURNS,
  parseMessages,
  MAX_MESSAGES,
} from '../lib/ai/turn-request'
import type { TurnMessage } from '../lib/ai/claude'

// `turns` user/assistant PAIRS, oldest first.
function alternating(turns: number): TurnMessage[] {
  const out: TurnMessage[] = []
  for (let t = 0; t < turns; t++) {
    out.push({ role: 'user', content: `u${t}` })
    out.push({ role: 'assistant', content: `a${t}` })
  }
  return out
}

describe(`windowMessages — server-side clamp to the last ${HISTORY_WINDOW_TURNS} turns (PLAN §2.5, Sprint 19 Task 8)`, () => {
  it('leaves a short history (fewer than the window) untouched', () => {
    const history = alternating(3)
    expect(windowMessages(history)).toEqual(history)
  })

  it('a history exactly at the window is untouched', () => {
    const history = alternating(HISTORY_WINDOW_TURNS)
    expect(windowMessages(history)).toEqual(history)
  })

  it(`keeps only the last ${HISTORY_WINDOW_TURNS} user turns when the history is longer`, () => {
    const history = alternating(HISTORY_WINDOW_TURNS + 5)
    const windowed = windowMessages(history)
    expect(windowed).toHaveLength(HISTORY_WINDOW_TURNS * 2)
    expect(windowed[0]).toEqual({ role: 'user', content: `u${5}` })
    expect(windowed[windowed.length - 1]).toEqual({
      role: 'assistant',
      content: `a${HISTORY_WINDOW_TURNS + 5 - 1}`,
    })
  })

  it('always begins the window on a USER message (Anthropic requires a leading user turn)', () => {
    const windowed = windowMessages(alternating(HISTORY_WINDOW_TURNS + 4))
    expect(windowed[0].role).toBe('user')
  })

  it('respects a custom window size', () => {
    expect(windowMessages(alternating(10), 2)).toEqual([
      { role: 'user', content: 'u8' },
      { role: 'assistant', content: 'a8' },
      { role: 'user', content: 'u9' },
      { role: 'assistant', content: 'a9' },
    ])
  })

  it('an empty history windows to an empty array', () => {
    expect(windowMessages([])).toEqual([])
  })
})

describe('parseMessages — applies the window defensively before the turn reaches the provider', () => {
  // A long-but-legal history the client failed to trim: 14 full turns plus a
  // trailing user turn = 29 messages, under MAX_MESSAGES, ending on user.
  function longLegalHistory(): { messages: TurnMessage[] } {
    const messages = [...alternating(14), { role: 'user' as const, content: 'u14' }]
    return { messages }
  }

  it('clamps an over-long (but sub-MAX_MESSAGES) history to the window, still ending on the latest user turn', () => {
    const parsed = parseMessages(longLegalHistory())
    expect(parsed).not.toBeNull()
    expect(parsed!.length).toBeLessThanOrEqual(HISTORY_WINDOW_TURNS * 2)
    expect(parsed![0].role).toBe('user')
    // The current (latest) user turn is preserved verbatim as the last message.
    expect(parsed![parsed!.length - 1]).toEqual({ role: 'user', content: 'u14' })
  })

  it('a within-window history round-trips unchanged (back-compat)', () => {
    const messages = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
      { role: 'user' as const, content: 'and this?' },
    ]
    expect(parseMessages({ messages })).toEqual(messages)
  })

  it('still rejects an abusive payload over the MAX_MESSAGES ceiling (window never masks the abuse guard)', () => {
    const messages = Array.from({ length: MAX_MESSAGES + 2 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }))
    expect(parseMessages({ messages })).toBeNull()
  })
})
