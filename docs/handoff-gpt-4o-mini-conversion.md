# HANDOFF — Convert production Calyxa tutor to GPT-4o-mini (behind the ADR-038 seam)

**Written 2026-07-17 by a prior Claude session. Self-contained: everything needed to implement is here.**
**Status (updated 2026-07-17 evening): Phases 0–1 DONE. Phase 0 gate passed (fixture fixed + 3 clean eval runs) and Darcy signed off ("OpenAI + ElevenLabs only"). Phase 1 landed on main per the landmine rules (per-file port, no cherry-pick, API_BASE excluded) — PLUS a default flip beyond this plan's scope, at Darcy's direction: ADR-052 makes OpenAI the code DEFAULT for tutor + study kits (TUTOR_PROVIDER/STUDY_KIT_PROVIDER=anthropic = the retained backup). Full gate green; changes UNCOMMITTED pending Darcy's commit permission. ⚠️ Deploying main now flips production to GPT (Phase 2 collapses into the next deploy). Branch backups: anthropic-haiku-backup + feat/tutor-gpt-4o-mini.**

## Context (read first)

- Calyxa's tutor runs on **Anthropic Claude Haiku 4.5** (`web/lib/ai/claude.ts`, `MODEL = 'claude-haiku-4-5-20251001'`). On **2026-07-10 Darcy decided to stay on Haiku** over GPT-4o-mini on quality + schema-reliability grounds (see memory `feedback-provider-haiku-main`). **This plan deliberately reverses that decision at Darcy's explicit request (2026-07-17)** — but it is gated on re-proving quality (Phase 0). If Phase 0 fails, stop and change nothing.
- A test branch **`feat/tutor-gpt-4o-mini`** was rebuilt on 2026-07-17: reset to `main@f9da84c` + that day's full uncommitted working state, with the ADR-038 **TutorProvider seam** re-ported onto the current forced-tool pipeline. Branch tip: **`a310df0`**. It lives in a **git worktree at `/Users/darcywang/tutor-project-gpt4o`** (dev server port **3100**, worktree extension `API_BASE` → `http://localhost:3100`, `web/.env.local` has `TUTOR_PROVIDER=openai` + `CALYXA_LOG_USAGE=1`). Branch runbook: `docs/RUNNING-GPT-4O-MINI.md` **on that branch**.
- **Verified working**: Darcy ran real sessions on GPT-4o-mini through the branch (24 logged `[gpt usage:…]` calls). Gotcha to remember: with `TUTOR_PROVIDER` unset the seam silently serves Haiku — always confirm via the usage-log labels (`[gpt usage:…]` = OpenAI, `[ADR-037 usage:…]` = Anthropic).
- **Measured cost basis** (real sessions, both providers): Haiku **$0.073/session** mean (p90 $0.105, cache hit 56%; logs: `haiku-baseline-usage.log` in the worktree). GPT-4o-mini **$0.011/session** (cache hit 64%; logs: `gpt-usage.log` in the worktree). ≈85% model-cost reduction. Voice (ElevenLabs TTS) is provider-neutral and dominates total session cost either way.
- Analysis tool: `python3 /Users/darcywang/tutor-project/cost_real.py <usage log>` (parses both label formats? verify — it was written for `[ADR-037 usage:…]`; the GPT pricing section prices Haiku-measured tokens at GPT rates).

## How the seam works (what you're landing)

