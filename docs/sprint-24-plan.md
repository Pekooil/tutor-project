# Sprint 24 — Tutor quality & cost: eval harness, model tiering, answer verification

> **This sprint replaces the shelved "Haiku 4.5 → GPT-4o-mini migration" candidate.**
> The provider migration is **not happening** — the locked decision is to stay on
> Anthropic (production provider = Anthropic; build on `main`; `web/eval/` is eval-only
> tooling). So **ADR-038 ("reopen the Anthropic-only stack") is marked _Declined_**, not
> invoked. What this sprint keeps from the old plan is the two pieces that were always
> the real value — the **eval harness** and the **provider/model seam** — and repurposes
> them to fix the four tutor problems beta surfaced: wrong answers, sparse annotations,
> latency, and cost.
>
> **No stack reopening is required.** PLAN.md §2.1/§2.5 always specified *"Anthropic
> Claude, **tiered**: Haiku 4.5 default, Sonnet / Opus escalation"* with server-side
> routing — but the shipped code is **Haiku-only** (there is no Sonnet/Opus anywhere).
> Adding a Haiku↔Sonnet tier is therefore *implementing the design that was locked from
> the start*, entirely within the Anthropic stack — ADR-008 stands.
>
> **Sequencing (Darcy's call, 2026-07-10):** run this **right after beta launch
> (Sprint 19), before the dashboard (22) and billing (23)** — correctness and latency
> are the loudest beta complaints and the dashboard/billing build on the mastery signal
> this sprint stops corrupting.
>
> **Provisional ADR numbers** (latest on disk = ADR-043; parallel tracks 18/19/22/23/25
> claim intervening numbers — confirm next-free at execution and fix references in one
> pass).

## Goal
Fix the tutor itself. Beta (Sprint 19) ships a tutor that is **fast enough** (Sprint 19
Task 8 cheap wins) and **instrumented** (Sprint 18 Task 8 telemetry), but three deep
problems remain, all rooted in the same fact: **every turn is a single Haiku 4.5 call
with no verification** — the student's grade is whatever that one small-model call says,
trusted verbatim and fed straight into the FSRS mastery update. This sprint makes tutor
quality **measurable**, then moves it. By the end:

1. **An eval harness is the measurement backbone.** A fixed set of recorded turn inputs
   with a **labelled correctness key** scores what beta can't tell you precisely:
   assessment accuracy **in both directions** (accepting a wrong answer AND rejecting a
   right one), annotation-when-referenced rate, profile-adaptation rate, and latency
   p50/p95. The current Haiku-only build is baselined; every later task is judged
   against it.
2. **Model tiering exists (Haiku default, Sonnet on grading-critical turns).** The turn
   routes to **Haiku 4.5** for conversational scaffolding and escalates to **Sonnet**
   for the turns where a wrong grade does real damage — answer evaluation, misconception
   detection, ambiguous diagnosis. Selective by design, so cost stays bounded. This is
   the tiering PLAN.md always specified, finally built.
3. **A verification backstop protects the learning model.** For numerically or
   symbolically checkable answers, a deterministic check gates `assessment.outcome`
   before it reaches `turn-complete`/`apply`/FSRS — a wrong `outcome: "correct"` from
   the model can no longer silently corrupt mastery. Un-checkable answers fall back to
   the (now Sonnet-graded) model judgment.
4. **Cost is revised, tier-aware, and bounded.** `CLAUDE_TURN_CENTS` becomes tier-aware
   and is revised down for caching (still a flat `1` despite ADR-037 shipping); the
   Sonnet escalation rate is capped so the quality gain doesn't blow the Sprint 16
   guardrail; net cost is measured against the eval + the real cost dashboards.

```
tutor call site ──▶ selectModel(turnKind, signals)
                      ├─ Haiku 4.5   (default: scaffolding, hints, conversation)
                      └─ Sonnet      (escalate: grade a claimed answer, diagnose a
                                      misconception, resolve an ambiguous attempt)
   graded outcome ──▶ verifyAnswer(problem, claimedOutcome)  ──▶ gated outcome ──▶ FSRS
   eval harness scores every change vs the Haiku-only baseline (go/no-go)
```

## Context
The recon behind this sprint (2026-07-10): the tutor turn is a **single**
`messages.create` on `claude-haiku-4-5-20251001` (`web/lib/ai/claude.ts`), **no Sonnet
or Opus anywhere**, **no self-verification / answer-check of any kind**. The
`assessment` object (outcome / reasoning_quality / misconception_category) is
self-reported by that one call, forced via `ENVELOPE_TOOL`, and flows unverified into
`session_interactions` → `applyInteraction` → `updateKnowledgeNode` (FSRS). So:

- **Correctness (#2):** grade quality == one Haiku call's quality, with no backstop. A
  wrong "correct" or a wrong "incorrect" is trusted and persisted.
- **Student modelling (#5):** the FSRS write path is sound but **garbage-in** — noisy
  grades corrupt the profile. Fixing the grade is most of the fix here; the profile
  *injection* (12 nodes / 8 misconceptions / 3 prior sessions, deterministic keyword
  topic-bias) is bounded but adequate — the eval will say whether the model *uses* what
  it's given (profile-adaptation metric) or whether salience needs work.
- **Annotations (#3):** purely prompt-driven; the small model under-annotates despite
  heavy prompting, and the client silently **drops** unresolvable targets. Sprint 18
  Task 8 now emits the **rendered-vs-dropped counter**, so this sprint knows whether
  the problem is *emission* (model — fixed by Sonnet on referencing turns + prompt) or
  *resolution* (targeting — fixed in `annotations.ts`). Evidence, not a guess.
- **Cost (#4):** caching shipped (ADR-037) but `CLAUDE_TURN_CENTS` was never revised;
  tiering adds Sonnet cost that must be bounded and re-estimated.

### Decisions locked for this sprint (recorded in ADR-052, provisional #)
1. **Stay on Anthropic; add a Sonnet tier, don't switch providers.** ADR-038 is
   Declined. Tiering Haiku↔Sonnet is within the locked stack (PLAN §2.1/§2.5) and needs
   no stack reopening. GPT-4o-mini stays unbuilt.
2. **Measure before moving.** The eval harness (Task 2) is built first and baselines the
   current build; no tiering/verification is *adopted* (Task 7) unless the eval shows
   correctness ↑ / annotation ↑ / profile-adaptation ↑ **without** regressing latency or
   blowing the cost budget.
3. **Escalate selectively, not globally.** Sonnet is for grading-critical turns only;
   the escalation decision is server-side, signal-driven (turn kind + whether the
   student is claiming an answer), and rate-capped. The bulk of turns stay Haiku.
4. **Verification gates the learning-model write, not the spoken reply.** The
   deterministic answer-check corrects `assessment.outcome` before FSRS; it never
   rewrites what the tutor *says* (the tutor stays Socratic and warm). Un-checkable →
   fall back to the model grade (fail-open to Sonnet's judgment).
5. **The FSRS algorithm itself is not touched.** This sprint fixes the *input* to the
   model (grade quality), not the model math (`packages/learning-model` stays as-is).

### Reconciliation with the locked stack + PLAN (read before Task 1)
- **PLAN §2.1** — "AI backbone — Anthropic Claude, tiered … Haiku 4.5 for the majority
  of turns, escalating to Sonnet … for multi-step proof reasoning or ambiguous problem
  diagnosis. Routing is server-side." This sprint builds exactly that.
- **PLAN §2.5** — the system-prompt/pedagogy and the `assessment` envelope already model
  a graded outcome; this sprint improves *how trustworthy* that grade is (bigger model
  on hard grades + a deterministic check), not the envelope shape.
- **ADR-008 (Claude proxy)** stands unchanged — still Anthropic, still server-side.
  **ADR-038** is marked Declined in Task 1.
- **ADR-037 (prompt caching)** — the cache prefix is per-model; tiering must keep a
  cached stable prefix for *each* tier (Sonnet gets its own cached prefix), or the cache
  win is lost on escalated turns. Called out in Task 3.

### The eval harness seeds from real beta turns (read before Task 2)
The old plan's `web/tests/tutor-eval/` sketch scored envelope compliance on canned
inputs. This sprint's harness needs a **labelled correctness key** — for each recorded
turn, the *true* outcome of the student's answer — which canned inputs can't fabricate
credibly. Seed it from **real beta recorded turns**: Sprint 18's `turn_latency` /
`annotation_rendered` telemetry + the `session_interactions` transcripts identify real
turns; a human labels the true outcome for a few dozen (including deliberate
"student-is-wrong-but-confident" and "student-is-right-but-hesitant" cases, the two the
single-call grader most likely gets wrong). No audio, no PII — text transcript only
(ADR-011). This is the one place the sprint depends on beta having run.

### Model tiering keeps caching intact (read before Task 3)
`selectModel` returns a model id; the call path already splits the system prompt into a
cached stable prefix + volatile tail (ADR-037, `buildSystemPromptBlocks`). Each tier
must carry its **own** cached prefix (a Sonnet call can't reuse Haiku's cache entry).
The seam is `web/lib/ai/model-tier.ts` + a small change in `claude.ts` to thread the
selected model through `messages.create/.stream`; `ENVELOPE_TOOL`/`SESSION_START_TOOL`
schemas are model-neutral (both are Anthropic). One env flag (`TUTOR_TIERING`, default
off until Task 7 adopts) disables tiering back to Haiku-only.

## Execution model
A **single code session**, worked **strictly in order (1 → 7)**, and only after beta
(Sprint 19) has run long enough to seed the eval set. The eval harness (Task 2) is the
instrument every later task is judged by; the tier seam (Task 3) and the verification
backstop (Task 4) are the two quality levers; the annotation fix (Task 5) is
evidence-driven off the Sprint 18 drop-counter; the cost revision (Task 6) keeps the
guardrail honest; the rollout gate (Task 7) adopts only what the eval justifies. One
session — no handoff.

This sprint touches: a new `web/tests/tutor-eval/`, a new `web/lib/ai/model-tier.ts`, a
new `web/lib/ai/verify-answer.ts`, edits to `web/lib/ai/claude.ts` (thread the model) +
`web/lib/ai/turn-complete.ts` (gate the outcome) + the AI route call sites +
`web/lib/tier/cost-model.ts` (tier-aware estimate), and possibly
`extension/src/content/annotations.ts` (only if the drop-counter says resolution, not
emission). It does **not** touch STT/TTS, the envelope semantics, the FSRS math, or any
provider other than Anthropic.

## Files in scope

### Task 1 — ADR + stack pointers (planning / docs)
```
/docs/adr/ADR-052-tutor-quality-tiering-and-verification.md ← new (provisional #) — stay Anthropic; add a Haiku↔Sonnet tier (implements PLAN §2.1/§2.5, no stack reopen); eval harness as the go/no-go instrument; deterministic answer-verification gates the FSRS write not the reply; selective + rate-capped escalation; cost re-estimated.
/docs/adr/ADR-038-reopen-anthropic-only-ai-stack.md ← edit — mark **Declined** (dated): the provider migration is not adopted; the tutor stays on Anthropic; the eval/seam value is carried forward by ADR-052 within the Anthropic stack.
/CLAUDE.md, /docs/CLAUDE.md ← edit — stack line: "AI: Anthropic Claude, tiered (Haiku 4.5 default; Sonnet escalation on grading-critical turns), server-side proxy only" (matches PLAN §2.1).
/docs/architecture.md, /docs/sprint-24-plan.md ← edit — the tier seam, the verification backstop, the eval harness as the standing quality gate.
```

### Task 2 — Eval harness (the measurement backbone, built first)
```
/web/tests/tutor-eval/fixtures/*.json ← new — recorded turn inputs (system+profile+page+history) seeded from real beta turns, EACH with a labelled true outcome; include the two hard families: student-wrong-but-confident, student-right-but-hesitant.
/web/tests/tutor-eval/score.ts        ← new — run a turn through the tutor, score: assessment accuracy (both directions — false-accept & false-reject rates), annotation-when-referenced rate, profile-adaptation rate (did the reply calibrate to the injected mastery/misconceptions), latency p50/p95. Emits a comparison table across model/config.
/web/tests/tutor-eval/baseline.test.ts ← new — runs the current Haiku-only build and records the baseline the sprint must beat.
```

### Task 3 — Model-tier seam (Haiku default, Sonnet on grading-critical turns)
```
/web/lib/ai/model-tier.ts ← new — selectModel(turnKind, signals) → 'claude-haiku-4-5-20251001' | 'claude-sonnet-<pinned>'; escalate when the turn is grading-critical (student is claiming an answer / a misconception is in play / diagnosis is ambiguous). Pure + unit-testable. Env flag TUTOR_TIERING (default off until Task 7).
/web/lib/ai/claude.ts ← edit — thread the selected model into messages.create/.stream; keep a PER-TIER cached stable prefix (ADR-037 — a Sonnet call needs its own cache entry). ENVELOPE_TOOL/SESSION_START_TOOL unchanged (model-neutral).
/web/app/api/ai/turn/route.ts, /web/app/api/ai/turn/stream/route.ts ← edit — pass the turn signals to selectModel; opening-scan stays Haiku.
```

### Task 4 — Answer-verification backstop (protects the FSRS write)
```
/web/lib/ai/verify-answer.ts ← new — for a checkable answer (numeric / simple-symbolic, derived from page context + the student's claimed result), a deterministic check returning agree | disagree | uncheckable. Lightweight (no heavy CAS dependency unless justified); uncheckable is the common, safe default.
/web/lib/ai/turn-complete.ts ← edit — BEFORE persisting to session_interactions / scheduling applyInteraction, reconcile assessment.outcome with verify-answer: a model "correct" that the checker DISAGREES with is downgraded (and flagged via the Sprint 18 telemetry); uncheckable → keep the (Sonnet-graded) model outcome. Never rewrites the spoken reply.
```

### Task 5 — Annotation frequency (evidence-driven off the Sprint 18 drop-counter)
```
(read the Sprint 18 `annotation_rendered` rendered/dropped/requested telemetry FIRST)
IF emission (model requests too few): the Sonnet tier already covers referencing turns; reinforce the ANNOTATION GUIDANCE prompt only if the eval's annotation-when-referenced rate is still low. (prompt edit in system-prompt.ts, measured by Task 2)
IF resolution (model requests them but targets drop): /extension/src/content/annotations.ts ← edit — improve target resolution (loosen MIN_SUBSTRING_MATCH_CHARS heuristics, add a fallback resolver) so fewer valid annotations are silently dropped. Still DROP-NEVER-GUESS; still ≤ MAX_ANNOTATIONS_PER_TURN.
```

### Task 6 — Cost revision + escalation budget
```
/web/lib/tier/cost-model.ts ← edit — CLAUDE_TURN_CENTS becomes tier-aware (Haiku vs Sonnet per-turn estimate) and is revised for caching (ADR-037 said to lower it; still 1). Add the Sonnet escalation cost to the Sprint 16 guardrail's model so the cap stays budget-accurate.
/web/lib/ai/model-tier.ts ← edit — a rate cap / budget guard on escalation (e.g. escalate at most X% of turns, or fall back to Haiku when near the cost cap) so quality doesn't blow the guardrail.
```

### Task 7 — Rollout gate (adopt only what the eval justifies)
```
env / deploy config ← set TUTOR_TIERING=on in a canary env first; ramp only after the eval table shows correctness ↑ (false-accept & false-reject both down), annotation ↑, profile-adaptation ↑, latency within budget, and cost within the guardrail. If the gate fails, tiering/verification stay flagged-off ("measured, not adopted") and the tutor stays Haiku-only — a one-flag revert.
```

### Explicitly out of scope
```
Switching providers (GPT-4o-mini / any non-Anthropic)  — Declined; stay Anthropic
Whisper STT / ElevenLabs TTS                            — untouched (already non-Anthropic; separate latency legs)
The envelope tool SCHEMA / parse semantics              — model-neutral, unchanged
The FSRS algorithm (packages/learning-model)            — fix its INPUT quality, not the math
Profile-injection restructuring                         — only if Task 2's profile-adaptation metric proves it's the bottleneck; otherwise deferred
The cheap latency wins (mic warm, stream, history)      — already shipped in Sprint 19 Task 8
```

Do not create any file not listed above. If something seems needed but is not listed,
add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — ADR + stack pointers
Write ADR-052; mark ADR-038 Declined; update the CLAUDE.md stack lines to the tiered
Anthropic description (matches PLAN §2.1). No code.

Acceptance gate before Task 2:
  - ADR-052 reads as a decision; ADR-038 is Declined with a date + reason; the stack
    lines say "Anthropic Claude, tiered (Haiku default; Sonnet escalation)"; the
    "no stack reopen" argument (PLAN §2.1/§2.5) is explicit.

## Task 2 — Eval harness (built first, baselines the current build)
Scope: `web/tests/tutor-eval/` seeded from real beta turns with labelled true outcomes;
the scorer; the Haiku-only baseline. This is the go/no-go instrument for Tasks 3–7.

Acceptance gate before Task 3:
  - The harness runs a turn end-to-end and emits the metric table; the Haiku-only
    baseline is recorded, including the false-accept / false-reject rates on the two
    hard families; the fixtures carry no PII/audio.

## Task 3 — Model-tier seam
Scope: `model-tier.ts` + threading the model through `claude.ts` with a per-tier cached
prefix; wire the turn routes. Flagged off by default.

Acceptance gate before Task 4:
  - With `TUTOR_TIERING=on`, grading-critical turns run Sonnet and the rest run Haiku;
    caching still hits per tier; the eval shows the tiered config's correctness vs the
    baseline; flag-off returns byte-identical Haiku-only behavior.

## Task 4 — Answer-verification backstop
Scope: `verify-answer.ts` + the `turn-complete.ts` gate. Corrects the FSRS-bound
outcome, never the reply; uncheckable falls back to the model grade.

Acceptance gate before Task 5:
  - A recorded turn where the model says "correct" but the answer is wrong is downgraded
    before FSRS and flagged in telemetry; an uncheckable answer keeps the model grade;
    the spoken reply is unchanged in every case.

## Task 5 — Annotation frequency (evidence-driven)
Scope: read the Sprint 18 drop-counter first; fix emission (prompt/Sonnet) OR resolution
(`annotations.ts`) per what the data shows. Measured by the Task 2 annotation metric.

Acceptance gate before Task 6:
  - The annotation-when-referenced rate improves against the baseline; whichever cause
    the drop-counter identified is the one addressed (documented); still ≤3/turn,
    still DROP-NEVER-GUESS.

## Task 6 — Cost revision + escalation budget
Scope: tier-aware `CLAUDE_TURN_CENTS` revised for caching; an escalation rate/budget cap
so Sonnet turns don't blow the Sprint 16 guardrail.

Acceptance gate before Task 7:
  - The per-turn estimate reflects the actual tier + caching; the escalation cap holds
    aggregate cost within the guardrail in a simulated worst case; the cost dashboards
    reconcile with the estimate.

## Task 7 — Rollout gate (adopt only what the eval justifies)
Scope: canary `TUTOR_TIERING=on`, ramp only if the eval table clears every bar; else
"measured, not adopted" and revert via the flag.

Acceptance gate (sprint close):
  - The eval table shows correctness ↑ (both false-accept and false-reject down),
    annotation ↑, profile-adaptation ↑, latency within budget, cost within the
    guardrail — OR the sprint ends measured-not-adopted with the tutor on Haiku-only and
    the harness + seam parked for a later attempt. `turbo run typecheck lint build test`
    green; Anthropic-only; both no-secret gates pass.

## Acceptance criteria (full checklist)
- [ ] ADR-052 written; ADR-038 marked Declined; stack lines updated to tiered Anthropic (PLAN §2.1)
- [ ] Eval harness runs, seeded from real beta turns with labelled outcomes; Haiku-only baseline recorded (incl. false-accept/false-reject on the two hard families)
- [ ] Model-tier seam ships (Haiku default, Sonnet on grading-critical); per-tier caching intact; one flag disables it
- [ ] Answer-verification backstop gates the FSRS-bound outcome (never the reply); uncheckable falls back to the model grade; mismatches flagged in telemetry
- [ ] Annotation frequency improved per the Sprint 18 emission-vs-resolution diagnostic; still ≤3/turn, DROP-NEVER-GUESS
- [ ] `CLAUDE_TURN_CENTS` tier-aware + revised for caching; Sonnet escalation rate-capped within the Sprint 16 guardrail
- [ ] GO/NO-GO honored: tiering/verification adopted ONLY if the eval clears correctness + annotation + profile-adaptation + latency + cost; else measured-not-adopted
- [ ] `turbo run typecheck lint build test` green; Anthropic-only; no-secret bundle gate passes

## Quality-lever comparison (what moves which problem)
| Lever | Fixes | Cost impact | Behavioral risk | Reversible |
|---|---|---|---|---|
| Eval harness | measurement for all of #2/#3/#5 | ~0 (offline) | none | n/a |
| Sonnet tier on grading turns | #2 correctness, #3 annotations, #5 modelling (cleaner grades) | + (bounded by selective + capped escalation) | low (same Anthropic envelope) | one flag |
| Answer verification | #2 correctness, #5 (protects FSRS) | ~0 (deterministic) | low (fail-open on uncheckable) | one flag |
| Cost revision + escalation cap | #4 cost | − (keeps the guardrail honest) | none | config |

The old sprint's premise (GPT-4o-mini ~85% cheaper) is retired: it saved ~$0.02/session
over caching while *weakening* the core structured output — the opposite of what beta
needs. Staying on Anthropic and *adding* a Sonnet tier spends a little more on the few
turns that matter, bounded by the escalation cap, to fix the problem GPT-4o-mini would
have made worse.

## Risks
**Sonnet escalation inflates cost/latency past the budget.** Mitigation: escalation is
selective (grading-critical turns only), rate-capped (Task 6), and eval-gated on latency
p50/p95; near the cost cap it falls back to Haiku; the whole tier is one flag.

**The verifier false-negatives and blocks a correct answer** (marks a right answer
wrong). Mitigation: it only gates *checkable* answers with high confidence; anything
ambiguous is `uncheckable` → fall back to the model grade (fail-open, never fail-closed
against the student); the eval's false-reject rate is a go/no-go metric.

**The eval set is small or unrepresentative**, so the gate passes on a build that's
worse in the wild. Mitigation: seed from *real* beta turns (not synthetic), weight the
two hard families the single-call grader most often misses, and treat the harness as a
standing gate that grows with more labelled turns — not a one-shot.

**Caching breaks on the escalated tier** (Sonnet turns re-tokenize the whole prefix).
Mitigation: per-tier cached stable prefixes (Task 3); the cost estimate (Task 6)
accounts for tier cache-hit rates; `CALYXA_LOG_USAGE` confirms cache reads on both tiers.

**Scope creep into the FSRS math or profile injection.** Mitigation: this sprint fixes
the *input* (grade quality) only; profile-injection changes are gated behind the eval's
profile-adaptation metric proving it's the bottleneck — otherwise deferred, not guessed.

## What the next sprint needs to know
Either the tutor now runs **tiered** (Haiku default, Sonnet on grading-critical turns)
with a **verification backstop** protecting the mastery model, or the sprint concluded
"measured, not adopted" and the tutor stays Haiku-only with the harness + seam parked.
Whichever:

- **The eval harness is a standing quality gate** — any future change to the prompt,
  envelope, or model must be run through it and must not regress the baseline.
- **The mastery signal is now more trustworthy** (verified grades), so **Sprint 22's
  dashboard** and **Sprint 23's entitlements** build on a cleaner profile — the
  dashboard's decay-parity read reflects grades that a deterministic check has vetted.
- **Any envelope-schema change is still single-provider** (Anthropic only) — no
  per-provider schema duplication to maintain; ADR-038 stays Declined.
- **Cost is tier-aware**: the Sprint 16 guardrail estimate now depends on the escalation
  rate; a future prompt/model change that shifts escalation must update `cost-model.ts`.
