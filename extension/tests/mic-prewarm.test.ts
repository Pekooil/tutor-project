// @vitest-environment jsdom
//
// Sprint 19 Task 8 (ADR-033 pre-warm amendment): the mic warm-up lifecycle in
// VoiceController.ts. prewarmMic()/releaseWarmMic() are plain module functions
// (no React, no MediaRecorder) so they unit-test directly with a stubbed
// navigator.mediaDevices -- same jsdom convention as voice-timing.test.ts. The
// central guarantee under test: pre-warm is BEST-EFFORT and never throws or
// blocks when the mic API is missing or the grant is refused.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prewarmMic, releaseWarmMic } from '../src/overlay/VoiceController';

type FakeTrack = { readyState: string; stop: () => void };

function fakeStream(): MediaStream & { _track: FakeTrack } {
  const track: FakeTrack = {
    readyState: 'live',
    stop() {
      this.readyState = 'ended';
    },
  };
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
    _track: track,
  } as unknown as MediaStream & { _track: FakeTrack };
}

function setMediaDevices(getUserMedia?: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: getUserMedia === undefined ? undefined : { getUserMedia },
    configurable: true,
  });
}

beforeEach(() => {
  releaseWarmMic(); // reset the module-level warm stream between cases
});

afterEach(() => {
  releaseWarmMic();
  vi.restoreAllMocks();
});

describe('prewarmMic — best-effort mic warm-up (never throws, degrades safely)', () => {
  it('degrades to false when the mic API is entirely absent', async () => {
    setMediaDevices(undefined);
    await expect(prewarmMic()).resolves.toBe(false);
  });

  it('degrades to false when the grant is refused, and establishes no warm stream', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Permission denied'))
      .mockResolvedValue(fakeStream());
    setMediaDevices(getUserMedia);

    expect(await prewarmMic()).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // Nothing was left warm, so the NEXT call actually acquires (proves the
    // failed attempt did not poison or half-establish the warm stream).
    expect(await prewarmMic()).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('reuses a live warm stream without a second getUserMedia (the <500ms fast path)', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    setMediaDevices(getUserMedia);

    expect(await prewarmMic()).toBe(true);
    expect(await prewarmMic()).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('releaseWarmMic stops the tracks and the next prewarm re-acquires', async () => {
    const stream = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    setMediaDevices(getUserMedia);

    expect(await prewarmMic()).toBe(true);
    releaseWarmMic();
    expect(stream._track.readyState).toBe('ended'); // the mic was actually released

    expect(await prewarmMic()).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