- `web/lib/ai/provider.ts` — `TutorProvider` interface + `getTutorProvider()`. Env flag **`TUTOR_PROVIDER`** (`openai` | anything-else/unset = anthropic) read **per-call**, no restart needed. Anthropic impl is pure delegation to `claude.ts` (byte-identical default path).
- `web/lib/ai/tutor-openai.ts` — GPT-4o-mini mirrors of: regular `ENVELOPE_TOOL` turn, `SESSION_START_TOOL` kickoff (reuses claude.ts's exported anti-fabrication backstop — retry + zero-model-text fallback), `OPENING_SCAN_TOOL` scan (returns the same `OpeningScanResult` incl. `concept_key`/`topic_title` validation), streamed-envelope voice path (reuses `createSayExtractor` verbatim), plain text stream. Contains **load-bearing OpenAI-only prompt boosts**: annotation few-shot (rides `ENVELOPE_TOOL.input_examples`, auto-follows schema changes), session-close directive, opening-scan commitment nudge. GPT under-annotates and won't close sessions without them.
- `web/lib/ai/openai-schema.ts` — derives OpenAI-strict function tools from the Anthropic tools at runtime (nullable-enum flip + all-required). Single source of truth stays `claude.ts`; schema changes propagate automatically.
- `web/lib/ai/claude.ts` — **export-only diff** (6 symbols: `OPENING_SCAN_PLACEHOLDER_MESSAGE`, `FABRICATED_TURN_PATTERNS`, `MAX_OPENING_QUESTION_CHARS`, `isCleanOpeningQuestion`, `fallbackOpeningQuestion`, `assembleSessionStartEnvelope`). Zero behavior change.
- Routes `web/app/api/ai/turn/route.ts`, `turn/stream/route.ts`, `stream/route.ts` — call `getTutorProvider().runTurn/runOpeningScan/runTurnEnvelopeStream/runTurnStream` instead of importing claude.ts functions directly.
- `web/lib/tier/cost-model.ts` — `claude_turn` estimate branches on `TUTOR_PROVIDER` (`GPT_TURN_CENTS = 1`, same 1¢ floor for now).
- Tests: `web/lib/ai/openai-schema.test.ts` (key-free converter invariants), `web/tests/tutor-eval/` (fixtures + gated live eval), `web/test/stubs/server-only.ts` + a `server-only` alias added in `web/vitest.config.ts`.
- `web/.env.local.example` — documents `TUTOR_PROVIDER` + expanded `OPENAI_API_KEY` comment.
- **Deliberately NOT behind the seam**: study-kit generation (`web/lib/study/generate.ts`) stays on Anthropic regardless of flag. STT (OpenAI Whisper) / TTS (ElevenLabs) unchanged.
- **The extension needs NO changes.** Model choice is entirely server-side; the CWS zip and installed extensions are untouched.

## ⚠️ Critical landmine when landing on main

**Do NOT `git cherry-pick a310df0` or merge the branch.** That commit is `main@f9da84c` + Darcy's *uncommitted* 2026-07-17 working state (Sprint 23 billing, public-launch pass, 10-session cap, etc.) + the seam, all in one commit. Cherry-picking it wholesale would commit work Darcy has deliberately left uncommitted on main. Instead, copy **only the seam files** from the branch, e.g.:

```bash
cd /Users/darcywang/tutor-project
BR=feat/tutor-gpt-4o-mini
for f in web/lib/ai/provider.ts web/lib/ai/tutor-openai.ts web/lib/ai/openai-schema.ts \
         web/lib/ai/openai-schema.test.ts web/test/stubs/server-only.ts \
         web/tests/tutor-eval/fixtures.ts web/tests/tutor-eval/tutor-eval.test.ts; do
  mkdir -p "$(dirname "$f")" && git show "$BR:$f" > "$f"
done
# Then apply BY HAND (do not git-show-overwrite — these files differ on main's working tree):
#   - claude.ts: add `export ` to the 6 symbols listed above
#   - the 3 route files: swap direct claude.ts imports for getTutorProvider() (see branch diff)
#   - cost-model.ts: GPT_TURN_CENTS + the TUTOR_PROVIDER branch in estimateCost
#   - vitest.config.ts: add the 'server-only' alias line
#   - .env.local.example: TUTOR_PROVIDER block
# Reference diff for the hand edits:  git diff f9da84c a310df0 -- web/lib/ai/claude.ts web/app/api/ai web/lib/tier/cost-model.ts web/vitest.config.ts web/.env.local.example
```

Also **exclude** the branch's `extension/src/lib/api.ts` change (`API_BASE = http://localhost:3100`) — that is a worktree-only dev tweak. Main's value (`https://calyxa.app`) stays.

Note: main's working tree is heavily dirty by design (uncommitted launch work). Don't "clean it up," don't commit anything without Darcy's explicit commit-specific permission (standing rule, memory `feedback_git_commit_permission`), and beware a parallel session may hold port 3000 / the one-dev-server lock.

## The plan

### Phase 0 — Quality gate (BLOCKING; run before touching main)
1. Live eval (PAID, ~$1-2): `cd /Users/darcywang/tutor-project-gpt4o/web && EVAL_LIVE=1 npx vitest run tests/tutor-eval`. Prints Haiku-vs-GPT table. **Gate (ADR-038): GPT ≥ Haiku on EVERY compliance row (envelope valid, assessment, annotation grounded, chips, session-close, no-fabrication) AND latency.** Fixtures are synthetic — flagged in fixtures.ts; recorded real turns would strengthen the gate.
2. Darcy's subjective pass: 3–5 real sessions on the branch (extension from the worktree's `dist/chrome-mv3`, server on 3100) judging Socratic quality, annotation aptness, close behavior. **Darcy's sign-off is required** — this is the criterion that picked Haiku last time.
3. If either fails → STOP. Report results; main unchanged.

