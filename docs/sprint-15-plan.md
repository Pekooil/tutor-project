# Sprint 15 — Curriculum expansion (HS math + intro calculus) + voice pipeline latency

## Goal
Make Calyxa **cover the math a real student brings to it, and feel instant when
they talk to it**. The two halves are independent workstreams sharing one sprint
(and almost no files); both are launch-gating for beta:

1. **Curriculum expansion.** The knowledge graph grows from the 8-concept algebra
   stopgap to a real curriculum: **all core high-school math — Algebra 1,
   Geometry, Algebra 2, Trigonometry/Precalculus, intro Probability & Statistics —
   plus AP/intro-college Calculus** (limits through the Fundamental Theorem and
   basic applications). Every concept ships with key, strand, **title** (Sprint 13's
   display contract), prerequisite edges, a difficulty prior, and **topic aliases
   folded into the concept itself** — retiring the hand-maintained parallel alias
   table the Sprint 11 audit flagged as drift-prone. The 8 existing keys are
   **frozen** (live `knowledge_nodes` rows point at them).
2. **Voice pipeline latency + voice pinning.** Three defects from live use:
   - the **mic takes ~5s** from click to actually recording — instrument, then fix
     the cold start (shared AudioContext, parallelized startup, honest
     "connecting" state) with a **click→capturing budget of ≤500ms**;
   - the **voice reply is slow** — cut time-to-first-audio by streaming the TTS
     leg end-to-end (server pass-through + progressive playback), banking the
     Sprint 14 conciseness win, with a **p50 time-to-first-audio ≤2.5s** target on
     a stable connection (Sprint 06's headline, now measured to first sound, not
     full round-trip);
   - the tutor sometimes speaks in **a different voice than the configured
     ElevenLabs voice** — diagnose, then **pin** voice_id + model_id + voice
     settings explicitly and fail loud on env drift, never silently degrade to a
     wrong voice.

```
curriculum:  /packages/curriculum (8 concepts, 1 strand)
          ─▶ /packages/curriculum (≈70 concepts, 6 strands, titles + prereqs +
             priors + aliases in-concept) ─▶ topic bias, envelope keys, prompt
             scope, profile reads all widen for free (same seams, more nodes)

voice:  click ──[≤500ms]──▶ capturing ──▶ STT ──▶ turn ──▶ TTS first byte
                                                            └─▶ playback starts
                                                                [p50 ≤2.5s total]
```

## Context
Sprint 14 made sessions problem-sized, shortened the tutor's replies, and
decomposed the overlay — this sprint builds directly on all three. The curriculum
half fulfils the "usable at launch" scope call: the tutor must not be blind to
derivatives, triangles, or logarithms when a beta tester opens it on their actual
homework. The voice half pays down the three defects that make voice mode feel
broken in live use, **without** pulling in the full streaming-envelope sprint
(SSE `say` deltas + trailing assessment/annotations remain deferred — ADR-019's
seam note stands).

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what this implements
- **§2.4's curriculum graph, at real size.** The 8-concept graph was always the
  Sprint 09 stopgap ("a real curriculum pass is its own deliverable"). This sprint
  is that deliverable — structure unchanged (keys, prereq edges, priors), content
  completed. The FSRS math, `updateKnowledgeNode`, and the §2.4 update algorithm
  are **untouched**: more nodes, same model.
- **§2.5's prompt cannot list ~70 keys per turn.** Today the prompt can afford to
  enumerate every known concept key; at curriculum scale that bloats every turn.
  The prompt's key vocabulary becomes a **bounded relevant subset** (profile
  nodes + topic-detected keys + due keys + their strand neighbors, capped ~24);
  `envelope.ts` still validates against the **full** `CONCEPT_KEYS` list, so a
  correct key outside the injected subset is kept, not dropped (ADR-030).
