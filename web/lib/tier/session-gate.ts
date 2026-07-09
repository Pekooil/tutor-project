import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

// Monthly free-session allowance. Single source of truth, server-side only —
// the route never computes or transmits this; it is only ever read by the
// `start_session` RPC call below. Mirrored (by hand, one constant) into
// web/components/marketing/Pricing.tsx, which cannot import this module (it
// pulls in @supabase/supabase-js) — pricing.test.ts binds the two so they
// cannot drift.
//
// Sprint 16 / Task 4 (ADR-041) retune, from 10 (the original PLAN.md §2.8
// placeholder, never data-driven). ADR-027 (Sprint 14) flagged the problem:
// sessions became problem-sized (one problem, not a whole study sitting), so
// "10 sessions/month" quietly became "10 PROBLEMS/month" — materially
// stingier than the old semantics, where one sitting likely covered several
// problems. No real per-turn dollar cost was ever measured live this sprint
// (checked: Sprint 15's "measured per-turn numbers" are LATENCY, not cost —
// docs/sprint-15-plan.md records p50 time-to-first-audio etc., no $ figures).
// This value is instead reasoned from Task 3's own cost-model.ts estimates
// (CLAUDE_TURN_CENTS/WHISPER_PER_SEC_CENTS/ELEVENLABS_PER_CHAR_CENTS), which
// are themselves budget placeholders, not invoiced numbers — so treat this
// as a considered starting point, not a final tuned figure:
//   - A problem-sized session ~6 turns (Sprint 14's Socratic, ≤3-sentence
//     turns) costs ~6 cents text-only, ~18 cents worst-case voice (1 Claude +
//     1 STT + 1 TTS cent/turn).
//   - At 20/month, worst-case (all-voice) monthly cost per free user is
//     ~20 × 18 = 360 cents ($3.60) — a defensible pre-beta ceiling; text-only
//     users cost ~$1.20/month.
//   - 20 also roughly restores the old tier's total problem-solving value if
//     a pre-Sprint-14 "sitting" covered ~2 problems on average.
// Task 9's manual acceptance pass is where this gets revisited against real
// usage, same as the cost caps in cost-model.ts.
export const FREE_SESSION_LIMIT = 20

export type SessionMode = 'voice' | 'text'

export type StartSessionRow = {
  id: string
  started_at: string
  mode: SessionMode
  counts_against_free: boolean
  degraded: boolean
  remaining: number | null
}

export type EndSessionRow = {
  id: string
  ended_at: string | null
  interaction_count: number
}

// Sprint 16 / Task 7 (ADR-036): `pageDomain` was replaced by `pageUrlHash` —
// the caller (web/app/api/session/start/route.ts) hashes the domain via
// hashPageDomain() before it ever reaches this file. `p_page_domain` is
// hardcoded to null below rather than left as a caller-supplied param, so
// this is the one place in the codebase that can ever write a session row,
// and plaintext page_domain structurally cannot flow through it again.
export async function startSession(
  supabase: SupabaseClient,
  { pageUrlHash, mode }: { pageUrlHash: string | null; mode: SessionMode }
): Promise<{ data: StartSessionRow | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('start_session', {
      p_page_domain: null,
      p_mode: mode,
      p_free_limit: FREE_SESSION_LIMIT,
      p_page_url_hash: pageUrlHash,
    })
    .single()

  return { data: data as StartSessionRow | null, error }
}

export async function endSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<{ data: EndSessionRow[] | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('end_session', { p_session_id: sessionId })

  return { data: data as EndSessionRow[] | null, error }
}
