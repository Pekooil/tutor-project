// Cost-cap voice degrade fix (2026-07-15, ADR-041 Decision 2 / ADR-043):
// pins the background's VOICE_STT / VOICE_TTS reply shapes at the trust
// boundary the overlay consumes. Before the fix, a cost-capped STT leg fell
// through to the success shape with an UNDEFINED transcript (breaking the
// voice turn downstream) and a capped TTS leg was encoded as zero-byte audio
// the overlay then tried to play. Both must now return the explicit
// `{ degraded, degradedCap }` member instead, so the overlay can degrade
// voice to text gracefully. Same import/mocking convention as
// telemetry-routing.test.ts: background/index.ts's defineBackground callback
// is never invoked by importing the module, and the two handlers are called
// directly with `../src/lib/api` mocked.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/api', () => ({
  sttTranscribe: vi.fn(),
  ttsSynthesize: vi.fn(),
  // Telemetry flush + toErrorMessage's instanceof check need these to exist
  // even though this suite never exercises those branches.
  sendTelemetry: vi.fn(),
  SignedOutError: class SignedOutError extends Error {},
}));

import { handleVoiceStt, handleVoiceTts } from '../src/background/index';
import * as api from '../src/lib/api';

const sttMock = vi.mocked(api.sttTranscribe);
const ttsMock = vi.mocked(api.ttsSynthesize);

// A tiny valid base64 utterance for the STT payload (decoded before relay).
const AUDIO_B64 = btoa('abc');

beforeEach(() => {
  sttMock.mockReset();
  ttsMock.mockReset();
});

describe('handleVoiceStt — cost-cap degraded reply shape', () => {
  it('relays a normal transcript unchanged', async () => {
    sttMock.mockResolvedValue({ transcript: 'factor it', sttMs: 420 });
    const reply = await handleVoiceStt({ audio: AUDIO_B64, mimeType: 'audio/webm' });
    expect(reply.type).toBe('VOICE_STT_REPLY');
    expect(reply.payload).toEqual({ transcript: 'factor it', sttMs: 420 });
  });

  it('returns the explicit degraded member on a capped leg — never an undefined transcript', async () => {
    sttMock.mockResolvedValue({ degraded: true, degradedCap: 'soft' } as Awaited<
      ReturnType<typeof api.sttTranscribe>
    >);
    const reply = await handleVoiceStt({ audio: AUDIO_B64, mimeType: 'audio/webm' });
    expect(reply.type).toBe('VOICE_STT_REPLY');
    expect(reply.payload).toEqual({ degraded: true, degradedCap: 'soft' });
    expect(reply.payload).not.toHaveProperty('transcript');
  });

  it('still surfaces a real failure as the error member', async () => {
    sttMock.mockRejectedValue(new Error('whisper unavailable'));
    const reply = await handleVoiceStt({ audio: AUDIO_B64, mimeType: 'audio/webm' });
    expect(reply.payload).toEqual({ error: 'whisper unavailable' });
  });
});

describe('handleVoiceTts — cost-cap degraded reply shape', () => {
  it('relays normal audio as base64', async () => {
    ttsMock.mockResolvedValue({ audio: new Uint8Array([1, 2, 3]).buffer, ttsMs: 300 });
    const reply = await handleVoiceTts({ text: 'Nice work!' });
    expect(reply.type).toBe('VOICE_TTS_REPLY');
    expect(reply.payload).toEqual({ audio: btoa('\x01\x02\x03'), ttsMs: 300 });
  });

  it('returns the explicit degraded member on a capped leg — never zero-byte audio', async () => {
    ttsMock.mockResolvedValue({ audio: new ArrayBuffer(0), ttsMs: 0, degraded: true, degradedCap: 'hard' });
    const reply = await handleVoiceTts({ text: 'Nice work!' });
    expect(reply.type).toBe('VOICE_TTS_REPLY');
    expect(reply.payload).toEqual({ degraded: true, degradedCap: 'hard' });
    expect(reply.payload).not.toHaveProperty('audio');
  });
});
