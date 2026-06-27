# Sprint 06 — Voice pipeline

## Goal
Make Calyxa **listen and speak**. By the end, a signed-in student opens the
overlay, **talks** to the tutor, and **hears** a spoken Socratic reply — the same
Claude turn Sprint 05 built, now wrapped in voice on both ends. The pipeline is the
one the brief draws:

```
mic audio → STT (Whisper) → text → Claude → text → TTS (ElevenLabs) → audio
```

Every leg runs **server-side behind the same bearer auth** the Sprint 04 proxy
layer established — the extension never holds the `OPENAI_API_KEY` (Whisper) or the
`ELEVENLABS_API_KEY`, just as it never holds the `ANTHROPIC_API_KEY`. Two new proxy
routes appear — **`POST /api/voice/stt`** (audio → transcript) and **`POST
/api/voice/tts`** (text → audio) — and the **Sprint 05 `/api/ai/turn` is reused
unchanged** as the middle leg. The extension reaches all three the only way it is
allowed to: overlay → content script → **background worker** (sole network-egress
context) → backend.

This sprint is deliberately the **sequential, measured** version of the pipeline,
not the fully-streamed one. A voice turn is three discrete steps run in order, with
**latency measured at each step**, and the headline acceptance is a **round-trip
under 2.5s on a stable connection**. The §2.5 sentence-level **streaming overlap**
(begin TTS while Claude is still generating), the **JSON output envelope**
(`say`/`annotations`/`assessment`), and the **annotation layer** are **deferred to a
later voice-streaming sprint** — they attach to this sprint's already-built STT and
TTS proxy seams without reshaping them. A **text fallback mode is always available**:
it is literally the Sprint 05 type→answer path, kept as the degraded route whenever
the mic is unavailable, permission is denied, or a voice leg fails.

**Audio is never persisted** (locked decision). Mic audio is held only in-memory as
it passes through the STT route to Whisper; the route imports no storage/Blob client
and writes nothing to disk or DB. The content script's **read-only DOM policy is
untouched** — the overlay still lives entirely inside its closed shadow root and
reads nothing from the host page; **page-context extraction stays out of scope** and
the prompt's page slot remains empty.

## Context
Sprint 05 delivered the **text AI tier**: `/api/ai/turn` holds the
`ANTHROPIC_API_KEY`, bearer-auths via `clientFromBearer`, assembles the §2.5 system
prompt + a hardcoded `LearningProfile`, calls Claude (`claude-haiku-4-5-20251001`)
in `/web/lib/ai/claude.ts`, and returns plain text (`{ reply }`). The extension
reaches it overlay → content (`sendAiTurn`) → background (`AI_TURN` →
`handleAiTurn` → `api.aiTurn`) → backend, reusing the Sprint 04 **401 → refresh once
→ retry** path in `authorizedFetch`. The overlay (`Overlay.tsx`) holds the running
transcript in React state and sends it each turn; the proxy is stateless. No key
appears in the extension bundle.

This sprint adds the **voice tier** of the locked stack on top of that text turn.
Locked decisions from `/CLAUDE.md` and `/docs/CLAUDE.md` that drive it:
- **STT is the OpenAI Whisper API; TTS is the ElevenLabs streaming API
  (Sprint 06+).** Both run server-side behind a proxy; their keys are server-only.
- **All API keys server-side; never in the extension bundle.** The new
  `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` are server-only env vars (never
  `NEXT_PUBLIC_`), in the same class as `ANTHROPIC_API_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY`. The bundle-grep gate is extended to cover them.
- **Session audio is never persisted. Real-time STT only.** The STT route is an
  in-memory passthrough to Whisper — no audio bytes to disk, Blob, or database.
- **DOM policy: content script reads only; overlay in shadow DOM.** The overlay
  gains a mic button and audio playback but mutates nothing on the host page; it is
  still the additive `<calyxa-overlay>` shadow host (ADR-002).

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — STT provider + scope
There are **two** divergences from PLAN.md to record here, the same way Sprint 05
recorded its split from PLAN §2.10 Sprint 3.

**(a) STT provider — Whisper, not Deepgram.** PLAN §2.1 and §2.6 select **Deepgram
(Nova streaming)** for STT and argue that **OpenAI Whisper's batch HTTP** transcription
"adds a full upload + inference cycle that blows the latency budget for conversational
turns." But the **locked stack** in both `/CLAUDE.md` and `/docs/CLAUDE.md` — which
**overrides** the design doc — names **OpenAI Whisper API**, and this sprint's brief
restates "STT (Whisper)". This sprint therefore **adopts Whisper** and records the
divergence in **ADR-010**. The latency budget is still met because this is a
**single short utterance** per turn (push-to-talk, not a live stream): a few seconds
of Opus transcribed in one batch call, a short Haiku reply (≈ under 60 words), and
ElevenLabs Flash first-audio — see the budget breakdown in Task 7. ADR-010 is the
place to revisit if measured latency fails the budget (chunked/streaming Whisper, or
escalating the Deepgram choice back to the stack owner and amending the locked stack
+ PLAN §2.1 together). **Editing PLAN.md is out of scope this sprint**; the divergence
is captured in the ADR so it is not silently lost.

