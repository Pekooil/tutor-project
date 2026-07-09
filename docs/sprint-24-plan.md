# Sprint 24 — Tutor model migration: Anthropic Haiku 4.5 → OpenAI GPT-4o-mini  (CANDIDATE)

> **CANDIDATE / GATED SPRINT — do not start without sign-off.** This sprint is
> written so the option is costed and ready, **not** to greenlight it. It is
> **gated by ADR-038** and must NOT run until:
> 1. **Sprint 19 (prompt caching, ADR-037) has shipped and been measured**, and
> 2. caching + Sprint 16's cost guardrail **still miss the beta budget target**, and
> 3. Darcy has **explicitly reopened** the locked "Anthropic only" stack decision.
>
> If caching + the guardrail hit the budget, this sprint stays unspent. See
> `docs/sprint-19-plan.md` for the recommended-first, lower-risk lever. Sprint
> number is a placeholder — reslot to fit the roadmap (it deliberately sits after
> billing, Sprint 23, because it is a contingency, not a plan of record).

## Goal
Move the **tutor turn** from Anthropic Haiku 4.5 to OpenAI GPT-4o-mini **behind a
provider abstraction**, without regressing the structured-output envelope that
the whole product depends on. "Cheaper" is only acceptable if it is **not worse
for students.** By the end:

1. **A `TutorProvider` seam** wraps the model call so Anthropic and OpenAI are
   swappable per-env in one flag. `@anthropic-ai/sdk` is NOT ripped out — both
   providers implement the same interface; the migration is reversible.
2. **Both forced tools** (`submit_tutor_turn`, `submit_session_start_turn`) are
   ported to OpenAI function-calling with `strict: true`, including the
   nullable-enum shape difference (Anthropic's `anyOf` trick vs OpenAI's
   `type:["string","null"]` — they want **opposite** forms).
3. **Streaming works on both paths** — the `sayDelta` extraction that feeds
   per-sentence TTS is wired to OpenAI's tool-arg deltas; the plain-text stream
   maps cleanly.
4. **A compliance gate passes before any traffic switches:** on a fixed
   regression eval set, GPT-4o-mini's envelope/annotation/assessment compliance
   and turn latency are **≥ the Haiku baseline.** Failing the gate = stay on
   Anthropic; the sprint's deliverable is then "measured, not adopted."

```
tutor call site ──▶ TutorProvider (interface: runTurn / streamTurn)
                      ├─ AnthropicTutorProvider (today: messages.create/.stream, ENVELOPE_TOOL)
                      └─ OpenAITutorProvider     (new: chat.completions, function tool, JSON-string args)
   env flag TUTOR_PROVIDER selects; default stays 'anthropic' until the gate passes
```

## Context
Per-token, GPT-4o-mini is ~85% cheaper than Haiku 4.5 (`cost_analysis.py`:
~$0.108 → ~$0.016 per session on identical token volume). But (a) Sprint 19's
caching already removes ~60% of session cost on Haiku, so the *marginal*
migration saving is much smaller than 85%; (b) Sprint 16's guardrail already caps
aggregate spend; and (c) GPT-4o-mini is materially weaker at the strict
structured output Calyxa leans on. This sprint therefore treats the migration as
a **reversible, gated capability swap with a hard compliance bar**, not a
one-way cost cut. The porting surface below is exactly the `MIGRATION REPORT`
from `cost_analysis.py`, hardened into tasks.

### Decisions locked for this sprint (ADR-038)
1. **Provider abstraction, not a rip-out.** Ship a `TutorProvider` interface;
   keep Anthropic as a first-class implementation and the default until the gate
   passes. Reversible in one env flag.
2. **Compliance gate before traffic.** A fixed eval set is the go/no-go. No
   percentage of live traffic moves to OpenAI until GPT-4o-mini meets or beats
   Haiku on envelope compliance and latency.
3. **Tutor turn only.** Whisper STT and ElevenLabs TTS are untouched (already
   non-Anthropic). This ADR supersedes ADR-008 only for the tutor model call.
4. **Both keys stay server-only.** `OPENAI_API_KEY` joins `ANTHROPIC_API_KEY`
   behind the proxy; the bundle-grep gate covers both.

### Reconciliation with ADR-008 / the locked stack (read before Task 1)
ADR-008 forecloses non-Anthropic AI calls and the stack is locked "Anthropic
only." **This sprint may not begin until ADR-038 is signed off**, at which point
Task 1 updates ADR-008 (supersede, tutor-turn-only) and the CLAUDE.md stack lines
to name the provider abstraction. Until then, this file is a costed contingency.

