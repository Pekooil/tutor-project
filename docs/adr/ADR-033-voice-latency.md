## ADR-033: Voice pipeline latency — mic cold-start budget, TTS streamed end-to-end, and voice pinning

**Status:** Decided

**Context:** ADR-003 named voice latency as a stub for future optimization;
Sprint 06 shipped the sequential STT → turn → TTS pipeline and Sprint 14 cut
reply length to help it feel faster, but three concrete defects surfaced from
live use and are launch-gating for beta:

1. **Mic cold start (~5s).** `VoiceController.ts`'s `startRecording()` and
   `Composer.tsx`'s click handler have not been instrumented, so the ~5s from
   click to actually-recording is unattributed — candidates include
   `getUserMedia` device acquisition, `AudioContext` construction, meter
   wiring, the live-transcript `SpeechRecognition` startup running in the same
   handler, and UI state that only flips to "recording" after all of the
   above complete in sequence.
2. **Slow voice replies.** `/api/voice/tts/route.ts` already relays
   ElevenLabs' response body as a stream (`synthesize()` returns
   `response.body` directly; the route wraps it in a `NextResponse` with no
   intermediate buffering) — but `extension/src/lib/api.ts`'s
   `ttsSynthesize()` calls `res.arrayBuffer()`, and
   `background/index.ts`'s `handleVoiceTts()` base64-encodes that whole
   buffer into one `VOICE_TTS_REPLY` message. The server-side leg is already
   non-buffering; the background-script and overlay legs are not, so
   playback still waits for the entire utterance to arrive before the first
   sample plays.
3. **Wrong voice.** `elevenlabs.ts` already throws at call time if
   `ELEVENLABS_VOICE_ID` is unset, and no browser-voice fallback exists
   anywhere in the extension — so "a different voice" is not a coded
   fallback path being hit. It already sends a fixed `model_id`
   (`eleven_flash_v2_5`) but sends no `voice_settings`, leaving synthesis
   parameters partly unpinned, and no per-request logging exists to confirm
   which `voice_id`/`model_id` a given reply actually used, nor is there any
   check that the deployed backend's `ELEVENLABS_VOICE_ID` matches the
   intended voice (env drift is unruled-out).

**Decision:**
1. **Mic cold start: instrument first, budget second.** `VoiceController.ts`
   gets dev-only timing marks around `getUserMedia`, `recorder.start()`, and
   meter wiring before any fix lands, so the fix list is ordered by measured
   attribution rather than guesswork. The `AudioContext` becomes
   construct-once at module level (`resume()` per use) — it never holds a
   stream between turns, upholding ADR-011 exactly as today. Live-transcript
   `SpeechRecognition` startup runs in **parallel** with `startRecording()`
   instead of sequenced after it. `Composer.tsx`'s mic button flips to an
   honest "connecting…" state within the UI-ack budget on click, then
   "listening" only once capture is actually live — never a fake "recording"
   state ahead of the real stream. **Budget: click → actually capturing
   ≤500ms; UI acknowledges the click ≤100ms.** The timing marks stay in
   (dev-only) after the fix so a future regression is visible, not silent.
2. **TTS: pass-through, chunked relay, progressive playback — with a
   first-class fallback.** The route's existing pass-through is preserved
   (no server buffering, no persistence — ADR-011 unaffected). A new
   streaming variant of `ttsSynthesize()` yields chunks as they arrive; the
   background gets a dedicated `VOICE_TTS_STREAM` port (the existing
   `AI_STREAM` chunked-port pattern) relaying base64 chunks with
   done/error terminal messages, while the one-shot `VOICE_TTS` handler is
   **kept**, not replaced. The overlay feeds a `MediaSource`-backed
   `<audio>` element so playback starts at the first buffered chunk instead
   of waiting for the full file; word-reveal pacing switches from
   precomputed-duration pacing to `timeupdate`-driven pacing (duration is
   unknown mid-stream). If `MediaSource`/codec friction breaks a given
   utterance, that utterance falls back to today's full-buffer path
   transparently to the student — the fallback is a first-class path,
   exercised at the gate, not an emergency exit. **Budget: p50
   time-to-first-audio ≤2.5s** on a stable connection, measured to first
   sound, not full round-trip.
3. **Voice pinning + fail-loud.** `elevenlabs.ts`'s request body pins
   `model_id` and `voice_settings` explicitly via named constants (removing
   the last unpinned synthesis parameter); a per-request debug log records
   the exact `voice_id`/`model_id` sent (id only, never text content beyond
   what ElevenLabs already receives); a **module-load** assertion replaces
   the current call-time check — `ELEVENLABS_VOICE_ID` missing or malformed
   fails loud at boot, not at a student's first turn. Task 7 reproduces the
   defect first (per-request id logging, env-parity check between local and
   the deployed backend) before landing the pin; if it does not reproduce,
   the pin and boot assertion still land (they close the likeliest cause
   class regardless) and that outcome is recorded honestly in this ADR's
   amendment box below, not silently absorbed.
4. **Sequencing is unchanged.** STT → turn → TTS stays strictly sequential
   (ADR-003/PLAN §2.5) — nothing in this ADR reopens true SSE streaming of
   the turn envelope itself (`say` deltas + trailing assessment/annotations);
   that remains its own, still-deferred sprint. Only the TTS leg's internal
   transport becomes progressive, and only the mic's startup becomes
   parallelized.

**Rationale:**
- Instrumenting before fixing is the only way to guarantee the fix list is
  ordered by actual impact rather than by which technique sounds most likely
  — five seconds could live in any of several stages, and applying all the
  "usual" fixes without measurement risks declaring victory on a number that
  didn't move.
- A construct-once `AudioContext` is free latency with no ADR-011 risk: it is
  a decoder/meter context, not a held mic stream, so "no stream between
  turns" (checked live via the OS mic indicator) stays true by construction.
- Keeping the buffered TTS path alive as a first-class fallback (rather than
  a stopgap to delete later) accepts that `MediaSource`/codec friction is the
  classic failure mode for progressive audio, and a silent full-utterance
  stall would be worse than the pre-fix baseline.
- Pinning parameters and failing loud at boot converts "a different voice"
  from a mystery into either a closed cause class or a loud, immediate signal
  — never a silent degrade to the wrong voice, which was the one behavior
  explicitly ruled out from the start.

**Consequences:**
- Enables: a mic that feels instant (sub-500ms), a voice reply that starts
  talking almost immediately (sub-2.5s p50 to first sound) instead of after
  the full clip renders, and a voice identity that cannot silently drift.
- Requires: Task 5's dev-only timing marks and construct-once `AudioContext`;
  Task 6's dedicated streaming port + `MediaSource` playback path landing
  alongside (not instead of) the existing buffered path, both exercised at
  the gate; Task 7's pinned request body, per-request logging, and boot-time
  assertion.
- Forecloses: any browser-voice fallback as a response to the wrong-voice
  defect (a fail-loud pin is the only accepted fix shape); silently deleting
  the buffered TTS fallback before it's proven unnecessary; reopening true
  envelope-level SSE streaming as part of this sprint.

---

### Amendment box — wrong-voice root cause (Task 7)

*Not yet filled in — Task 7 has not run. Per this ADR's Decision 3, whatever
Task 7 finds (env drift, an unpinned parameter, an ElevenLabs-side behavior,
or no reproduction at all) gets recorded here honestly once that task
executes.*
