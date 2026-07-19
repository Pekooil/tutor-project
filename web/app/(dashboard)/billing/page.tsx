import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Logomark } from '@/components/dashboard/premium/primitives'
import { C, glassCard, sheen, entrance } from '@/components/dashboard/premium/theme'
import { readReferralStatus } from '@/lib/referral/referral'
import { BillingActions } from './billing-actions'
import { ReferralActions } from '../referral/referral-actions'

// Sprint 23 / Task 7 (ADR-050/051): the billing page — the dashboard surface
// where a student upgrades to Pro and manages their subscription. Server-
// rendered fresh, RLS-scoped to the caller's own `users` row (subscription_tier
// / status / renewal); the Upgrade / Manage buttons (client) POST to
// /api/billing/{checkout,portal} and redirect to the Stripe-hosted page. No
// Stripe SDK reaches the browser — the client only ever receives a URL.
export const dynamic = 'force-dynamic'

function longDay(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const label = { fontSize: 13, color: C.muted }
const value = { fontSize: 13.5, fontWeight: 500 }
const rowStyle = {
  position: 'relative' as const,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  padding: '10px 2px',
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

  const { data: profile } = await supabase
    .from('users')
    .select('subscription_tier, subscription_status, subscription_renews_at')
    .eq('id', user.id)
    .single()

  const isPro = profile?.subscription_tier === 'pro'
  const status = profile?.subscription_status ?? null
  const pastDue = status === 'past_due'
  const renews = longDay(profile?.subscription_renews_at ?? null)

  // Referral (ADR-053): the invite link lives on the current-plan card too, so
  // a user managing their plan can earn free sessions without leaving for the
  // dedicated /referral page. RLS-scoped read as the caller.
  const referral = await readReferralStatus(supabase, user.id)

  // Post-checkout return notice (success/cancel URLs point back here with
  // ?checkout=…). The webhook is the source of truth for the plan flip, so this
  // is only a friendly acknowledgement — the plan card above reflects the real
  // row either way.
  const { checkout } = await searchParams

  return (
    <section data-screen-label="Billing">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <p
          style={{
            margin: '0 0 7px',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: C.muted,
          }}
        >
          Billing
        </p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>
          Your plan &amp; subscription
        </h1>
      </header>

      {checkout === 'success' && (
        <div
          style={{
            ...glassCard,
            padding: '13px 18px',
            marginBottom: 16,
            fontSize: 13.5,
            color: C.greenInk,
            ...entrance(0.04),
          }}
        >
          <span style={sheen} />
          <span style={{ position: 'relative' }}>
            Thanks for subscribing! Your plan updates the moment Stripe confirms the payment — this
            page reflects the latest state.
          </span>
        </div>
      )}
      {checkout === 'cancelled' && (
        <div
          style={{
            ...glassCard,
            padding: '13px 18px',
            marginBottom: 16,
            fontSize: 13.5,
            color: C.muted,
            ...entrance(0.04),
          }}
        >
          <span style={sheen} />
          <span style={{ position: 'relative' }}>Checkout cancelled — no changes were made to your plan.</span>
        </div>
      )}

      <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.08) }}>
        <span style={sheen} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 11 }}>
          <span
            style={{
              flex: 'none',
              width: 34,
              height: 34,
              borderRadius: 11,
              background: C.mintTile,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Logomark size={21} id="cxgBilling" />
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>Current plan</span>
          {isPro && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '.09em',
                textTransform: 'uppercase',
                borderRadius: 99,
                padding: '3px 9px',
                background: pastDue ? '#fef2f2' : C.greenBg,
                color: pastDue ? C.red : C.greenInk,
              }}
            >
              {pastDue ? 'Past due' : 'Active'}
            </span>
          )}
        </div>
        <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 12 }} />

        <p style={{ position: 'relative', margin: '0 0 2px', fontSize: 18, fontWeight: 600 }}>
          {isPro ? 'Calyxa Pro' : 'Calyxa Free'}
        </p>
        <p style={{ position: 'relative', margin: '0 0 16px', fontSize: 13, color: C.muted }}>
          {isPro
            ? pastDue
              ? 'Your last payment failed — Pro stays active during a short grace period while Stripe retries. Update your card in the portal to keep it.'
              : `Unlimited sessions and full learning insights.${renews ? ` Renews ${renews}.` : ''}`
            : 'Free includes a set number of tutoring sessions each month. Upgrade to Pro for unlimited sessions and everything Calyxa learns about you, working for you.'}
        </p>

        <div style={{ position: 'relative' }}>
          <BillingActions isPro={isPro} />
        </div>

        {/* Referral (ADR-053): earn free sessions by inviting friends, right
            from the plan card. */}
        <div style={{ position: 'relative', height: 1, background: C.hair, margin: '16px 0' }} />
        <p style={{ position: 'relative', margin: '0 0 3px', fontSize: 14, fontWeight: 600 }}>
          Invite friends, earn free sessions
        </p>
        <p style={{ position: 'relative', margin: '0 0 12px', fontSize: 13, color: C.muted }}>
          Share your link — when {referral?.referralsPerReward ?? 3} friends sign up, you get{' '}
          {referral?.rewardSessions ?? 10} free sessions.
          {referral && referral.referralCount > 0
            ? ` ${referral.referralCount} joined so far — ${referral.toNextReward} to go.`
            : ''}
        </p>
        <div style={{ position: 'relative' }}>
          <ReferralActions initialLink={referral?.link ?? null} />
        </div>
      </div>

      {!isPro && (
        <p style={{ marginTop: 16, fontSize: 12.5, color: C.faint, textAlign: 'center' }}>
          Secure checkout by Stripe. Cancel anytime.
        </p>
      )}

      {isPro && (
        <div style={{ ...rowStyle, marginTop: 18, padding: '0 2px' }}>
          <span style={label}>Status</span>
          <span style={value}>{status ?? '—'}</span>
        </div>
      )}
    </section>
  )
}
