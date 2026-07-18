import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import { clientFromBearer } from '@/lib/auth/bearer'
// Sprint 24 (ADR-038): tutor model calls go through the TutorProvider seam —
// Anthropic (default) or OpenAI GPT-4o-mini per TUTOR_PROVIDER.
import { getTutorProvider } from '@/lib/ai/provider'
import type { PageContext } from '@/lib/ai/page-context'
import { loadProfile } from '@/lib/learning/profile-read'
import { predictLikelyStruggle, pickStickingCandidates } from '@/lib/learning/predict'
import { commonMisconceptionsFor } from '@/lib/learning/misconception-catalog'
import { detectTopicKeys } from '@/lib/learning/topic'
import {
  parseMessages,
  parsePageContext,
  parseResponseLatencyMs,
  parseSessionId,
  parseSessionStart,
  sessionStartPlaceholder,
} from '@/lib/ai/turn-request'
import { completeTurn, groundProfileTags, persistOpeningInteraction } from '@/lib/ai/turn-complete'
import { costGuard } from '@/lib/tier/cost-guard'
import { estimateCost } from '@/lib/tier/cost-model'
import { MESSAGE_LIMIT_CLOSE_MESSAGE, MESSAGE_LIMIT_CLOSE_REASON } from '@/lib/ai/envelope'
import { endSession, sessionInteractionCount, SESSION_STUDENT_MESSAGE_LIMIT } from '@/lib/tier/session-gate'

// Sprint 16 / Task 3 (ADR-041): the friendly hard-cap refusal, verbatim per
// the ADR. Never a 500, never a provider call — the global daily ceiling is
// a beta-budget backstop, not a per-user limit (that stays ADR-007's job,
// untouched).
const COST_RESTING_MESSAGE = 'Calyxa is resting for today — the tutor is back tomorrow.'

// TEMPORARY DIAGNOSTIC (set CALYXA_DEBUG_TURN=1). The `turn_latency` telemetry
// only ever fires on the voice path when audio plays, so a slow/degraded TEXT
// turn produces no signal at all — this fills that gap. When the flag is set,
// each real turn logs to the dev-server console WHERE the wall-clock went
// (cost guard / profile read / model / persistence) and WHAT the model saw and
// produced (page-context size, detection/answer, annotation count) — the exact
// breakdown needed to localize a "latency up / detection worse / annotations
// dropped" report. Best-effort and side-effect-free; remove once diagnosed.
function debugTurn(label: string, fields: Record<string, unknown>): void {
  if (process.env.CALYXA_DEBUG_TURN) {
    console.log(`[calyxa debug:${label}]`, JSON.stringify(fields))
  }
}

// A compact, log-safe view of the page context the extension actually sent —
// its SIZE and shape, never the full text (kept small + PII-light for the log).
function pageContextSummary(pc: PageContext | undefined): Record<string, unknown> | null {
  if (!pc) return null
  return {
    title: pc.title ? pc.title.slice(0, 60) : undefined,
    textChars: pc.text?.length ?? 0,
    equations: pc.equations.length,
  }
}

// Wall-clock a promise-returning stage without swallowing its error/result.
async function timed<T>(bucket: { ms: number }, run: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    return await run()
  } finally {
    bucket.ms = Date.now() - start
  }
}

// This route reads the live learning profile (ADR-014) and WRITES one
// session_interactions row per gradable turn (text only, no audio -- ADR-011).
// pageContext + profile are rendered into the prompt for this turn only and
// discarded. The response carries the envelope's validated annotations /
// profileTags / solutionProgress / session ADDITIVELY (ADR-023/024/027);
// none of those are persisted -- session_interactions keeps its Sprint 11
// shape. As of the Sprint 15 voice follow-on, the request parsers live in
// turn-request.ts and the persistence + grounding + ping tail lives in
// turn-complete.ts (completeTurn) -- both shared with /api/ai/turn/stream so
// the streamed and non-streamed turns behave identically past the model call.

// Detects the opening-scan request shape: `{ opening: true, pageContext,
// sessionId? }`, no `messages` -- distinguished by this flag alone.
function isOpeningScanBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) {
    return false
  }

  return (body as { opening?: unknown }).opening === true
}