### Phase 1 — Land the seam on main (additive; default stays Haiku)
4. Copy seam files + hand-apply integration edits (see landmine section). `TUTOR_PROVIDER` stays unset ⇒ zero behavior change.
5. Write **ADR-052** (check next-free on disk first — 050/051 were Sprint 23; verify no parallel session took 052): tutor provider = GPT-4o-mini via the seam; record the eval table, the measured $0.011 vs $0.073/session, the 2026-07-10 reversal, Anthropic retained for study kits + fallback + eval baseline.
6. Update `CLAUDE.md` + `docs/CLAUDE.md` locked-stack AI line (Anthropic default + OpenAI opt-in via seam). Update memory `feedback-provider-haiku-main` (the standing "never swap to GPT" directive becomes obsolete once Darcy signs off).
7. Gate: `npx tsc --noEmit`, lint, build, key-free tests (`npx vitest run lib/ai/openai-schema.test.ts tests/tutor-eval` — 7 pass 1 skip expected). Ask Darcy for commit permission; commit; deploy to Vercel; verify prod still Haiku-normal.

### Phase 2 — Flip production
8. Verify `OPENAI_API_KEY` exists in Vercel prod env (it already powers Whisper STT there). Set **`TUTOR_PROVIDER=openai`** (Production), redeploy.
9. Verify live: one real session against calyxa.app; confirm behavior + (temporarily `CALYXA_LOG_USAGE=1`) `[gpt usage:…]` labels; watch `turn_latency` / `degraded_hit` telemetry for a day vs Haiku baseline.
10. **Rollback = unset `TUTOR_PROVIDER`** (env-only, instant, byte-identical Haiku path).

### Phase 3 — Follow-ups (separate decisions, NOT part of this handoff's scope)
- Port study-kit generation to GPT only if kit quality proves out (~$0.005/kit saving).
- Cost-model retune: 1¢ min floor overcharges GPT turns ~7×; consider sub-cent ledger granularity. Free-tier math shifts: worst-case all-voice month @10 sessions ≈ $1.60–2.00, ~80% of it ElevenLabs TTS — the next cost lever is voice, not the model.
- Keep `@anthropic-ai/sdk` + the whole Anthropic path indefinitely (fallback/eval/study-kit).
- Any future `ENVELOPE_TOOL` change: converter + few-shot auto-follow, but re-check the three OpenAI boosts still hold (re-run the eval).

## Cleanup (when the branch testbed is no longer needed)
Stop the worktree dev server, then `git worktree remove --force /Users/darcywang/tutor-project-gpt4o` (touches nothing on main). The branch + `a310df0` remain in the repo.