- **§2.5/ADR-003's voice pipeline stays sequential** — STT → turn → TTS. What
  changes is inside the TTS leg (server pass-through streaming + progressive
  playback) and before the first leg (mic cold start). ADR-003's latency
  optimisation stub is finally cashed as ADR-031.
- **ADR-011 is untouched**: the mic track is still released after every
  utterance; the shared AudioContext holds **no stream** between turns — it is a
  decoder/meter context, not an open mic.
- **V1 scope holds**: math only. Probability & Statistics is included as an HS
  math course; no non-math subject enters the graph.

### The 8 live keys are frozen; everything else is additive (read before Tasks 2, 3)
`knowledge_nodes`, `misconceptions`, and `reinforcement_schedule` rows in
production dev data reference the existing keys. **No existing key or title is
renamed or removed.** New concepts are additive; prerequisite edges may point at
old keys; no migration exists (concept keys are strings in the DB by design —
ADR-009/014 held that seam precisely so the graph could grow without schema work).

### Aliases move into the concept — the audit's de-drift (read before Task 3)
The Sprint 11 audit flagged `topic.ts`'s hand-maintained alias table: adding a
concept without an alias entry silently exempts it from topic bias. The fix is
structural: `Concept` gains `aliases: readonly string[]`, the curriculum tests
fail the build on a concept with no aliases, and `topic.ts` derives its table
from the curriculum at import time (its own hand map deleted). Same for
`KNOWN_CONCEPT_KEYS` in `web/lib/learning/types.ts`: it becomes a re-export of
the curriculum's `CONCEPT_KEYS` if it is not already — one source of truth.

### The mic cold start is measured before it is fixed (read before Task 5)
The ~5s is observed, not yet attributed: candidates are `getUserMedia` device
acquisition, AudioContext construction, the meter wiring, the live-transcript
SpeechRecognition startup that runs in the same handler, and UI state that only
flips to "recording" after all of the above. Task 5 first lands timing marks
around each stage (console-level, dev-only), then applies the fixes in likely-
impact order: **construct-once AudioContext** (module-level, `resume()` per use —
it never holds a stream, ADR-011-safe), **parallelize** SpeechRecognition startup
with `getUserMedia` instead of sequencing them, **flip the UI immediately** to an
honest "connecting…" state on click (never fake "recording" before the stream is
live), and wire the meter after `recorder.start()` rather than before. The budget
(click → actually capturing ≤500ms; UI acknowledges ≤100ms) is the gate, not the
technique list.

### Time-to-first-audio, not round-trip, is the metric that matters (read before Task 6)
Today `/api/voice/tts` buffers ElevenLabs' stream server-side, the background
relays one base64 blob, and playback starts only after the whole file lands.
Every leg of that is latency the student hears as silence. Task 6 makes the TTS
leg progressive end-to-end: the route **passes the ElevenLabs stream through**
(no server buffering), the background relays **chunks over a dedicated port**
(the AI_STREAM port pattern, base64 chunks), and the overlay plays via
**MediaSource** so audio starts at first buffered chunk. The word-reveal sync
switches from precomputed-duration pacing to `timeupdate`-driven pacing (duration
is unknown mid-stream). **Fallback is first-class**: if MediaSource/codec
friction bites on the streamed format, the client falls back to today's
full-buffer path per utterance — same wire, buffered client-side — and the
server-side pass-through still removes the server buffering leg. This is the
sprint's riskiest task and is gated accordingly.