**(b) Scope — sequential + measured now; streaming overlap deferred.** PLAN §2.10
Sprint 3 bundles the **full streaming pipeline** — sentence-level TTS overlap, mic
capture **+ VAD**, the §2.5 **JSON envelope**, and **annotation rendering** — into
one sprint. Sprint 05 already peeled off the text-AI half and deferred the rest
(ADR-008). This sprint takes the **next slice**: the **sequential, measured**
STT→AI→TTS loop with **push-to-talk** capture and an **always-available text
fallback**, and **defers**:
- sentence-level **streaming overlap** (Claude→TTS while still generating; PLAN
  ADR-003's ~1.1s target),
- the §2.5 **JSON output envelope** and **annotation layer** (still no consumer —
  same reasoning as ADR-008),
- continuous **VAD / endpointing** (push-to-talk gives a clean, explicit
  "stops speaking" `t=0` without an endpointer this sprint),
- the **WebSocket/SSE port relay** for live audio streams (a single recorded
  utterance per turn fits one message; PLAN §2.6's long-lived port is the streaming
  sprint's job).

Keeping the loop sequential makes the acceptance crisp ("talk, hear a reply, under
2.5s") and makes the streaming sprint a focused overlap/latency problem against a
voice turn that already works end to end. This split is recorded in **ADR-010**.

### Audio-never-persisted model (read before Tasks 2–4)
The locked "audio is never persisted" rule is enforced **structurally**, mirroring
PLAN §2.6: (1) the `/api/voice/stt` route **imports no storage/Blob/DB client** in
its module — it holds the uploaded audio only as an in-memory buffer it hands
straight to Whisper; (2) **no migration and no DB write** happen on a voice turn (the
learning tables still do not exist — ADR-009); (3) the route returns only the
**transcript text**, never the audio. The §2.5 `student_transcript` is *text*, and
even that is **not persisted this sprint** (it lands with the learning model + its
tables). ADR-011 records this and the Task 4 test asserts the no-storage-import guard.

### Latency-measurement model (read before Tasks 3, 5–7)
"Measure at each step" is a first-class deliverable, not a console.log. Each server
leg returns its **own processing time** (`sttMs`, `ttsMs`); `/api/ai/turn` is timed
by the caller (it is reused unchanged, so it is not modified to self-report). The
worker/overlay records a **`LatencyTrace`** per turn — `{ sttMs, aiMs, ttsMs,
networkMs, totalMs }` — logs it, and surfaces `totalMs` in the overlay. Task 7's
acceptance harness runs **20 trials** and asserts the **median `totalMs` < 2500 ms**
on a stable connection (PLAN §2.10 Sprint 3 acceptance #1). The trace type lives in
`/web/lib/voice/latency.ts` and is shared by the routes and (by re-declaration in
the extension types) the client.

### Text-fallback model (read before Task 6)
Text fallback is **not a new code path** — it is the Sprint 05 flow unchanged. The
overlay keeps its text input and `onSend` transport exactly as built; voice mode
**adds** a mic button that runs STT → `onSend` → TTS around that same turn. Fallback
triggers when: the user chooses text, `getUserMedia` is unavailable or denied, or any
voice leg throws. On fallback the turn degrades to **text-in/text-out** and the
overlay shows the reply as text (no audio) — never a dead end. This satisfies PLAN
§2.10 Sprint 3 acceptance #5 ("text fallback always available").

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 7)**. The dependency chain is real: the STT/TTS clients (Task 2) must exist
before the routes (Task 3); the routes must exist and be tested (Task 4) before the
extension transport (Task 5) has anything to call; the transport must exist before
the overlay UI (Task 6) can drive it; latency acceptance + E2E (Task 7) is last.
Respect the per-task **scope** lines as a focus discipline, but it is one session —
no handoff.

`/extension` is in scope and this sprint **does** touch the overlay and content
script (`src/overlay/*`, `src/content/index.ts`) to add mic capture, audio playback,
and the voice transports. The **popup is not touched** (sign-in/launcher stays as
Sprint 04 built it). `/api/ai/turn`, `/web/lib/ai/*`, the session endpoints, the
freemium gate, and the auth plumbing are **reused unchanged**.

## Files in scope

### Task 1 (planning / docs) creates or edits:
```
/docs/adr/ADR-010-voice-pipeline.md          ← new — sequential STT(Whisper)→AI→TTS(ElevenLabs); Whisper-vs-Deepgram divergence; streaming/JSON/annotations deferred
/docs/adr/ADR-011-audio-never-persisted.md   ← new — in-memory passthrough; no-storage-import guard; text fallback always available
/CLAUDE.md                                     ← edit one line: Current sprint → Sprint 06 — Voice pipeline
/docs/CLAUDE.md                                ← edit one line: Current phase → Phase 1, Sprint 6
/docs/sprint-06-plan.md                        ← this file
```

### Web — voice library (Task 2) creates / edits:
```
/web/lib/voice/whisper.ts        ← new — Whisper client; transcribe({audio,mimeType}) → {transcript}; server-only
/web/lib/voice/elevenlabs.ts     ← new — ElevenLabs client; synthesize({text}) → audio stream (eleven_flash_v2_5); server-only
/web/lib/voice/latency.ts        ← new — LatencyTrace type + helpers (shared latency contract)
/web/.env.local.example          ← edit — document OPENAI_API_KEY + ELEVENLABS_API_KEY (server-only, never NEXT_PUBLIC_) + ELEVENLABS_VOICE_ID
/web/package.json                ← edit — add `openai` (Whisper) [+ optionally `@elevenlabs/elevenlabs-js`; fetch is acceptable for TTS]
```

### Web — voice routes (Task 3) creates:
```
/web/app/api/voice/stt/route.ts  ← POST audio → bearer → Whisper → {transcript, sttMs}; NO storage/Blob import (ADR-011)
/web/app/api/voice/tts/route.ts  ← POST {text} → bearer → ElevenLabs Flash → audio stream + x-tts-ms latency header
```

### Test (Task 4) creates:
```
/web/tests/voice.test.ts         ← routes test with MOCKED Whisper + ElevenLabs clients: bearer required, transcript relayed,
                                    audio relayed, provider failure sanitised, no key leak, STT route imports no storage client
```

### Extension — voice transport (Task 5) creates / edits:
```
/extension/src/lib/api.ts            ← edit — add sttTranscribe(audio) + ttsSynthesize(text) via authorizedFetch (401→refresh→retry reused)
/extension/src/types/messages.ts     ← edit — add VOICE_STT / VOICE_TTS (→ background) + reply payloads + LatencyTrace; keep all existing types
/extension/src/background/index.ts   ← edit — handle VOICE_STT / VOICE_TTS in the async listener (4b); SignedOutError → "not signed in"
```

### Extension — overlay voice UI (Task 6) creates / edits:
```
/extension/src/overlay/VoiceController.ts  ← new — mic capture (getUserMedia + MediaRecorder, push-to-talk); no persistence; no chrome.*
/extension/src/overlay/Overlay.tsx         ← edit — mic button + audio playback + per-turn latency readout; text input kept as fallback
/extension/src/overlay/Overlay.css         ← edit — styles for mic button / recording state / latency line (shadow-root-scoped)
/extension/src/overlay/mount.tsx           ← edit — thread the onTranscribe / onSynthesize transports into <Overlay …/>
/extension/src/content/index.ts            ← edit — provide the STT/TTS transports (sendMessage VOICE_STT/VOICE_TTS); no host-page read added
```

## Files explicitly out of scope
```
/extension/src/popup/*           (sign-in/launcher unchanged — Sprint 04 stays as-is)
/web/app/api/ai/turn/*           (REUSED unchanged as the middle leg — not modified)
/web/lib/ai/*                    (system prompt / profile / claude client unchanged — Sprint 05)
/web/app/api/session/*           (session lifecycle + freemium gate unchanged — the `mode` enum already exists)
/web/app/api/auth/*              (bearer/cookie auth unchanged — Sprint 04)
/web/lib/auth/bearer.ts          (reused as-is; the voice routes import it, do not change it)
/supabase/migrations/*           (NO migration this sprint — no new tables, no audio/transcript persistence)
/packages/*                      (shared package extraction still deferred)
/docs/PLAN.md                    (the Whisper-vs-Deepgram divergence is recorded in ADR-010, not by editing PLAN this sprint)
```

Also out of scope this sprint (no pre-empting later work):
- **Sentence-level streaming overlap** (Claude→TTS while generating) and the
  **WebSocket/SSE port relay** for live audio — the **voice-streaming sprint**. A
  turn is a single recorded utterance → full transcript → full reply → full audio.
- **The §2.5 JSON output envelope** (`say`/`annotations`/`assessment`) and the
  **annotation layer** — still no consumer (ADR-008). Output stays plain text.
- **Continuous VAD / endpointing.** Push-to-talk gives an explicit end-of-speech;
  the VAD endpointer is streaming-sprint work.
- **Page-context extraction.** The content script stays read-only; the prompt's page
  slot stays empty (PLAN §2.6 extractor is its own deliverable).
- **The live learning profile / learning model / new tables** and **transcript
  persistence** (`session_interactions.student_transcript`). The profile stays
  hardcoded (ADR-009); no DB write on a voice turn.
- **Free-tier browser-`SpeechSynthesis` voice + `voice_premium` gating** and
  **per-turn freemium/`degraded` metering.** Everyone gets ElevenLabs this sprint;
  tying voice to the tier flag + session counter is billing-/voice-streaming-sprint
  work. (The `mode: 'voice'` session field already exists and is reused.)
- **Model routing/escalation** (Haiku → Sonnet → Opus). One default model still.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Voice-pipeline + audio-never-persisted ADRs + sprint pointers (planning / docs)

Write two ADRs using the project's ADR format (match ADR-001…ADR-009 exactly):

```
## ADR-0NN: [Title]
**Status:** Decided
**Context:** [why this needed a decision]
**Decision:** [what was chosen]
**Rationale:** [bullets — why]
**Consequences:** [Enables / Requires / Forecloses]
```

ADR-010 — Voice runs behind server-side proxies; sequential + measured this sprint;
STT is Whisper:
- Context: the locked stack puts STT (Whisper) and TTS (ElevenLabs) **server-side
  behind a proxy**, keys server-only — the extension must never hold
  `OPENAI_API_KEY` or `ELEVENLABS_API_KEY`. Two shape decisions were needed.
  **(1) Pipeline shape:** PLAN §2.10 Sprint 3 specifies the *full* streaming overlap
  pipeline (+VAD, +JSON envelope, +annotations); building all of it at once makes
  the first voice turn hard to accept and couples it to the still-unbuilt annotation
  layer. Candidates: full streaming-overlap now (rejected — couples to the JSON
  envelope/annotations that still have no consumer, and to VAD), or a **sequential,
  measured** STT→AI→TTS loop now with overlap deferred. **(2) STT provider:** PLAN
  §2.1/§2.6 chose **Deepgram** and argued Whisper's batch HTTP is too slow, but the
  **locked stack overrides the design doc and names Whisper**, and the sprint brief
  restates Whisper.
- Decision: two new proxy routes — **`POST /api/voice/stt`** (Whisper,
  `whisper-1`) and **`POST /api/voice/tts`** (ElevenLabs **`eleven_flash_v2_5`**,
  streaming) — both **bearer-auth'd via `clientFromBearer`** (401 if not signed in).
  The middle leg **reuses Sprint 05 `/api/ai/turn` unchanged**. A voice turn runs the
  three **sequentially** with **push-to-talk** capture and **per-step latency
  measured** into a `LatencyTrace`. **STT is Whisper** per the locked stack; the
  Deepgram divergence and its latency caveat are recorded here. **Streaming overlap,
  the §2.5 JSON envelope, annotations, VAD, and the live-audio port relay are
  deferred** to the voice-streaming sprint.
- Rationale (bullets): no STT/TTS key in the extension bundle; reuses the Sprint
  04/05 bearer seam and the unchanged `/api/ai/turn` rather than a new auth/AI path;
  a sequential measured loop makes the <2.5s acceptance crisp and the streaming
  sprint a focused overlap problem; push-to-talk yields a clean end-of-speech `t=0`
  without an endpointer; Whisper follows the authoritative locked stack — and for a
  *single short* utterance + short Haiku reply + ElevenLabs Flash first-audio the
  sequential budget still clears 2.5s on a stable connection (Task 7).
- Consequences: Enables — a working spoken tutor and stable STT/TTS proxy seams the
  streaming sprint extends without reshaping. Requires — server-only `OPENAI_API_KEY`,
  `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (never `NEXT_PUBLIC_`); the bundle-grep
  gate extended to cover them; this ADR revisited if measured latency fails the
  budget (chunked/streaming Whisper, or escalating Deepgram to the stack owner +
  amending the locked stack and PLAN §2.1 together). Forecloses — any direct
  extension→Whisper/ElevenLabs call; the STT/TTS SDKs are never imported in
  `/extension`.

ADR-011 — Session audio is never persisted; the STT route is an in-memory passthrough:
- Context: the locked rule is "session audio is never persisted; real-time STT
  only." We had to decide how to *enforce* it structurally (not by convention) for
  the new STT route, which receives raw mic audio.
- Decision: `/api/voice/stt` **imports no storage/Blob/DB client** in its module; it
  holds the uploaded audio only as an **in-memory buffer** passed straight to
  Whisper and returns **only the transcript** (never the audio). **No migration and
  no DB write** occur on a voice turn (the learning tables do not exist — ADR-009);
  even the *text* `student_transcript` is not persisted this sprint. **Text fallback
  is always available** (the unchanged Sprint 05 text turn) as the degraded path when
  the mic is unavailable/denied or any voice leg fails — a voice turn never dead-ends.
- Rationale (bullets): enforcing the rule by module structure (no storage import) is
  auditable and survives refactors; an in-memory passthrough is the minimal correct
  STT shape; returning only text keeps audio off every downstream surface; text
  fallback guarantees the tutor is reachable even with no mic.
- Consequences: Enables — a compliant audio path and a tutor that always works
  (voice or text). Requires — the STT route module to stay free of any
  storage/Blob/DB import (asserted by the Task 4 test); the mic stream stopped and
  released after each utterance. Forecloses — any on-disk/Blob/DB audio write;
  persisting the transcript is deferred to the learning sprint.

Then make two one-line edits:
- /CLAUDE.md: change the "Current sprint" line to
    Sprint 06 — Voice pipeline
- /docs/CLAUDE.md: change "Current phase" from "Phase 1, Sprint 5" to
    "Phase 1, Sprint 6"

Do not change any other line in either CLAUDE.md.

Acceptance gate before Task 2:
  - ADR-010 and ADR-011 exist and follow the ADR format exactly; ADR-010 records the
    Whisper-vs-Deepgram divergence and the sequential/streaming split.
  - Both CLAUDE.md sprint-pointer lines are updated and nothing else changed.

---

## Task 2 — Voice library: Whisper (STT) + ElevenLabs (TTS) + latency contract (web)

Scope: /web/lib/voice, /web/.env.local.example, /web/package.json. No route yet.

Add the SDK(s): `cd web && npm install openai` (Whisper STT). TTS may use the
official `@elevenlabs/elevenlabs-js` SDK **or** a plain server-side `fetch` to the
ElevenLabs streaming endpoint — pick one and keep it under `/web/lib/voice` only
(server code; never imported by anything that ships to the browser). Confirm the
installed major version and use its current API.

/web/.env.local.example — add, in the **server-only** block alongside
`ANTHROPIC_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, with the same "never
`NEXT_PUBLIC_`" warning:
```
# Server-only. The voice proxies (/web/app/api/voice/*) hold these; they must
# never reach the browser bundle or the extension (ADR-010, locked key policy).
OPENAI_API_KEY=          # Whisper STT (POST /api/voice/stt)
ELEVENLABS_API_KEY=      # ElevenLabs TTS (POST /api/voice/tts)
ELEVENLABS_VOICE_ID=     # default tutor voice id (not secret, but server-side config)
```

/web/lib/voice/latency.ts:
  - `export type LatencyTrace = { sttMs: number; aiMs: number; ttsMs: number;
    networkMs: number; totalMs: number }` — the shared per-turn timing contract
    (the extension re-declares the same shape in its types). Add a tiny helper to
    time an async leg (e.g. `export async function timed<T>(fn): Promise<{ value: T;
    ms: number }>`) so the routes report processing time consistently.

/web/lib/voice/whisper.ts (`import 'server-only'`):
  - `export async function transcribe({ audio, mimeType }: { audio: ArrayBuffer |
    Uint8Array; mimeType: string }): Promise<{ transcript: string }>`.
  - Construct the OpenAI client from `process.env.OPENAI_API_KEY` (throw a clear
    server error if unset — never default to a placeholder). Call
    `audio.transcriptions.create({ model: 'whisper-1', file })`, wrapping the
    in-memory bytes in the SDK's file helper (e.g. `toFile(...)`). Return
    `{ transcript }`. **Hold the audio only in memory** — no fs/Blob/DB (ADR-011).

/web/lib/voice/elevenlabs.ts (`import 'server-only'`):
  - `export async function synthesize({ text }: { text: string }):
    Promise<ReadableStream<Uint8Array>>` (or `Response`/async iterable — choose one
    and keep it streamable). Read `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` from
    env (throw if unset). Call ElevenLabs **`eleven_flash_v2_5`** streaming TTS for
    the given text and return the audio stream (`audio/mpeg`). No persistence.

When done, list files created/edited and paste whisper.ts, elevenlabs.ts, latency.ts.

Acceptance gate before Task 3:
  - `cd web && npm run typecheck && npm run lint` pass.
  - `transcribe` reads `OPENAI_API_KEY`, calls `whisper-1`, returns `{ transcript }`,
    and holds audio only in memory (no storage/Blob/fs import in the module).
  - `synthesize` reads the ElevenLabs env, targets `eleven_flash_v2_5`, returns a
    streamable audio body.
  - The STT/TTS SDK(s) are normal `/web` dependencies imported only under
    `/web/lib/voice` (server code), never from any client component.

---

## Task 3 — Voice proxy routes: STT + TTS (web)

Scope: /web/app/api/voice only. `/api/ai/turn` is reused unchanged (do not edit it).

/web/app/api/voice/stt/route.ts (POST audio):
  - `clientFromBearer(request)`; 401 `{ error: 'Not signed in.' }` if no user (same
    shape as `/api/session/start`). An unauthenticated client must not be able to
    spend our Whisper budget.
  - Accept the audio as `multipart/form-data` (a `file`/`audio` field) **or** a raw
    body with a content-type; validate presence, content-type, and a **size cap**
    (reject oversized uploads — push-to-talk utterances are small; cap to keep the
    budget and abuse surface sane; 400 on a bad/empty body).
  - `timed(() => transcribe({ audio, mimeType }))`; return `{ transcript, sttMs }`
    (200). Map an SDK/key failure to a **502 `{ error: 'Could not transcribe audio
    right now.' }`** — never leak provider text or key material.
  - **Import no storage/Blob/DB client** in this module; hold the audio only
    in-memory; **no DB write** (ADR-011). State this explicitly in the file header.

/web/app/api/voice/tts/route.ts (POST { text }):
  - `clientFromBearer(request)`; 401 as above. Validate `text` is a non-empty,
    length-capped string (400 otherwise).
  - Call `synthesize({ text })` and **stream the audio back** as `audio/mpeg`; put the
    server-side processing time in an **`x-tts-ms`** response header (so the client
    can fold it into the `LatencyTrace` without buffering the whole body to read a
    JSON field). Map a provider/key failure to a sanitised **502 `{ error: 'Could
    not generate audio right now.' }`**.
  - No persistence; no DB write.

Neither route classifies content — math-only is enforced by the **system prompt** on
the reused `/api/ai/turn` leg, not here. When done, list both files, paste them in
full, and state explicitly that (a) the STT/TTS keys are read only server-side inside
`/web/lib/voice/*`, (b) the STT route imports no storage client and writes nothing to
the database, (c) `/api/ai/turn` was not modified.

Acceptance gate before Task 4:
  - `next build`, typecheck, lint pass.
  - With a valid bearer: `POST /api/voice/stt` with a small audio clip returns
    `{ transcript, sttMs }`; `POST /api/voice/tts` with `{ text }` streams `audio/mpeg`
    + an `x-tts-ms` header.
  - No-bearer / garbage-bearer → 401 on both. Missing/oversized audio or empty text
    → 400. Provider failure → sanitised 502 with no key/provider-text leak.
  - The STT route module imports nothing from storage/Blob/DB.

---

## Task 4 — Voice routes test with mocked Whisper + ElevenLabs (acceptance gate)

Scope: /web/tests. The automated guarantee that auth gating, relay, sanitisation,
and the audio-never-persisted guard hold **without** spending a live STT/TTS call or
needing real keys in CI.

Create /web/tests/voice.test.ts (vitest, the runner Sprints 03–05 used). **Mock
`openai` and the ElevenLabs client** (or `/web/lib/voice/whisper.ts` and
`/web/lib/voice/elevenlabs.ts`) so no network call is made and the test is
deterministic. Assert:
1. **Bearer required (both routes):** no/invalid bearer → 401 and the mocked
   Whisper/ElevenLabs client is **never called** (no budget spent on anonymous
   callers).
2. **STT relays:** with the mock returning a known transcript, `POST /api/voice/stt`
   with a small audio body responds `{ transcript: <that>, sttMs: <number> }`.
3. **TTS relays:** with the mock returning a known audio stream, `POST
   /api/voice/tts` with `{ text }` responds `audio/mpeg` carrying those bytes + an
   `x-tts-ms` header.
4. **Bad input:** missing/oversized audio and empty/oversized text → 400, mock not
   called.
5. **Provider failure is sanitised:** make each mock throw; assert a 502 whose body
   contains **no** key material and **no** raw provider error text.
6. **Audio never persisted (structural):** assert the STT route module imports **no**
   storage/Blob/DB client (e.g. read the module source and assert it references no
   `@supabase`/Blob/`fs` import, or assert via the module's import graph). This is the
   ADR-011 guard.

Wire it into the `web` workspace `test` script (already `vitest run`). When done,
paste the test and its passing output.

Acceptance gate before Task 5:
  - The test passes: anonymous callers are 401'd before any STT/TTS call; transcript
    and audio relay; bad input is 400; provider failures are sanitised; the STT route
    imports no storage client.
  - No live Whisper/ElevenLabs call is made (mocked); the suite runs with no real
    `OPENAI_API_KEY` / `ELEVENLABS_API_KEY`.

---

## Task 5 — Extension voice transport: api + messages + background

Scope: /extension/src/lib/api.ts, /extension/src/types/messages.ts,
/extension/src/background/index.ts.

/extension/src/lib/api.ts — add (do not change the existing auth/session/`aiTurn`
helpers):
  - `export async function sttTranscribe(audio: { bytes: ArrayBuffer; mimeType:
    string }): Promise<{ transcript: string; sttMs: number }>` —
    `authorizedFetch('/api/voice/stt', …)` posting the audio (multipart or raw body
    matching Task 3), reusing the **401 → refresh once → retry** path verbatim; throw
    `Error(body.error ?? …)` on non-OK; return `{ transcript, sttMs }`.
  - `export async function ttsSynthesize(text: string): Promise<{ audio: ArrayBuffer;
    ttsMs: number }>` — `authorizedFetch('/api/voice/tts', …)` posting `{ text }`;
    read the audio body as an `ArrayBuffer` and the `x-tts-ms` header; throw on
    non-OK. A dead refresh token surfaces `SignedOutError` exactly as the others do.

/extension/src/types/messages.ts — extend the `MessageType` union with:
  - `VOICE_STT` (overlay → content → background; payload: `{ audio: <transferable/
    base64>, mimeType }`) + its reply payload `{ transcript, sttMs } | { error }`.
  - `VOICE_TTS` (overlay → content → background; payload: `{ text }`) + its reply
    payload `{ audio: <base64/transferable>, ttsMs } | { error }`.
  - `export type LatencyTrace = { sttMs; aiMs; ttsMs; networkMs; totalMs }` — mirror
    `/web/lib/voice/latency.ts` (kept in sync by convention; note the source of
    truth in a comment). Keep all existing types and the comment block; document
    that audio crosses the messaging boundary as a single short utterance per turn
    (no live stream — ADR-010) and is **never persisted** (ADR-011).
  - Note the binary-over-messaging caveat: `chrome.runtime.sendMessage` payloads are
    structured-cloned/JSON — carry the short audio as **base64** (or a typed-array
    the runtime can clone) and keep it small (push-to-talk only).

/extension/src/background/index.ts — in the **async** message listener (handler 4b,
the one that `return true`s), add `VOICE_STT` and `VOICE_TTS` cases that call
`api.sttTranscribe` / `api.ttsSynthesize` (which re-read `chrome.storage.session`
fresh) and `sendResponse` the corresponding reply; on `SignedOutError` reply
`{ error: 'not signed in' }` (the exact text the overlay maps to the sign-in prompt,
via the existing `toErrorMessage`); on any other error reply `{ error: <message> }`.
Return `true` for these cases like the others. Do **not** touch the synchronous
logging listener (handler 3) — it must keep returning `false`.

When done, list files edited and paste the two api helpers and the two background
cases.

Acceptance gate before Task 6:
  - `cd extension && npm run typecheck` passes; `wxt build` exits 0.
  - `sttTranscribe` / `ttsSynthesize` reuse `authorizedFetch` (one refresh + retry on
    401); neither imports any STT/TTS SDK or key.
  - The `VOICE_STT` / `VOICE_TTS` handlers live in the async listener and return
    `true`; the logging listener is unchanged.

---

## Task 6 — Overlay voice UI: mic capture + playback + latency + text fallback

Scope: /extension/src/overlay/*, /extension/src/content/index.ts.

/extension/src/overlay/VoiceController.ts — **new**, the mic-capture helper
(presentational/browser-only; **no `chrome.*`**, no persistence):
  - `getUserMedia({ audio: true })` + `MediaRecorder` for **push-to-talk**: start on
    press, stop on release, resolve a single `{ bytes: ArrayBuffer; mimeType }`
    utterance (Opus/webm). **Stop and release the mic track after each utterance**
    (ADR-011 — no lingering capture, no persistence). Surface a clear error when
    `getUserMedia` is unavailable or **permission is denied** so the overlay can fall
    back to text. No VAD/endpointing this sprint (push-to-talk = explicit
    end-of-speech).

/extension/src/overlay/Overlay.tsx — extend the Sprint 05 chat (still
**presentational only** — knows nothing about `chrome.*`):
  - Props: keep `onSend(messages): Promise<string>` (the AI leg); **add**
    `onTranscribe(audio): Promise<{ transcript; sttMs }>` and
    `onSynthesize(text): Promise<{ audio; ttsMs }>` — the STT/TTS transports, injected
    by the content script via mount.
  - A **mic button** (push-to-talk) alongside the existing text input. On a voice
    turn: capture via `VoiceController` (`t=0` at release) → `onTranscribe` → append
    the transcript as the user turn → `onSend(history)` (reused unchanged) → append
    the reply → `onSynthesize(reply)` → **play the audio** (an `AudioContext`/`<audio>`
    in the shadow root). Record a **`LatencyTrace`** (`sttMs` + measured `aiMs` +
    `ttsMs` + network) and **show `totalMs`** in the overlay.
  - **Text fallback (always available):** the existing text input still works
    unchanged (text-in → `onSend` → text-out, no audio). If `getUserMedia` is
    unavailable/denied or any voice leg throws, surface a notice and degrade to text;
    on the `'not signed in'` error keep the Sprint 05 "Sign in from the Calyxa popup"
    message. A busy/recording state disables inputs mid-turn.
  - No annotations, no streaming overlap, no continuous listening.

/extension/src/overlay/Overlay.css — styles for the mic button (idle/recording),
audio-playing state, and the latency readout line, still inside the shadow root
(typography on `.mm-overlay`/children, never `:host`; ADR-002). Keep the fixed
bottom-right panel.

/extension/src/overlay/mount.tsx — thread the new transports:
`mountOverlay(container, { onSend, onTranscribe, onSynthesize })` (or extend the
signature) and render `<Overlay …/>`. Keep React mounting here so the content script
never imports react-dom.

/extension/src/content/index.ts — provide the STT/TTS transports next to the existing
`sendAiTurn`: functions that `chrome.runtime.sendMessage({ type:'VOICE_STT'|
'VOICE_TTS', payload })`, read the reply, and return the transcript/audio (or throw
on `{ error }`). Pass them into `mountOverlay` in `onMount`. **Add no host-page
read** — the DOM policy is unchanged; the content script still only relays messages
and owns the shadow-root overlay.

When done, list files edited and describe the full voice flow (mic → content
`VOICE_STT` → background → `/api/voice/stt` → transcript → `onSend`/`AI_TURN` →
`/api/ai/turn` → reply → content `VOICE_TTS` → `/api/voice/tts` → audio → playback),
and confirm the text fallback path.

Acceptance gate before Task 7:
  - `wxt build` exits 0; typecheck passes.
  - Loading the unpacked extension and opening the overlay (Ctrl+Shift+Y): a mic
    button is present; press-and-hold to speak a math question, release, and the
    tutor's reply is **spoken** and shown; a per-turn latency total is displayed.
  - With the mic denied/unavailable, the overlay falls back to text and still answers.
  - The overlay imports no `chrome.*` and no key; the content script adds **no**
    host-page DOM read (git diff shows only messaging + transport wiring).

---

## Task 7 — Latency acceptance + end-to-end manual verification (manual)

This is the sprint's headline acceptance: **a student can speak a math question and
hear a Socratic answer in under 2.5s, with no STT/TTS/AI key in the extension, and no
audio persisted.**

**Latency budget (sequential, why <2.5s is reachable for a short turn):**
```
 t=0   user releases push-to-talk (end-of-speech is explicit)
   ├─ network → /api/voice/stt
   ├─ [STT]  Whisper batch transcribe (short utterance)   ~300–800ms
   ├─ network → /api/ai/turn  (reused)
   ├─ [AI]   Haiku reply, short (<~60 words)              ~500–900ms
   ├─ network → /api/voice/tts
   ├─ [TTS]  ElevenLabs Flash first audio (streamed)      ~120–250ms
 ≈ under 2.5s ◄── audio begins ✅  (sentence-level overlap, the ~1.1s target, is the next sprint)
```

With `cd web && next dev` running (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`,
`ELEVENLABS_VOICE_ID`, and the existing `ANTHROPIC_API_KEY` set in `/web/.env.local`)
and the unpacked extension loaded:
  1. Open the popup → sign in with a Sprint 03/04 test account (sign-in unchanged).
  2. On any page, open the overlay (Ctrl+Shift+Y). Push-to-talk: "How do I factor
     x² + 5x + 6?" → the tutor replies with a **spoken Socratic** nudge (a guiding
     question / small step), **not** the final factored answer.
  3. **Latency:** run **20 voice trials** on a stable connection; confirm the
     **median `totalMs` < 2500 ms** (the per-turn trace is logged + shown). Record the
     median and the per-step breakdown.
  4. Ask a follow-up by voice → the reply uses prior turns (history is sent each
     turn) and stays on the problem.
  5. Ask something **non-math** by voice → the tutor warmly redirects to math (the
     math-only hard rule on the reused `/api/ai/turn` leg fired).
  6. **Text fallback:** deny mic permission (or use the text input) → the turn
     degrades to text-in/text-out and still answers; no dead end.
  7. **Signed-out:** sign out from the popup → a voice or text turn shows "not signed
     in" / the sign-in prompt; no anonymous STT/AI/TTS call succeeds (each route
     401s).
  8. **No key in the bundle:** confirm `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`,
     `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and any `OPENAI`/`ELEVENLABS`/
     `ANTHROPIC`/`SUPABASE_` string appear **nowhere** in the built `/extension/dist`
     output (grep the bundle — none may be present).
  9. **Audio never persisted:** confirm no audio file/Blob/DB row is written during a
     voice turn — the `/api/voice/stt` module imports no storage client (Task 4
     asserts this), and there is no migration this sprint; the mic track is released
     after each utterance.
  10. Confirm the host page is byte-for-byte unchanged apart from the
      `<calyxa-overlay>` shadow host (DOM-diff): the voice UI lives entirely in the
      shadow root; the content script reads nothing from the page.

---

## Acceptance criteria (full checklist)

- [ ] `npm install` and `turbo run typecheck lint build` pass from the repo root with
      the new web files and extension changes present
- [ ] `cd web && next build` exits 0; `wxt build` exits 0
- [ ] **No migration this sprint**: `/supabase/migrations` is unchanged; a voice turn
      writes nothing to the database and persists no audio (ADR-011)
- [ ] STT/TTS SDK(s) are `/web` server dependencies, imported only under
      `/web/lib/voice`; they are never imported in `/extension`
- [ ] `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` are server-only
      (never `NEXT_PUBLIC_`), documented in `/web/.env.local.example`, and read only
      inside `/web/lib/voice/*`
- [ ] `/api/voice/stt` and `/api/voice/tts` require a valid bearer (401 otherwise) and
      never call the provider for an anonymous caller; bad input → 400; provider
      failure → sanitised 502 with no key/provider-text leakage
- [ ] STT is **Whisper** (`whisper-1`) per the locked stack; the Whisper-vs-Deepgram
      divergence from PLAN §2.1/§2.6 is recorded in ADR-010
- [ ] The `/api/voice/stt` route module imports **no** storage/Blob/DB client; audio
      is an in-memory passthrough; only the transcript is returned
- [ ] `/api/ai/turn` is **reused unchanged** as the middle leg; output stays plain
      text (no JSON envelope, no annotations) per ADR-008/ADR-010
- [ ] The mocked-provider voice route test passes (auth gate, relay, bad input,
      sanitised failure, no-storage-import guard) with no live STT/TTS call
- [ ] The extension sends overlay → content → background → `/api/voice/*` (worker is
      the only egress); a 401 triggers one refresh + retry; no key in the bundle
- [ ] The overlay records a per-step `LatencyTrace` and the **median round-trip over
      20 trials is < 2.5s** on a stable connection
- [ ] **Text fallback is always available**: mic-denied/unavailable or a failed voice
      leg degrades to text-in/text-out; signed-out turns show "not signed in"
- [ ] `/extension/src/popup/*`, `/web/app/api/ai/turn/*`, `/web/lib/ai/*`,
      `/web/app/api/session/*`, `/web/app/api/auth/*`, and `/web/lib/auth/bearer.ts`
      are untouched
- [ ] Host page unchanged apart from the `<calyxa-overlay>` shadow host (no host-DOM
      read added); the mic track is released after each utterance
- [ ] ADR-010 and ADR-011 exist; both CLAUDE.md sprint pointers updated
- [ ] git log shows commits for this sprint's tasks

---

## Risks

**STT/TTS keys creeping toward the client.** The easy wrong path is importing the
Whisper/ElevenLabs SDK (or referencing `OPENAI_API_KEY`/`ELEVENLABS_API_KEY`) from a
client component or the extension. Mitigation: the SDKs and keys live only under
`/web/lib/voice` (server); the extension imports neither (ADR-010); Task 7 greps the
built `/extension/dist` for `OPENAI`/`ELEVENLABS`/`ANTHROPIC`/`SUPABASE_` strings —
none may appear.

**Latency budget — Whisper batch vs the 2.5s target.** PLAN §2.6 explicitly warns
Whisper's batch HTTP is slower than Deepgram's streaming for conversational turns,
and we are bound to Whisper by the locked stack. Mitigation: a **single short**
push-to-talk utterance + a short Haiku reply + ElevenLabs Flash first-audio clears
2.5s sequentially on a stable connection (Task 7 budget); the `LatencyTrace` measures
every leg so a regression is visible; if the 20-trial median fails, **ADR-010** is the
recorded place to revisit (chunked/streaming Whisper, or escalating Deepgram back to
the stack owner and amending the locked stack + PLAN §2.1 together) — **do not**
swap STT providers silently.

**Building the streaming-overlap pipeline by reflex.** PLAN §2.10 Sprint 3 bundles
sentence-level overlap, VAD, the JSON envelope, and annotations with the first voice
turn. Mitigation: ADR-010 and the out-of-scope list fix the line at a **sequential,
measured, push-to-talk** loop with plain-text output; overlap/VAD/JSON/annotations are
the voice-streaming sprint.

**Microphone access from a content-script context.** `getUserMedia` in the overlay
runs in the host page's origin and is governed by the page's permissions policy — some
sites block the mic or the prompt shows the page's origin. Mitigation: this sprint
uses straightforward `getUserMedia` push-to-talk and **degrades to text** whenever the
mic is unavailable or denied (text fallback always available); an offscreen-document
mic path is a possible later refinement, not built now.

**Audio leaking to storage.** A careless refactor could write audio to a Blob/DB.
Mitigation: ADR-011 enforces it structurally — `/api/voice/stt` imports no
storage/Blob/DB client and the Task 4 test asserts that; no migration this sprint; the
mic track is released after each utterance.

**Binary over `chrome.runtime` messaging.** Audio crosses overlay → content → worker
→ backend; messaging payloads are structured-cloned/JSON and large blobs are costly.
Mitigation: this sprint sends a **single short utterance** per turn (push-to-talk) as
base64/typed-array with a size cap; the live-audio **port relay** (PLAN §2.6) is
deferred to the streaming sprint.

**Leaking provider errors / keys in responses.** Forwarding a raw Whisper/ElevenLabs
error can expose internals. Mitigation: both routes map provider/key failures to a
generic 502 with no provider text; the test asserts the sanitised body.

**MV3 listener return-value trap (carried from Sprint 04/05).** The `VOICE_STT`/
`VOICE_TTS` handlers call `sendResponse` asynchronously, so they must live in the
async listener that returns `true`; the synchronous logging listener must keep
returning `false`. Mitigation: add the cases only to the existing async listener (4b);
do not flip the logging one.

---

## What the next sprint needs to know

**The voice tier is live and keyless on the client.** A signed-in extension can hold
a **spoken** math conversation with Claude through three server-side proxy legs; the
next sprint optimises and enriches this seam, it does not rebuild it.
- **Proxies (ADR-010):** `/web/app/api/voice/stt` (Whisper `whisper-1`) and
  `/web/app/api/voice/tts` (ElevenLabs `eleven_flash_v2_5`) hold the STT/TTS keys and
  bearer-auth via `clientFromBearer`; the middle leg is the unchanged Sprint 05
  `/api/ai/turn`. The **voice-streaming sprint** swaps the sequential loop for
  **sentence-level streaming overlap** (begin TTS while Claude generates), the §2.5
  **JSON envelope** + **annotation layer**, **continuous VAD/endpointing**, and the
  **WebSocket/SSE port relay** for live audio — all attaching to these proxy seams.
- **Latency (`LatencyTrace`):** `/web/lib/voice/latency.ts` defines the per-step
  contract the overlay records and Task 7 holds to **median < 2.5s / 20 trials**. The
  streaming sprint targets PLAN ADR-003's **~1.1s first-audio** via overlap.
- **Audio policy (ADR-011):** the STT route is an in-memory passthrough that imports
  no storage client; audio is never persisted and the mic is released per utterance.
  The learning sprint that adds `session_interactions` persists only the **text**
  `student_transcript`, never audio.
- **Text fallback:** the unchanged Sprint 05 text turn is the always-available
  degraded path (mic-denied or a failed voice leg) and remains the Free-tier default
  surface when `voice_premium` gating arrives.

**Deferred to later sprints (deliberately not built):**
- Streaming-overlap pipeline, the §2.5 JSON envelope + annotation rendering,
  continuous VAD, and the live-audio port relay — the **voice-streaming sprint**.
- Page-context extraction (PLAN §2.6) — the content script still reads nothing; the
  prompt's page slot stays empty until the extractor lands.
- The live learning profile, the learning model, transcript persistence, and their
  tables — the learning sprints (the profile stays hardcoded, ADR-009).
- Free-tier browser-`SpeechSynthesis` voice + `voice_premium` gating and per-turn
  freemium/`degraded` metering tied to the session counter — the billing sprint.
- Model routing/escalation (Haiku → Sonnet → Opus) and the `/packages` extraction.
- **Open divergence to resolve:** the STT-provider question (Whisper per locked stack
  vs Deepgram per PLAN §2.1/§2.6) is recorded in ADR-010; if Task 7's latency budget
  ever fails, reconcile the locked stack and PLAN §2.1 together rather than swapping
  providers silently.