## Execution model
A **single code session**, in order (1 → 7), and **only after the gate
conditions hold**. The abstraction (Task 2) precedes the OpenAI implementation
(Tasks 3-5); the eval harness (Task 6) is the go/no-go before any default flip
(Task 7). No handoff.

## Files in scope (only if greenlit)

### Task 1 — ADR sign-off + stack pointer updates
```
/docs/adr/ADR-038-reopen-anthropic-only-ai-stack.md ← mark Decided (dated), record sign-off
/docs/adr/ADR-008-claude-proxy.md ← edit — add a "Superseded in part by ADR-038 (tutor turn may run on a provider abstraction)" note
/CLAUDE.md, /docs/CLAUDE.md        ← edit — stack line: "AI: tutor turn behind a TutorProvider abstraction (Anthropic Haiku 4.5 default; OpenAI GPT-4o-mini optional), server-side proxy only"
/docs/architecture.md, /docs/sprint-24-plan.md
```

### Task 2 — The provider abstraction
```
/web/lib/ai/provider.ts        ← new — TutorProvider interface: runTurn(kind, system, tools, messages) → TurnEnvelope; streamTurn(...) → AsyncGenerator<EnvelopeStreamEvent>. Env flag TUTOR_PROVIDER (default 'anthropic').
/web/lib/ai/provider-anthropic.ts ← new — extract today's runTutorTurn/*Stream/runSessionStartTool bodies from claude.ts behind the interface (behavior-identical; a pure move).
/web/lib/ai/claude.ts          ← edit — becomes AnthropicTutorProvider's home or re-exports; ENVELOPE_TOOL/SESSION_START_TOOL stay the Anthropic schema source of truth.
```

### Task 3 — OpenAI provider + tool porting (the hard part)
```
/web/lib/ai/provider-openai.ts ← new — OpenAITutorProvider using the openai SDK.
  - System prompt: Anthropic top-level `system` → a {role:'system'} message.
  - Forced tools: Anthropic tools+tool_choice+strict → OpenAI
    tools:[{type:'function',function:{name,description,parameters:<schema>,strict:true}}]
    + tool_choice:{type:'function',function:{name}}.
  - NULLABLE-ENUM GOTCHA: claude.ts uses anyOf:[{enum},{null}] (Anthropic strict
    REJECTS type:['string','null']+enum; claude.ts:61-69). OpenAI strict wants the
    OPPOSITE: type:['string','null']. Build the schema per-provider — do NOT share
    the exact object.
  - input_examples has no OpenAI tool equivalent → fold into description or a
    few-shot assistant message.
  - Response parse: OpenAI returns function args as a JSON STRING →
    JSON.parse then feed the existing parseEnvelopeObject (Anthropic gives a
    parsed object). parseEnvelope/parseEnvelopeObject stay provider-neutral.
/package.json                  ← edit — add the openai SDK (keep @anthropic-ai/sdk).
env config                     ← add OPENAI_API_KEY (server-only; bundle-grep gate extended).
```

### Task 4 — Streaming on the OpenAI path
```
/web/lib/ai/provider-openai.ts ← edit — streamTurn: OpenAI streams tool args as
  choices[].delta.tool_calls[].function.arguments fragments. Reuse createSayExtractor
  (it already works on raw JSON fragments — `say` must stay the FIRST schema property so
  it streams first) but rewrite the event plumbing that feeds it. No finalMessage()
  helper — accumulate deltas or use the OpenAI streaming helper. Plain-text stream maps 1:1.
```

### Task 5 — Wire the call sites through the abstraction
```
/web/app/api/ai/turn/route.ts, /web/app/api/ai/turn/stream/route.ts,
/web/app/api/ai/stream/route.ts ← edit — call TutorProvider.runTurn/streamTurn
  instead of importing runTutorTurn* directly. The opening-scan call (route.ts) also
  routes through the provider (it currently calls Anthropic directly with no tools —
  the OpenAI provider must replicate the tools-less opening-scan shape).
```

### Task 6 — Compliance + cost eval harness (the GATE)
```
/web/tests/tutor-eval/            ← new — a fixed set of recorded turn inputs
  (system+profile+page+history) with expected envelope properties. Runs BOTH providers,
  scores: assessment-present rate, annotation-when-referenced rate, chips/signals shape,
  session-close discipline, latency p50/p95. Emits a comparison table.
/web/tests/provider-parity.test.ts ← new — the OpenAI provider returns a
  parseEnvelopeObject-valid TurnEnvelope for every eval input; nullable fields and the
  66-key concept_key set validate.
```