### The wrong voice is diagnosed before it is fixed (read before Task 7)
`elevenlabs.ts` already throws when `ELEVENLABS_VOICE_ID` is unset, and no
browser-voice fallback exists anywhere in the extension — so "a different voice"
cannot be a coded fallback path. Prime suspects: **env drift** between
environments (a different voice id configured where the deployed backend runs),
and **unpinned synthesis parameters** (`model_id`/`voice_settings` omitted →
provider defaults that can shift and change how the same voice sounds). Task 7
first reproduces with per-request logging of the exact voice_id/model_id sent,
then pins all synthesis parameters explicitly, adds a boot-time env assertion
(fail loud, not fall back), and records the actual root cause found in ADR-031's
amendment box. If the reproduction shows something else (e.g. an ElevenLabs-side
behavior), the pin + assertion still land and the finding is recorded.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 9)**. The chain: ADRs fix the coverage list, the key-budget rule, and the
latency budgets (Task 1); the curriculum data (Task 2) must exist before the
alias/key unification (Task 3) and the prompt scope work (Task 4) can consume it;
the voice tasks (5 → 6 → 7) run mic-first (cheapest, most user-visible), then
TTS streaming (riskiest), then voice pinning (diagnosis benefits from Task 6's
instrumentation); tests (Task 8) gate manual acceptance (Task 9). The two halves
share no files, but one session keeps the plan's sequencing honest — no handoff.

This sprint touches: `/packages/curriculum` (restructured + expanded),
`/web/lib/learning/{topic,types}.ts`, `/web/lib/ai/system-prompt.ts` (key budget +
subject scope only), `/web/lib/voice/elevenlabs.ts`, `/web/app/api/voice/tts/
route.ts`, and on the extension side `VoiceController.ts`, `Composer.tsx`,
`Overlay.tsx` (voice-path wiring only), `lib/api.ts`, `background/index.ts`,
`types/messages.ts`. It does **not** touch `/supabase` (no migration — keys are
strings), `/packages/learning-model` (FSRS math unchanged), the STT route/model
(the ADR-010 amendment stands), the turn route, `envelope.ts` (full-list
validation already correct), the annotation/tag/ping/recap surfaces (Sprint 14's
work is consumed as-is), or the session lifecycle.

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
```
/docs/adr/ADR-030-curriculum-expansion.md ← new — the six strands + concept inventory (≈70) at launch; 8 existing keys frozen; aliases + titles + priors in-concept (single source; build fails on a missing alias/title); the prompt key-budget rule (bounded relevant subset ~24, full-list validation at parse); per-strand module layout. REVISITS the Sprint 09 stopgap; closes the Sprint 11 audit's alias-drift flag.
/docs/adr/ADR-031-voice-latency.md        ← new — cashes PLAN §2.11's ADR-003 stub: the mic cold-start budget (click→capturing ≤500ms, UI ack ≤100ms) + construct-once AudioContext (no held stream — ADR-011 upheld); TTS pass-through + chunked port relay + MediaSource progressive playback with the buffered fallback as a first-class path; voice pinning (explicit voice_id/model_id/voice_settings, boot env assertion, fail-loud); p50 time-to-first-audio ≤2.5s; root cause of the wrong-voice defect recorded here once found.
/CLAUDE.md                                 ← edit one line: Current sprint → Sprint 15 — Curriculum expansion + voice pipeline latency
/docs/CLAUDE.md                            ← edit one line: Current phase → Phase 2, Sprint 15
/docs/sprint-15-plan.md                    ← this file
/docs/architecture.md                      ← edit: curriculum at launch scale (six strands, aliases in-concept); TTS leg streamed end-to-end; voice pinned
```

