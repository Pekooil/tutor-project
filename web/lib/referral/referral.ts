import 'server-only'
import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FREE_SESSION_LIMIT } from '@/lib/tier/session-gate'
import { canonicalizeSiteUrl, CANONICAL_SITE_URL } from '@/lib/site-url'

// ADR-053 referral constants. Server-side single source of truth — the
// extension and dashboard only ever display numbers the API returns, never
// compute entitlement from their own copies.
export const REFERRALS_PER_REWARD = 3
export const REFERRAL_REWARD_SESSIONS = 10
// The "enjoying it?" prompt milestone: once a user has COMPLETED this many
// sessions (sessions.ended_at set), the extension offers the referral card.
export const REFERRAL_MILESTONE_COMPLETED_SESSIONS = 5
// Max accounts per hashed signup IP (ADR-053 abuse gate). 2, not 1: siblings
// and households behind one NAT are real; farms of three-plus are not.
export const SIGNUP_IP_ACCOUNT_LIMIT = 2

export function referralLink(code: string): string {
  // A referral link is user-shared and navigable, so it must never carry a
  // retired *.vercel.app origin — canonicalizeSiteUrl forces calyxa.app
  // (see lib/site-url.ts).
  const base = canonicalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, CANONICAL_SITE_URL)
  return `${base}/signup?ref=${code}`
}

// Human-shareable code: 8 chars from a confusion-free alphabet (no I/L/O/0/1),
// ~40 bits — unguessable in practice for a code that only gates attribution
// (never money or data), and short enough to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

export function generateReferralCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return code
}

// Create-if-absent, service-role write: referral_code is a server-managed
// column (the client never chooses it). Retries on the (astronomically rare)
// unique collision; concurrent calls for the same user converge on whichever
// code landed first via the `referral_code is null` guard + re-read.
export async function ensureReferralCode(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row, error: readError } = await admin
      .from('users')
      .select('referral_code')
      .eq('id', userId)
      .maybeSingle()

    if (readError || !row) {
      console.error('referral: could not read referral_code', readError)
      return null
    }

    if (row.referral_code) {
      return row.referral_code as string
    }

    const code = generateReferralCode()
    const { error: writeError } = await admin
      .from('users')
      .update({ referral_code: code })
      .eq('id', userId)
      .is('referral_code', null)

    if (!writeError) {
      // Re-read rather than trusting our write: a concurrent request may have
      // won the `is null` race, in which case ITS code is the user's code.
      continue
    }

    // Unique-violation on the code -> loop generates a fresh one. Anything
    // else is a real failure.
    if (!/duplicate|unique/i.test(writeError.message)) {
      console.error('referral: could not write referral_code', writeError)
      return null
    }
  }

  console.error('referral: gave up allocating a referral_code for', userId)
  return null
}

/** One accepted invite, as the REFERRER is allowed to see it. */
export type ReferredSignup = {
  /** The `referral` row id — a stable React key that is not the friend's user id. */
  id: string
  /** `d••••@gmail.com`. Never the full address — see readReferredSignups. */
  maskedEmail: string
  /** ISO timestamp of the signup. */
  joinedAt: string
}

/** `darcy2008@gmail.com` → `d••••@gmail.com`.
 *
 *  Enough for the referrer to recognise someone they invited, not enough to
 *  harvest an address from a link that was shared further than intended. The
 *  dot count is fixed, so the mask never leaks the local-part's length either. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '••••'
  const local = email.slice(0, at)
  const domain = email.slice(at)
  return `${local[0]}••••${domain}`
}

/** Who accepted this user's invite, newest first.
 *
 *  Two clients on purpose. The LIST of referred users is read through the
 *  caller's own RLS-scoped client, so `referral_select_own` is what proves the
 *  caller is the referrer — authorization is never a filter we wrote. Only THEN
 *  does the admin client resolve those specific ids to emails, because
 *  `users_select_own` (correctly) does not let one user read another's row, and
 *  the address is masked here, server-side, before it can reach the browser.
 *
 *  Returns [] rather than throwing: the invite card is a side feature and must
 *  never be able to take the billing page down with it. */
export async function readReferredSignups(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  userId: string
): Promise<ReferredSignup[]> {
  const { data: rows, error } = await supabase
    .from('referral')
    .select('id, referred_user_id, created_at')
    .eq('referrer_id', userId)
    .order('created_at', { ascending: false })

  if (error || !rows || rows.length === 0) {
    if (error) console.error('referral: referred-signups read failed', error)
    return []
  }

  const ids = rows.map((r) => r.referred_user_id as string)
  const { data: friends, error: friendsError } = await admin
    .from('users')
    .select('id, email')
    .in('id', ids)

  if (friendsError) {
    console.error('referral: referred-signups email read failed', friendsError)
  }

  const emailById = new Map<string, string>()
  for (const f of friends ?? []) emailById.set(f.id as string, (f.email as string) ?? '')

  return rows.map((r) => {
    const email = emailById.get(r.referred_user_id as string) ?? ''
    return {
      id: r.id as string,
      // A deleted account leaves its `referral` row behind (the FK cascades, so
      // in practice it doesn't — but a failed lookup must still render as
      // something honest rather than an empty line).
      maskedEmail: email ? maskEmail(email) : 'A friend',
      joinedAt: r.created_at as string,
    }
  })
}

export type ReferralStatus = {
  code: string | null
  link: string | null
  tier: string
  referralCount: number
  referralsPerReward: number
  rewardSessions: number
  toNextReward: number
  bonusSessions: number
  completedSessions: number
  milestoneCompletedSessions: number
  // Server-computed "the free allowance AND bonus balance are both spent" —
  // the extension keys its out-of-sessions referral offer on this rather than
  // any client-side session state (which is already cleared by recap time).
  outOfSessions: boolean
}

// All reads go through the CALLER's RLS-scoped client — users_select_own,
// referral_select_own, and sessions_select_own are the isolation guarantee,
// same posture as /api/study/list.
export async function readReferralStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<ReferralStatus | null> {
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('referral_code, referral_bonus_sessions, referral_rewards_granted, subscription_tier, free_session_count')
    .eq('id', userId)
    .maybeSingle()

  if (userError || !user) {
    console.error('referral: status user read failed', userError)
    return null
  }

  const { count: referralCount, error: referralError } = await supabase
    .from('referral')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', userId)

  if (referralError) {
    console.error('referral: status referral count failed', referralError)
    return null
  }

  const { count: completedSessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('ended_at', 'is', null)
    .is('deleted_at', null)

  if (sessionsError) {
    console.error('referral: status sessions count failed', sessionsError)
    return null
  }

  const code = (user.referral_code as string | null) ?? null
  const count = referralCount ?? 0
  const tier = (user.subscription_tier as string) ?? 'free'
  const bonusSessions = (user.referral_bonus_sessions as number) ?? 0

  return {
    code,
    link: code ? referralLink(code) : null,
    tier,
    referralCount: count,
    referralsPerReward: REFERRALS_PER_REWARD,
    rewardSessions: REFERRAL_REWARD_SESSIONS,
    toNextReward: REFERRALS_PER_REWARD - (count % REFERRALS_PER_REWARD),
    bonusSessions,
    completedSessions: completedSessions ?? 0,
    milestoneCompletedSessions: REFERRAL_MILESTONE_COMPLETED_SESSIONS,
    outOfSessions:
      tier === 'free' &&
      ((user.free_session_count as number) ?? 0) >= FREE_SESSION_LIMIT &&
      bonusSessions <= 0,
  }
}
