import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadSessionQuota } from '@/lib/learning/activity-read'
import { readReferralStatus, readReferredSignups } from '@/lib/referral/referral'
import { BillingScreen } from '@/components/studio/SettingsScreen'

// Sprint 23 / Task 7 (ADR-050/051): the billing page — where a student upgrades
// to Pro and manages their subscription. Server-rendered fresh, RLS-scoped to
// the caller's own `users` row; the Upgrade / Manage buttons (client) POST to
// /api/billing/{checkout,portal} and redirect to the Stripe-hosted page. No
// Stripe SDK reaches the browser — the client only ever receives a URL.
//
// Rebuilt on studio tokens (2026-07-25). It was a pre-studio screen, so reaching
// it from the dark studio dropped the student onto a white page mid-flow — the
// exact complaint that prompted the sweep. The reads and the checkout contract
// are unchanged; only the rendering moved.
export const dynamic = 'force-dynamic'

function longDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [{ data: profile }, quota, referral, signups, { checkout }] = await Promise.all([
    supabase
      .from('users')
      .select('subscription_tier, subscription_status, subscription_renews_at')
      .eq('id', user.id)
      .single(),
    loadSessionQuota(supabase),
    // ADR-053: the invite link lives on the plan card too, so a student managing
    // their plan can earn free sessions without leaving for /referral.
    readReferralStatus(supabase, user.id),
    // Who actually accepted. Read as the caller (referral_select_own is the
    // authorization), with the admin client used only to resolve those ids to
    // MASKED emails — see readReferredSignups.
    readReferredSignups(supabase, createAdminClient(), user.id),
    searchParams,
  ])

  const status = profile?.subscription_status ?? null

  return (
    <BillingScreen
      data={{
        isPro: profile?.subscription_tier === 'pro',
        pastDue: status === 'past_due',
        status,
        renews: longDay(profile?.subscription_renews_at ?? null),
        quota,
        quotaResets: longDay(quota.resetsAt),
        referral: referral
          ? {
              link: referral.link ?? null,
              referralCount: referral.referralCount,
              referralsPerReward: referral.referralsPerReward,
              rewardSessions: referral.rewardSessions,
              toNextReward: referral.toNextReward,
              bonusSessions: referral.bonusSessions,
              signups,
            }
          : null,
        // The webhook is the source of truth for the plan flip; this is only an
        // acknowledgement of the return trip from Stripe.
        checkout: checkout ?? null,
      }}
    />
  )
}
