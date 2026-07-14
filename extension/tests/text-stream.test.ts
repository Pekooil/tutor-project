// Sprint 19 Task 8: text-mode turns now stream token-by-token. The background's
// AI_STREAM port handler routes ordinary text turns through api.aiTurnEnvelopeStream
// (the /api/ai/turn/stream envelope SSE route the voice path already uses)
// instead of the old buffer-then-split /api/ai/turn. This spec pins the
// api.ts half -- the function the handler now calls for text -- proving it
// (a) hits the streaming route and (b) surfaces each `sayDelta` as it arrives
// plus the terminal envelope. The storage module is mocked so authorizedFetch
// has a token without chrome.storage; global fetch is stubbed with a canned SSE
// body (no network).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/storage', () => ({
  getAuth: vi.fn(async () => ({
    access_token: 'tok',
    refresh_token: 'refresh',
    expires_at: Date.now() + 60_000,
    user: { id: 'u1', email: null },
  })),
  setAuth: vi.fn(),
  clearAuth: vi.fn(),
  setActiveSession: vi.fn(),
  clearActiveSession: vi.fn(),
}));

import { aiTurnEnvelopeStream } from '../src/lib/api';
import type { TurnMessage } from '../src/types/messages';

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const MESSAGES: TurnMessage[] = [{ role: 'user', content: 'factor x^2-9' }];

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('aiTurnEnvelopeStream — the streaming route the text path now uses (Sprint 19 Task 8)', () => {
  it('POSTs to /api/ai/turn/stream and emits each sayDelta as it arrives, then resolves the envelope', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        JSON.stringify({ sayDelta: 'Split ' }),
        JSON.stringify({ sayDelta: 'the ' }),
        JSON.stringify({ sayDelta: 'difference.' }),
        JSON.stringify({ envelope: { reply: 'Split the difference.', chips: ['x-3', 'x+3'] } }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const deltas: string[] = [];
    const envelope = await aiTurnEnvelopeStream(MESSAGES, undefined, undefined, (text) => deltas.push(text));

    // sayDelta events are observed streaming in order (not one buffered blob).
    expect(deltas).toEqual(['Split ', 'the ', 'difference.']);
    // The terminal envelope threads through with its full reply + answer chips.
    expect(envelope.reply).toBe('Split the difference.');
    expect(envelope.chips).toEqual(['x-3', 'x+3']);

    // It hit the STREAMING route, not the buffered /api/ai/turn.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/ai/turn/stream');
    expect(init.method).toBe('POST');
  });

  it('throws if the stream ends without an envelope (a broken turn never resolves to a bogus reply)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([JSON.stringify({ sayDelta: 'partial' })])),
    );
    await expect(aiTurnEnvelopeStream(MESSAGES, undefined, undefined, () => {})).rejects.toThrow();
  });
});