### Task 2 (curriculum — the graph at launch scale) creates / edits:
```
/packages/curriculum/src/concepts/algebra1.ts   ← new — existing 8 concepts MOVE here byte-compatible (keys/titles/priors unchanged) + additions: systems of linear equations, radicals & rational exponents, absolute value, function notation & graphs, ratios/proportions/percent.
/packages/curriculum/src/concepts/geometry.ts   ← new — angles & parallel lines, triangle congruence, similarity, right-triangle trig (SOH-CAH-TOA), circles (arcs/angles/area), area & volume, coordinate geometry & transformations.
/packages/curriculum/src/concepts/algebra2.ts   ← new — polynomial division & factor theorem, rational expressions & equations, exponential functions, logarithms & properties, sequences & series, complex numbers, systems (nonlinear).
/packages/curriculum/src/concepts/trig-precalc.ts ← new — unit circle & radian measure, trig graphs, trig identities, trig equations, inverse trig, vectors, limits (intuitive intro — the precalc/calc bridge).
/packages/curriculum/src/concepts/calculus.ts   ← new — limits & continuity (formal), derivative as a limit, differentiation rules (power/product/quotient), chain rule, implicit differentiation, applications (related rates, optimization, curve sketching), antiderivatives & indefinite integrals, definite integrals & FTC, u-substitution, applications of integration (area between curves, volumes), intro differential equations. Covers AP Calc AB + a first college calculus course.
/packages/curriculum/src/concepts/prob-stats.ts ← new — descriptive statistics, probability rules & counting, conditional probability, random variables & expected value, normal distribution basics.
/packages/curriculum/src/concepts/index.ts      ← new — concatenates the strand modules into CONCEPTS/CONCEPT_KEYS; the Concept type gains `aliases: readonly string[]` and (if absent) a `strandLabel`; getConcept/prerequisitesOf unchanged in signature.
/packages/curriculum/src/concepts.ts            ← edit — becomes a re-export of concepts/index.ts (import sites unchanged) or is replaced by it with package exports updated — whichever keeps every existing import working untouched.
/packages/curriculum/**/*.test.ts               ← edit/new — graph invariants at scale: unique keys; every prerequisite key exists; the prereq graph is acyclic; every concept has a nonempty title AND ≥2 aliases; difficultyPrior in range; the 8 frozen keys byte-identical to Sprint 13.
```

### Task 3 (web — alias/key unification, the de-drift) edits:
```
/web/lib/learning/topic.ts  ← edit — the hand-maintained alias table is DELETED; the detection table derives from @calyxa/curriculum aliases at import time; detectTopicKeys's contract (reorder + add, never drop; [] reads as today; deterministic) unchanged; the drift-guard test flips from "no unknown keys leak" to "every curriculum concept is reachable by its own aliases".
/web/lib/learning/types.ts  ← edit — KNOWN_CONCEPT_KEYS becomes a re-export of CONCEPT_KEYS from @calyxa/curriculum (single source of truth); if it already is one, this task is a verify-only no-op recorded in the commit message.
```

### Task 4 (web — prompt subject scope + the key budget) edits:
```
/web/lib/ai/system-prompt.ts ← edit — (a) the subject-scope line widens: high-school math through intro college calculus (still math-only — V1 scope); (b) the concept-key vocabulary block switches from "all known keys" to the BOUNDED RELEVANT SUBSET: the profile's surfaced nodes + topic-detected keys + due keys + their strand neighbors, capped ~24, with an instruction that an assessed concept outside the list should still use the closest listed key OR the canonical key if the student's topic clearly names it. No other block changes (Sprint 14's completion/progress/annotation/conciseness blocks untouched).
/web/lib/ai/profile.ts       ← edit — only if the key-subset assembly needs a helper here (the profile already surfaces its own node keys); no shape change to LearningProfile.
```

### Task 5 (extension — mic cold start) edits:
```
/extension/src/overlay/VoiceController.ts ← edit — dev-only timing marks around getUserMedia / recorder.start / meter wiring; module-level construct-once AudioContext (resume() per use, never holds a stream — ADR-011); meter wired AFTER recorder.start(); startRecording()'s external contract (RecordingHandle) unchanged.
/extension/src/overlay/Composer.tsx       ← edit — mic button flips to an honest "connecting…" state ≤100ms after click, then "listening" when capture is actually live; SpeechRecognition (live transcript) startup runs IN PARALLEL with startRecording, not after it.
/extension/src/overlay/Overlay.tsx        ← edit — handleMicStart wiring for the parallel startup + the connecting state; nothing else.
```

