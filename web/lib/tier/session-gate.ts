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
//
// 2026-07-17 (public-launch retune, Darcy's call): 20 -> 10 for launch. The
// Sprint 16 reasoning above assumed text-heavy beta usage; with voice, the
// study-kit call (Sprint 21), and open signup, 10 holds the worst-case
// per-free-user month near ~$1 at current provider rates. Revisit against
// real invoices once launch traffic exists.
export const FREE_SESSION_LIMIT = 10

// Public launch (2026-07-18): every tutoring session — free AND Pro — closes
// automatically once the student has sent this many messages. Two jobs in
// one: a runaway-cost bound per session (each turn is a paid model call, and
// nothing else bounds a single session's length), and a pedagogy nudge (a
// 25-exchange sitting has long since stopped being one problem). Enforced
// server-side in BOTH turn routes against the session's own
// session_interactions row count (one row per student turn, ADR-019) — the
// request transcript can't be the authority because parseMessages windows it
// to the last 8 turns. The capped turn returns the MESSAGE_LIMIT close
// envelope (web/lib/ai/envelope.ts) with NO model call, and the route ends
// the session server-side itself — a client that ignores the close signal
// just keeps receiving the same capped close, never another model call.
export const SESSION_STUDENT_MESSAGE_LIMIT = 25

// The friendly refusal shown when a free user is past their monthly session
// allowance and tries to tutor. Mirrors COST_RESTING_MESSAGE's tone; the two
// envelope turn routes and /api/ai/stream all import THIS one constant so the
// text can never drift between paths. Points at Pro because that is how the
// cap is lifted (Pro is quota-exempt in start_session).
export const FREE_LIMIT_MESSAGE =
  "You've used all your free sessions this month. Upgrade to Calyxa Pro for unlimited tutoring, or come back next month."

// Public-launch free-cap enforcement (2026-07-18). `start_session` decides the
// monthly free allowance ONCE, at session start, and records the verdict on
// the row: a free user's 11th+ session (FREE_SESSION_LIMIT) is created with
// counts_against_free = false — it did not fit the allowance, the same rows
// the RPC flags `degraded`. The turn routes call this to RE-DERIVE that
// verdict server-side, because "free tier limits are enforced server-side;
// the client is a hint only" (CLAUDE.md): the extension's `degraded` UI never
// gates the model call, so WITHOUT this a free user past their quota keeps
// getting full AI turns forever (the launch bug this fixes).
//
// A session is over the free cap iff its owner is STILL on the free tier AND
// counts_against_free = false. The tier predicate is REQUIRED, not incidental:
// Pro sessions also carry counts_against_free = false (Pro is quota-exempt),
// and a paying user must never be refused. Reading the session's stored
// verdict — not the user's live free_session_count — is deliberate: session
// #10 starts UNDER quota (counts_against_free = true) and all its turns must
// run even though the live count now equals the limit.
//
// Fails OPEN (returns false) on any error, missing row, or sessionless turn,
// matching costGuard + sessionInteractionCount's contract: a lookup hiccup, or
// a rare sessionless turn, must never wrongly block a paid-for or in-quota
// turn. The sessions RLS + the users!inner embed are both scoped to the
// caller's own rows (the session's user_id and the embedded user id are both
// auth.uid()), so this reads only the caller's own state.
export async function sessionOverFreeCap(
  supabase: SupabaseClient,
  sessionId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('sessions')
    .select('counts_against_free, users!inner(subscription_tier)')
    .eq('id', sessionId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('session-gate: free-cap lookup failed, proceeding uncapped', error)
    return false
  }

  const row = data as unknown as {
    counts_against_free: boolean
    users: { subscription_tier: string } | { subscription_tier: string }[] | null
  }
  const owner = Array.isArray(row.users) ? row.users[0] : row.users
  return owner?.subscription_tier === 'free' && row.counts_against_free === false
}

// The cap's server-authoritative count: how many interactions (student
// turns) this session has already persisted. RLS scopes the count to the
// caller's own rows. Returns null on any error — the cap FAILS OPEN like
// every other "should this call proceed" source in this codebase (see
// cost-guard.ts's contract note): a count-layer hiccup must never kill a
// tutoring turn. The skew window is honest and bounded: rows are written
// per-turn via after(), so a rapid-fire client might land the cap a turn
// late — acceptable for a cost/pedagogy bound.
export async function sessionInteractionCount(
  supabase: SupabaseClient,
  sessionId: string
): Promise<number | null> {
  const { count, error } = await supabase
    .from('session_interactions')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  if (error || count === null) {
    console.error('session-gate: interaction count failed, proceeding uncapped', error)
    return null
  }

  return count
}

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