// The curriculum-title fallback the overview route already uses: a stale
// concept key must never 500 the scan -- a raw key beats a broken reply.
function titleFor(conceptKey: string): string {
  return getConcept(conceptKey)?.title ?? conceptKey
}

// The opening-scan branch (ADR-030): same auth, same topic-biased loadProfile
// read, same grounding gate for any profile tag -- only the AI call and the
// response shape differ from a normal turn. Never returns assessment /
// solutionProgress / session. The session-kickoff feature adds `prediction`
// (predictLikelyStruggle -- grounded in the profile's active misconceptions,
// no model involvement), additively: absent, not null, when the profile
// carries nothing to predict from.
async function handleOpeningScan(
  auth: { supabase: SupabaseClient; user: { id: string } },
  body: unknown
): Promise<NextResponse> {
  const pageContext = parsePageContext(body)

  if (!pageContext) {
    return NextResponse.json({ error: 'An opening scan request requires a pageContext.' }, { status: 400 })
  }

  const sessionId = parseSessionId(body)

  // Sprint 16 / Task 3 (ADR-041): the global cost guard. Only the hard cap
  // applies here — the opening scan is text-only (no voice legs to degrade)
  // and this call is exactly as much "a new AI turn" as any other, so
  // ADR-041's "hard cap refuses new AI turns" covers it too. It degrades to
  // the SAME silent-open contract ADR-030 already established for "nothing
  // found" / a failed scan (background/index.ts's EMPTY_REPLY) rather than
  // the resting message — an unsolicited proactive turn is not the place to
  // surface a budget notice the student never asked a question to receive.
  //
  // Latency fix (2026-07-16): the guard and the profile read run in
  // PARALLEL — they were serialized, two back-to-back DB round trips on the
  // critical path before the model call. The guard fails open by design, so
  // a profile read that turns out to be wasted on a hard-capped day is the
  // cheap side of the trade. `userId` skips loadProfile's redundant
  // auth.getUser() round trip (clientFromBearer already resolved the user).
  const profileTimer = { ms: 0 }
  const topicKeys = detectTopicKeys(pageContext, [])
  const [{ hardExceeded }, profile] = await Promise.all([
    costGuard(auth.supabase, estimateCost('claude_turn')),
    timed(profileTimer, () => loadProfile(auth.supabase, { topicKeys, userId: auth.user.id })),
  ])

  if (hardExceeded) {
    return NextResponse.json({ reply: '' })
  }

  try {
    const modelTimer = { ms: 0 }
    // The forced-tool scan (claude.ts's OPENING_SCAN_TOOL, 2026-07-16): the
    // model both reads the problem AND classifies it against the curriculum
    // enum -- detection no longer depends on the page text happening to
    // contain a keyword alias.
    const { envelope, conceptKey: modelConceptKey, topicTitle } = await timed(modelTimer, () =>
      getTutorProvider().runOpeningScan({ pageContext, profile })
    )

    debugTurn('opening-scan', {
      page: pageContextSummary(pageContext),
      topicKeys,
      modelConceptKey,
      topicTitle,
      detected: envelope.say ? envelope.say.slice(0, 120) : '(empty — no detection)',
      annotationsEmitted: envelope.annotations?.length ?? 0,
      profileMs: profileTimer.ms,
      modelMs: modelTimer.ms,
    })

    await persistOpeningInteraction(auth.supabase, auth.user.id, sessionId, envelope)

    const annotations = envelope.annotations
    const profileTags = groundProfileTags(envelope.profileTags, profile)

    // Topic resolution, model-first (the 2026-07-16 detection fix): the
    // model's curriculum classification wins; the old deterministic keyword
    // match (detectTopicKeys) demotes to the fallback -- it still catches a
    // degrade-path turn (no tool_use block) and pages whose wording names
    // the concept outright. A confident read that fits NO curriculum key
    // still surfaces a check-in card via the model's own topic_title (with
    // a last-resort generic headline), instead of dropping the student to
    // the crop-it-yourself fallback card.
    const resolvedConceptKey = modelConceptKey ?? (topicKeys.length > 0 ? topicKeys[0] : null)
    const topic = resolvedConceptKey
      ? { conceptKey: resolvedConceptKey, title: titleFor(resolvedConceptKey) }
      : envelope.say.trim()
        ? { conceptKey: '', title: topicTitle ?? 'This problem' }
        : undefined

    const prediction = predictLikelyStruggle(
      profile,
      resolvedConceptKey ? [resolvedConceptKey, ...topicKeys] : topicKeys
    )
    // The check-in's 5b sticking-point candidates (design handoff feature):
    // scoped to the SAME concept `topic` above names -- never a different
    // one than what the student is about to confirm on 5a. [] (and so
    // omitted) when no curriculum concept was resolved at all.
    const stickingCandidates = resolvedConceptKey ? pickStickingCandidates(profile, resolvedConceptKey) : []
    // The concept's curated common misconceptions (misconception-catalog.ts,
    // Darcy's 2026-07-17 ask): the extension fills whichever ranked chip
    // slots the student's own history doesn't cover from these BEFORE its
    // fixed generic pool — so a cold start shows a real, concept-specific
    // "common first place to check" instead of "Setting up the equation".
    // A separate additive field, never mixed into stickingCandidates: only
    // recorded history may render as personalized.
    const commonSticking =
      resolvedConceptKey && stickingCandidates.length < 3 ? commonMisconceptionsFor(resolvedConceptKey) : []

    return NextResponse.json({
      reply: envelope.say,
      ...(annotations && annotations.length > 0 ? { annotations } : {}),
      ...(profileTags.length > 0 ? { profileTags } : {}),
      ...(topic ? { topic } : {}),
      ...(stickingCandidates.length > 0
        ? {
            stickingCandidates: stickingCandidates.map((item) => ({
              category: item.category,
              description: item.description,
            })),
          }
        : {}),
      ...(commonSticking.length > 0 ? { commonSticking } : {}),
      ...(prediction
        ? {
            prediction: {
              conceptKey: prediction.conceptKey,
              title: titleFor(prediction.conceptKey),
              category: prediction.category,
              description: prediction.description,
            },
          }
        : {}),
    })
  } catch {
    return NextResponse.json({ error: 'Tutor is unavailable right now.' }, { status: 502 })
  }
}

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)

  if (isOpeningScanBody(body)) {
    return handleOpeningScan(auth, body)
  }

  const parsedMessages = parseMessages(body)
  // The session-start kickoff (the check-in confirm / reframe start): the
  // request carries NO messages -- the student never typed anything, they
  // confirmed the detected problem + sticking point on the check-in card,
  // and that confirmation arrives as the structured `sessionStart` field.
  // The Anthropic API still needs a user turn, so the route builds its own
  // honest placeholder (the OPENING_SCAN_PLACEHOLDER_MESSAGE precedent) and
  // SESSION START MODE in the prompt drives the reply: dive straight into
  // the confirmed problem at the sticking point. Honored ONLY when messages
  // are absent -- a mid-conversation turn can never smuggle one in.
  const sessionStart = !parsedMessages ? parseSessionStart(body) : undefined

  if (!parsedMessages && !sessionStart) {
    return NextResponse.json(
      {
        error:
          'messages must be a non-empty array of { role: "user" | "assistant", content: string }, ending with a user turn.',
      },
      { status: 400 }
    )
  }

  const messages = parsedMessages ?? [sessionStartPlaceholder(sessionStart!)]

  const pageContext = parsePageContext(body)
  const sessionId = parseSessionId(body)
  const responseLatencyMs = parseResponseLatencyMs(body)

  // Turn-time topic detection (ADR-021): deterministic keyword match, no model
  // call, [] on any miss -- so the profile read below degrades to its
  // pre-Sprint-11 behaviour.
  const topicKeys = detectTopicKeys(pageContext, messages)

  // Sprint 16 / Task 3 (ADR-041): the global cost guard. Hard cap returns the
  // friendly resting message — never a 500, never a provider call. Soft cap
  // does NOT block a text turn (only the voice legs degrade, ADR-041
  // Decision 2); it threads `degraded: true` onto the normal response below
  // so the client knows to skip STT/TTS for this turn.
  //
  // Latency fix (2026-07-16): the guard and the profile read (ADR-014, biased
  // to page-relevant topicKeys; never throws) run in PARALLEL — they were
  // serialized, two back-to-back DB round trips on every turn's critical path
  // before the model call. The guard fails open by design, so a profile read
  // wasted on a hard-capped day is the cheap side of the trade. `userId`
  // skips loadProfile's redundant auth.getUser() round trip (clientFromBearer
  // already resolved the user — that duplicate auth call was a third
  // serialized network hop per turn).
  const costGuardTimer = { ms: 0 }
  const profileTimer = { ms: 0 }
  // The per-session student-message cap's count rides the SAME parallel round
  // trip (public launch, 2026-07-18) — no serial hop added to the turn path.
  // null (no sessionId, or a count error) fails open: uncapped.
  const [{ softExceeded, hardExceeded }, profile, interactionCount] = await Promise.all([
    timed(costGuardTimer, () => costGuard(auth.supabase, estimateCost('claude_turn'))),
    timed(profileTimer, () => loadProfile(auth.supabase, { topicKeys, userId: auth.user.id })),
    sessionId ? sessionInteractionCount(auth.supabase, sessionId) : Promise.resolve(null),
  ])

  // Session message cap (SESSION_STUDENT_MESSAGE_LIMIT): past it, no model
  // call ever happens again for this session — the route ends the session
  // server-side itself (idempotent RPC; a repeat call on an ended session is
  // a no-op) and returns the close envelope the overlay already knows how to
  // choreograph. Checked before the cost caps' branches so a capped session
  // reads as "session over", never "Calyxa is resting".
  if (interactionCount !== null && interactionCount >= SESSION_STUDENT_MESSAGE_LIMIT) {
    await endSession(auth.supabase, sessionId!)
    return NextResponse.json({
      reply: MESSAGE_LIMIT_CLOSE_MESSAGE,
      session: { complete: true, reason: MESSAGE_LIMIT_CLOSE_REASON },
    })
  }

  if (hardExceeded) {
    // `degradedCap` (Sprint 18 Task 8, ADR-043): annotates WHICH cap fired so
    // the extension can emit an accurate `degraded_hit.cap` — the client sees
    // only `degraded: true` otherwise and cannot tell soft from hard. Telemetry
    // support only; no change to the reply/`degraded` behavior.
    return NextResponse.json({ reply: COST_RESTING_MESSAGE, degraded: true, degradedCap: 'hard' })
  }

  try {
    const modelTimer = { ms: 0 }
    const envelope = await timed(modelTimer, () =>
      getTutorProvider().runTurn({
        messages,
        pageContext,
        profile,
        ...(sessionStart ? { sessionStart } : {}),
      })
    )

    // The shared persistence + grounding + ping tail (turn-complete.ts) --
    // identical to the streamed route's terminal event, so the two turn paths
    // never drift.
    const completeTimer = { ms: 0 }
    const payload = await timed(completeTimer, () =>
      completeTurn(
        auth.supabase,
        auth.user.id,
        sessionId,
        messages[messages.length - 1].content,
        envelope,
        responseLatencyMs,
        profile
      )
    )

    debugTurn(sessionStart ? 'turn:session-start' : 'turn', {
      page: pageContextSummary(pageContext),
      topicKeys,
      profileNodes: profile.masteryNodes.length,
      answer: envelope.say ? envelope.say.slice(0, 120) : '(empty)',
      assessment: envelope.assessment?.outcome,
      annotationsEmitted: envelope.annotations?.length ?? 0,
      softExceeded,
      costGuardMs: costGuardTimer.ms,
      profileMs: profileTimer.ms,
      modelMs: modelTimer.ms,
      persistMs: completeTimer.ms,
      totalMs: costGuardTimer.ms + profileTimer.ms + modelTimer.ms + completeTimer.ms,
    })

    return NextResponse.json({ ...payload, ...(softExceeded ? { degraded: true, degradedCap: 'soft' } : {}) })
  } catch {
    // Never relay the provider's error text or any key material to the client.
    return NextResponse.json({ error: 'Tutor is unavailable right now.' }, { status: 502 })
  }
}