### Task 6 (voice — TTS streamed end-to-end) edits:
```
/web/app/api/voice/tts/route.ts     ← edit — pass the ElevenLabs response stream through (ReadableStream body, no server-side buffering); headers preserve content type; bearer auth + entitlement checks unchanged; audio still never persisted (ADR-011).
/extension/src/lib/api.ts           ← edit — ttsSynthesize gains a streaming variant that yields chunks as they arrive; the buffered variant KEPT as the fallback path.
/extension/src/background/index.ts  ← edit — a dedicated VOICE_TTS_STREAM port (the AI_STREAM pattern): base64 chunks + done/error; the existing one-shot VOICE_TTS handler KEPT (fallback).
/extension/src/types/messages.ts    ← edit — the stream port's chunk/done/error message shapes.
/extension/src/overlay/Overlay.tsx  ← edit — playAudioWithTextReveal gains a MediaSource-fed path: playback starts at first buffered chunk; word reveal paces off timeupdate/currentTime instead of a precomputed duration; on MediaSource/codec failure for an utterance, that utterance falls back to the buffered path (seamless to the student).
```

### Task 7 (voice — pinning + fail-loud) edits:
```
/web/lib/voice/elevenlabs.ts ← edit — request body pins model_id + voice_settings explicitly (named constants); per-request debug log of the exact voice_id/model_id sent (id only — never text content beyond what is already sent); a module-load assertion that ELEVENLABS_VOICE_ID is present AND well-formed fails loud at boot rather than at first student turn.
/web/tests/voice.test.ts     ← edit — the fake-server assertions extend to the pinned fields (a request missing model_id/voice_settings fails the test).
```

### Task 8 (tests) creates / edits:
```
/packages/curriculum/**/*.test.ts ← (Task 2's invariants, listed there — the gate re-runs them at scale)
/web/tests/topic.test.ts          ← edit — detection derives from curriculum aliases; every-concept-reachable drift guard; determinism preserved.
/web/tests/envelope.test.ts       ← edit — assessments carrying NEW curriculum keys (a calculus key, a geometry key) parse and validate against the full list.
/web/tests/system-prompt.test.ts  ← edit/new — the key-budget block: subset capped; profile + topic + due keys present; strand neighbors included; full-list enumeration absent at curriculum scale.
/web/tests/voice.test.ts          ← (Task 7's pinning assertions) + the tts route streams (response body is a stream, not a buffered blob) against the local fake.
/extension/tests/voice-timing.test.ts ← new — pure helpers only: the connecting→listening state reducer and the reveal-pacing function (currentTime-driven), jsdom-level; no real audio.
```

### Files explicitly out of scope
```
/supabase/**                          (NO migration — concept keys are strings; the graph grows without schema work)
/packages/learning-model/**           (FSRS math untouched — more nodes, same model)
/web/app/api/voice/stt/route.ts + /web/lib/voice/whisper.ts (the ADR-010 STT amendment stands; the WAV normalisation stays — the model rejects Chrome's webm)
/web/app/api/ai/turn/route.ts         (unchanged — the key budget is prompt-side; parse-side already validates the full list)
/web/lib/ai/envelope.ts               (full-list validation already correct — tests only)
/web/lib/learning/{apply,scheduler,profile-read,events}.ts (untouched; they widen for free via KNOWN_CONCEPT_KEYS)
/extension/src/overlay/{TitleBar,InsightStrip,Transcript,PingToasts}.tsx (Sprint 14 surfaces consumed as-is)
/extension/src/content/**             (page extraction/annotation resolution unchanged)
```
Also out of scope (no pre-empting later roadmap sprints):
- **True SSE streaming of the envelope** (`say` deltas + trailing assessment/
  annotations over `/api/ai/stream`) — still its own sprint; this sprint streams
  only the TTS leg.
- **Cold-start onboarding / the assessment item bank** — the instrumentation +
  onboarding sprint; the difficulty priors landed here are its input.
