## ADR-010: Voice runs behind server-side proxies — sequential and measured this sprint; STT is Whisper

**Status:** Decided

**Context:** The locked stack puts STT (Whisper) and TTS (ElevenLabs) server-side
behind a proxy, keys server-only — the extension must never hold
`OPENAI_API_KEY` or `ELEVENLABS_API_KEY`. Two shape decisions were needed.
**(1) Pipeline shape:** PLAN §2.10 Sprint 3 specifies the full streaming-overlap
pipeline (+VAD, +JSON envelope, +annotations); building all of it at once makes
the first voice turn hard to accept and couples it to the still-unbuilt
annotation layer. Candidates were full streaming-overlap now (rejected — it
couples to the JSON envelope/annotations that still have no consumer, and to
VAD) or a sequential, measured STT→AI→TTS loop now with overlap deferred.
**(2) STT provider:** PLAN §2.1/§2.6 chose Deepgram and argued Whisper's batch
HTTP is too slow for conversational turns, but the locked stack overrides the
design doc and names Whisper, and the sprint brief restates Whisper.

**Decision:** Two new proxy routes — `POST /api/voice/stt` (Whisper,
`whisper-1`) and `POST /api/voice/tts` (ElevenLabs `eleven_flash_v2_5`,
streaming) — both bearer-auth'd via `clientFromBearer` (401 if not signed in).
The middle leg reuses Sprint 05 `/api/ai/turn` unchanged. A voice turn runs the
three legs sequentially with push-to-talk capture and per-step latency measured
into a `LatencyTrace`. STT is Whisper per the locked stack; the Deepgram
divergence and its latency caveat are recorded here. Streaming overlap, the
§2.5 JSON envelope, annotations, VAD, and the live-audio port relay are
deferred to the voice-streaming sprint.

**Rationale:**
- No STT/TTS key in the extension bundle.
- Reuses the Sprint 04/05 bearer seam and the unchanged `/api/ai/turn` rather
  than standing up a new auth/AI path for voice.
- A sequential, measured loop makes the under-2.5s acceptance crisp and turns
  the streaming sprint into a focused overlap problem against a voice turn
  that already works end to end.
- Push-to-talk yields a clean end-of-speech `t=0` without an endpointer.
- Whisper follows the authoritative locked stack — and for a single short
  utterance plus a short Haiku reply plus ElevenLabs Flash first-audio, the
  sequential budget still clears 2.5s on a stable connection (Task 7).

**Consequences:**
- Enables: a working spoken tutor and stable STT/TTS proxy seams that the
  streaming sprint extends without reshaping.
- Requires: server-only `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`,
  `ELEVENLABS_VOICE_ID` (never `NEXT_PUBLIC_`); the bundle-grep gate extended
  to cover them; this ADR revisited if measured latency fails the budget
  (chunked/streaming Whisper, or escalating Deepgram back to the stack owner
  and amending the locked stack + PLAN §2.1 together).
- Forecloses: any direct extension→Whisper/ElevenLabs call; the STT/TTS SDKs
  are never imported in `/extension`.