### Task 7 — Default flip (only if the gate passes)
```
env / deploy config ← set TUTOR_PROVIDER=openai in a canary env first; ramp only
  after the eval table shows GPT-4o-mini ≥ Haiku baseline on compliance AND latency.
/web/lib/tier/cost-model.ts ← edit — CLAUDE_TURN_CENTS → provider-aware estimate for
  the Sprint 16 guardrail (OpenAI turn is cheaper; keep the cap budget-accurate).
```

### Explicitly out of scope
```
Whisper STT / ElevenLabs TTS (already non-Anthropic; untouched)
The envelope SEMANTICS (parseEnvelope stays provider-neutral)
Removing @anthropic-ai/sdk (kept — the abstraction stays reversible)
Any traffic switch before the Task 6 gate passes
```

## Task acceptance gates
- **Task 2:** with TUTOR_PROVIDER=anthropic, behavior is byte-identical to
  pre-sprint (a pure extraction); the existing suite is green.
- **Task 3:** OpenAITutorProvider returns a valid TurnEnvelope for a canned input;
  the nullable-enum schema validates under OpenAI strict mode.
- **Task 4:** a streamed OpenAI turn yields sayDelta events then one terminal
  envelope, same contract as the Anthropic stream.
- **Task 6 (GO/NO-GO):** the eval table is produced; **GPT-4o-mini meets or beats
  the Haiku baseline on every compliance metric and on latency**, or the sprint
  ends "measured, not adopted" and the default stays Anthropic.
- **Task 7:** canary env on OpenAI is stable; guardrail estimate updated.

## Acceptance criteria (full checklist)
- [ ] ADR-038 signed off & dated; ADR-008 + CLAUDE.md stack lines updated to the abstraction
- [ ] TutorProvider seam ships; Anthropic path behavior-identical; default stays 'anthropic'
- [ ] Both forced tools ported to OpenAI strict function-calling incl. the nullable-enum flip
- [ ] OpenAI streaming yields sayDelta + terminal envelope; createSayExtractor reused
- [ ] All call sites (incl. opening scan) route through the abstraction
- [ ] Eval harness produces a Haiku-vs-4o-mini compliance+latency table
- [ ] **GO/NO-GO gate honored:** traffic switches ONLY if 4o-mini ≥ Haiku baseline
- [ ] Sprint 16 `CLAUDE_TURN_CENTS` made provider-aware
- [ ] `turbo run typecheck lint build test` green; both providers keys server-only (bundle-grep)

## Cost lever comparison (why this is second, not first)
| Lever | Est. session cost | Behavioral risk | Effort | Reopens locked stack |
|---|---|---|---|---|
| Sprint 19 (caching, Haiku) | ~$0.04 (~60% off) | very low | ~1 day | no |
| **This sprint (GPT-4o-mini)** | **~$0.016 (~85% off)** | **high** | **~4-5 days** | **yes (ADR-038)** |

The incremental saving of this sprint *over* caching is ~$0.02/session, bought
with a locked-decision reopening, a weaker model on the product's core structured
output, and 4-5 engineer-days. That trade is only worth it if caching + the
Sprint 16 guardrail demonstrably miss the budget — hence the gate.

## Risks
**GPT-4o-mini regresses envelope compliance** (missing assessment, dropped
annotations, malformed chips) — the exact Sprint 14 Task 10 failure family, on a
weaker model. Mitigation: the Task 6 eval gate is go/no-go; strict function-calling
is enforced; the abstraction reverts in one flag.

**The nullable-enum schema flip is wrong** and OpenAI strict mode rejects the
tools. Mitigation: build the schema per-provider (opposite shapes), test under
strict mode in Task 3 before wiring call sites.

**Streaming plumbing differs and breaks per-sentence TTS latency.** Mitigation:
`say` stays the first schema property; createSayExtractor is reused; latency is a
gate metric in Task 6.

**A one-way migration strands us if 4o-mini underperforms in production.**
Mitigation: the provider abstraction + kept `@anthropic-ai/sdk` make the default
a flag; canary before ramp.

**Reopening the locked stack sets a precedent.** Mitigation: ADR-038 scopes the
reopening to the tutor turn only, behind an abstraction, gated on measurement —
not a general "any provider" license.

## What the next sprint needs to know
Either the tutor runs behind a reversible `TutorProvider` (default provider set
by the eval gate), or this sprint concluded "measured, not adopted" and the tutor
stays on Anthropic. Whichever: **any change to the envelope tool schema must be
made in BOTH providers' schema builders** (the nullable shapes differ), and the
Sprint 16 guardrail estimate is provider-aware. If adopted, the STT/TTS providers
are unchanged and ADR-008 stands except for the tutor-turn carve-out.
