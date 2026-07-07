// Pure helpers behind the mic cold-start (Task 5) and TTS reveal-pacing
// (Task 6) UI, pulled out of Overlay.tsx so Task 8 can pin their behavior
// directly, in jsdom, with no real audio/MediaSource/getUserMedia involved.
// Both are extracted verbatim from what Overlay.tsx already did inline --
// zero behavior change, just a name and an import.

// The mic's three-state machine (ADR-033 Task 5): idle -> connecting ->
// recording, and back to idle either on stop or on a capture failure.
// `connecting` and `recording` are never true at once -- the composer
// always renders exactly one of idle/connecting/listening.
export type MicState = 'idle' | 'connecting' | 'recording';

export type MicAction =
  // Mic button clicked from idle -- the UI acknowledges immediately.
  | 'click'
  // startRecording() resolved -- capture is actually live.
  | 'capture-started'
  // startRecording() rejected -- back to idle, never stuck "connecting".
  | 'capture-failed'
  // handleMicStop -- the utterance is done.
  | 'stop';

export function micStateReducer(state: MicState, action: MicAction): MicState {
  switch (action) {
    case 'click':
      return state === 'idle' ? 'connecting' : state;
    case 'capture-started':
      return state === 'connecting' ? 'recording' : state;
    case 'capture-failed':
      return state === 'connecting' ? 'idle' : state;
    case 'stop':
      return state === 'recording' ? 'idle' : state;
    default:
      return state;
  }
}

// Streamed-say sentence accumulator (Sprint 15 voice follow-on, ADR-033
// amendment): the voice turn now streams the spoken text delta-by-delta, and
// we want to fire TTS one SENTENCE at a time so audio can start before the
// whole reply is generated. `push(delta)` returns any sentences COMPLETED by
// that delta (usually zero or one); `flush()` returns the trailing remainder
// once the turn stream ends (the last sentence rarely ends in punctuation +
// whitespace). Pure and synchronous so it can be unit-tested without a turn.
//
// Boundary rule is deliberately conservative: a sentence ends only at one or
// more of . ? ! FOLLOWED BY whitespace. That leaves "3.14" or "x.y" intact
// (no whitespace after the dot) at the cost of occasionally merging two
// sentences into one TTS segment -- which only makes a segment longer, never
// breaks playback. The tutor's `say` is natural-language prose (the schema
// asks it to verbalize math, e.g. "x squared"), so digit-dot-digit is rare.
export function createSentenceAccumulator(): {
  push: (delta: string) => string[];
  flush: () => string | null;
} {
  let buffer = '';
  const boundary = /^([\s\S]*?[.?!]+)(\s+)/;

  return {
    push(delta: string): string[] {
      buffer += delta;
      const out: string[] = [];
      let match: RegExpMatchArray | null;
      while ((match = buffer.match(boundary))) {
        const sentence = match[1].trim();
        if (sentence) out.push(sentence);
        buffer = buffer.slice(match[0].length);
      }
      return out;
    },
    flush(): string | null {
      const rest = buffer.trim();
      buffer = '';
      return rest.length > 0 ? rest : null;
    },
  };
}

// Timeupdate-driven reveal pacing (ADR-033 Task 6): how many of the reply's
// words should be visible given how far playback has actually gotten.
// currentTime stops advancing during a stall (waiting on the next chunk),
// so pacing off of it self-corrects for free -- a wall-clock setInterval
// doesn't have that property. Floor(elapsed / msPerWord) + 1 reveals the
// first word immediately at currentTime === 0 rather than waiting a full
// msPerWord for it to appear.
export function wordsDueByTime(currentTimeMs: number, msPerWord: number, totalWords: number): number {
  return Math.min(totalWords, Math.floor(currentTimeMs / msPerWord) + 1);
}