- **Non-math subjects, IRT/item calibration, diagram understanding** — Phase 3+
  (PLAN's deferred table).
- **Retuning FREE_SESSION_LIMIT** — Sprint 16, per ADR-027's flag.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Curriculum-scale + voice-latency ADRs + sprint pointers (planning / docs)

Write ADR-030 and ADR-031 per the Files-in-scope annotations — ADR-030 carries
the full strand/concept inventory as its appendix (the one place the list lives
outside the code), ADR-031 carries the budgets and leaves a labeled amendment box
for the wrong-voice root cause found in Task 7.

Acceptance gate before Task 2:
  - Both ADRs read as decisions; the inventory appendix enumerates every planned
    key so Task 2 is transcription, not invention; pointers updated.

---

## Task 2 — Curriculum: the graph at launch scale (packages)

Scope: per the Files-in-scope annotations. Data-heavy, logic-light: the only code
change is the `aliases` field and the per-strand module layout.

  - **Frozen keys verified first**: a test pins the 8 Sprint 13 keys + titles
    byte-identical before any addition lands.
  - Prerequisite edges cross strands where the math does (e.g. right-triangle
    trig ← similarity; derivative-as-limit ← limits & continuity ← the precalc
    limits intro; u-substitution ← chain rule + antiderivatives).
  - Difficulty priors set per strand band (existing 8 keep theirs); aliases are
    the student-language phrases topic detection will actually see ("slope",
    "SOH CAH TOA", "chain rule", "u-sub", "log rules", "unit circle").
  - Target ≈70 concepts; the ADR-030 inventory is the checklist.

Acceptance gate before Task 3:
  - Package tests green (all invariants); `turbo run typecheck build` green
    across workspaces (every import site of the old module still compiles);
    frozen-key test passes.

---

## Task 3 — Web: alias/key unification (learning lib)

Scope: `topic.ts` + `types.ts`, per the Files-in-scope annotations. The behavior
contract of `detectTopicKeys` is unchanged — only its table's source moves.

Acceptance gate before Task 4:
  - `topic.test.ts` green including the every-concept-reachable guard; a page
    mentioning "chain rule" biases the calculus key with zero hand-map edits —
    the drift class is structurally closed.

---

## Task 4 — Web: prompt subject scope + the key budget

Scope: `system-prompt.ts` (+ `profile.ts` helper only if needed), per the
Files-in-scope annotations.

  - The subset assembly is deterministic and testable: profile keys ∪ topic keys
    ∪ due keys, then strand neighbors to the cap; stable order.
  - Live-checked at the gate: a turn on a derivative problem assesses with a
    calculus key; the prompt (dev-logged) shows the bounded block, not ~70 keys.

Acceptance gate before Task 5:
  - `system-prompt.test.ts` green; the live check above; token count of the key
    block at curriculum scale recorded in the checklist notes (sanity: within
    ~2× the Sprint 13 block, not ~9×).

---

## Task 5 — Extension: mic cold start (measure, then fix)

Scope: `VoiceController.ts`, `Composer.tsx`, `Overlay.tsx`, per the Files-in-scope
annotations. Instrument first — the marks stay (dev-only) after the fix so
regressions are visible.

Acceptance gate before Task 6:
  - Measured on a real page: UI acknowledges ≤100ms; click→capturing ≤500ms
    (down from ~5s), attributed stage-by-stage in the checklist notes; ADR-011
    honored (no stream held between turns — verified by the OS mic indicator
    going dark between utterances).

---

## Task 6 — Voice: TTS streamed end-to-end (route → port → MediaSource)

Scope: per the Files-in-scope annotations. The riskiest task; the buffered path
is kept alive as the per-utterance fallback and the gate requires BOTH paths.

  - Server: pass-through only — no buffering, no persistence, no transcode.
  - Background: chunked base64 over the dedicated port; done/error terminal
    messages; the one-shot handler untouched.
  - Overlay: MediaSource-fed `<audio>`; playback at first buffered chunk; reveal
    paced by `timeupdate`; per-utterance fallback on codec/MediaSource failure.

Acceptance gate before Task 7:
  - On a stable connection, p50 time-to-first-audio over 10 voice turns ≤2.5s
    (numbers recorded); the fallback path exercised deliberately (forced codec
    failure) and seamless; audio never persisted anywhere (route imports no
    storage client — unchanged).

---

## Task 7 — Voice: pinning + fail-loud (diagnose, then pin)

Scope: `elevenlabs.ts` + `voice.test.ts`, per the Files-in-scope annotations.

  - Reproduce first with the per-request id logging; check env parity between
    local and the deployed backend for ELEVENLABS_VOICE_ID.
  - Pin model_id + voice_settings; boot assertion fails loud on missing/
    malformed voice id; record the actual root cause in ADR-031's amendment box.

Acceptance gate before Task 8:
  - 10 consecutive voice turns speak in the configured voice; the pinned-fields
    test fails when a pin is removed (verified by reverting once); the root
    cause is written down.

---

## Task 8 — Tests (gate)

Scope: per the Files-in-scope annotations — curriculum invariants at scale,
topic derivation, new-key envelope validation, the key-budget block, TTS
pinning + streaming, and the pure voice-timing helpers.

Acceptance gate before Task 9:
  - `turbo run test` green across workspaces; each new spec fails meaningfully
    when its guarded behavior is reverted (spot-check one per area).

---

## Task 9 — Curriculum + voice acceptance (manual)

Signed in as a real dev user, on real pages:

  1. **A derivative problem** (calculus page): the tutor engages in-scope,
     assesses with a calculus concept key, the profile gains the node, topic
     bias surfaces it next turn; annotations/tags/progress (Sprint 14) all work
     against the new key.
  2. **A geometry problem**: same, with a geometry key; prerequisite edges show
     up in the overview once mastery exists.
  3. **The frozen 8**: an algebra session on an old key still reads/writes the
     same node (no orphaned history).
  4. **Mic**: ten cold mic presses across pages — UI acks instantly, capture
     live ≤500ms each; OS mic indicator dark between turns.
  5. **Voice reply**: ten voice turns — p50 time-to-first-audio ≤2.5s recorded;
     the reveal tracks the speech; one forced-fallback turn is seamless.
  6. **Voice identity**: all turns in the configured ElevenLabs voice.
  7. Full pipeline check: `turbo run typecheck lint build test` green.

Record all measured numbers (cold-start attribution, p50/p95 first-audio, key-
block token count) in the checklist notes — Sprint 16's cost work and the beta
comms both consume them.

## Acceptance criteria (full checklist)

- [ ] ADR-030 (with the concept inventory appendix) + ADR-031 (with budgets + the root-cause amendment box) written; pointers + architecture.md updated
- [ ] Curriculum at ≈70 concepts across algebra1 / geometry / algebra2 / trig-precalc / calculus / prob-stats; per-strand modules; every import site compiles unchanged
- [ ] The 8 Sprint 13 keys + titles byte-identical (frozen-key test); no migration anywhere
- [ ] Every concept: unique key, nonempty title, ≥2 aliases, valid prereq keys, acyclic graph, prior in range — enforced by tests that fail the build
- [ ] topic.ts derives from curriculum aliases (hand map deleted); every concept reachable by its own aliases; KNOWN_CONCEPT_KEYS re-exports CONCEPT_KEYS
- [ ] Prompt: subject scope = HS math through intro college calculus; key vocabulary = bounded relevant subset (~24 cap), full-list validation at parse unchanged
- [ ] Mic: UI ack ≤100ms, click→capturing ≤500ms, measured + attributed; construct-once AudioContext holds no stream (ADR-011 verified via OS indicator)
- [ ] TTS: server pass-through (no buffering) + chunked port + MediaSource progressive playback; buffered fallback kept + exercised; reveal paced by timeupdate
- [ ] p50 time-to-first-audio ≤2.5s over 10 turns on a stable connection (numbers recorded)
- [ ] Voice pinned: explicit voice_id/model_id/voice_settings; boot assertion fails loud; 10/10 turns in the configured voice; root cause recorded in ADR-031
- [ ] Audio still never persisted (ADR-011); STT leg untouched
- [ ] `turbo run typecheck lint build test` green across workspaces; Task 9 manual pass complete with all numbers recorded

## Risks

**Curriculum quality is a content risk, not a code risk.** A wrong prerequisite
edge or a missing alias degrades quietly (bad ordering, missed topic bias), not
loudly. Mitigation: the ADR-030 inventory is reviewed as a document before
transcription; the invariant tests catch the structural half; beta telemetry
(next sprint) is the feedback loop for the content half — the graph is data, so
fixes are data edits.

**Prompt scale regressions.** More concepts → a longer key block → subtle drift
in assessment key choice. Mitigation: the bounded subset caps the block; the
Task 4 gate records its token cost; envelope validation against the full list
means a good key outside the subset is never lost.

**MediaSource/codec friction on the streamed TTS format.** The classic failure
mode for progressive audio. Mitigation: the buffered path is kept per-utterance
as a first-class fallback (gate-exercised, seamless); if streaming proves
unshippable this sprint, the server pass-through still lands (removes the server
buffering leg) and the client fallback becomes the temporary default — recorded,
not silently absorbed.

**The mic fix chases the wrong stage.** Five seconds could live anywhere in the
startup chain. Mitigation: instrument-first is the task's structure — the fix
list is ordered by measured attribution, and the budget (≤500ms) is the gate, so
the task cannot "finish" by applying techniques that didn't move the number.

**The wrong-voice defect doesn't reproduce.** Mitigation: the pin + boot
assertion land regardless (they close the likeliest cause class and make any
recurrence loud); the ADR-031 amendment box records "not reproduced, pinned
defensively" honestly if that is the outcome.

**Two workstreams crowd one sprint.** Curriculum transcription is big but
mechanical; TTS streaming is small but sharp. Mitigation: they share no files —
if the sprint overruns, the natural split is curriculum (Tasks 1–4) landing
alone and voice (5–7) rolling to a short follow-on, flagged, not assumed.

## What the next sprint needs to know

**Calyxa now covers the launch curriculum and voice feels immediate.** The graph
is ≈70 concepts across six strands with aliases/titles/priors in-concept (single
source, drift structurally closed); the prompt scopes keys to a bounded relevant
subset; the mic starts inside 500ms; TTS streams to first audio ~p50 ≤2.5s with
a buffered fallback; the voice is pinned and env drift fails loud.

- **Sprint 16 (cost control + compliance)** inherits: the measured per-turn
  voice numbers for its cost model; ADR-027's still-open FREE_SESSION_LIMIT
  retune (problem-sized sessions); the cron/export/erasure/URL-salt scope from
  the roadmap; audio + page context still ephemeral, `session_interactions`
  still text-only.
- **Sprint 17 (onboarding + instrumentation)** inherits: difficulty priors +
  prereq edges as the cold-start item-bank input (§2.4); the dev-only timing
  marks as the seed for real latency telemetry; the strand structure for any
  "pick your course" onboarding surface.
- **The streaming-envelope sprint (if pursued)** now has both halves of its
  pattern proven separately: chunked port relay (TTS here, AI_STREAM before) —
  reconciling the envelope with SSE remains the only new work.
- **The concept inventory lives in ADR-030's appendix + the strand modules** —
  curriculum growth is a data edit + alias entry, enforced by tests; no parallel
  tables remain to maintain.
