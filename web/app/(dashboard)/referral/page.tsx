import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Logomark } from '@/components/dashboard/premium/primitives'
import { C, glassCard, sheen, entrance } from '@/components/dashboard/premium/theme'
import { readReferralStatus } from '@/lib/referral/referral'
import { ReferralActions } from './referral-actions'

// ADR-053: the referral page — the dashboard home of the shareable invite
// link. Server-rendered fresh and RLS-scoped like every dashboard view
// (ADR-047): the status read runs as the caller, so the referral count /
// bonus balance can only ever be their own. The extension's referral card
// deep-links here ("Track progress in your dashboard").
export const dynamic = 'force-dynamic'

export default async function ReferralPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const status = await readReferralStatus(supabase, user.id)

  const count = status?.referralCount ?? 0
  const per = status?.referralsPerReward ?? 3
  const reward = status?.rewardSessions ?? 10
  const toNext = status?.toNextReward ?? per
  const bonus = status?.bonusSessions ?? 0
  const towardNext = count % per

  return (
    <section data-screen-label="Invite friends">
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
          Invite friends
        </p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>
          Share Calyxa, earn free sessions
        </h1>
      </header>

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
            <Logomark size={21} id="cxgReferral" />
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>Your invite link</span>
        </div>
        <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 12 }} />

        <p style={{ position: 'relative', margin: '0 0 16px', fontSize: 13, color: C.muted }}>
          Every friend who signs up with your link counts toward your next reward — when {per} join,
          you get {reward} more free tutoring sessions, automatically.
        </p>

        <div style={{ position: 'relative' }}>
          <ReferralActions initialLink={status?.link ?? null} />
        </div>
      </div>

      <div style={{ ...glassCard, padding: '16px 19px', marginTop: 16, ...entrance(0.16) }}>
        <span style={sheen} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 11 }}>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>Your progress</span>
        </div>
        <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 12 }} />

        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
            <span style={{ color: C.muted }}>Friends joined</span>
            <span style={{ fontWeight: 600 }}>{count}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
            <span style={{ color: C.muted }}>Toward your next reward</span>
            <span style={{ fontWeight: 600 }}>
              {towardNext} of {per} — {toNext} to go
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
            <span style={{ color: C.muted }}>Bonus sessions available</span>
            <span style={{ fontWeight: 600, color: bonus > 0 ? C.greenInk : C.ink }}>{bonus}</span>
          </div>
        </div>
      </div>

      <p style={{ marginTop: 16, fontSize: 12.5, color: C.faint, textAlign: 'center' }}>
        Bonus sessions never expire — they kick in whenever your monthly free allowance runs out.
      </p>
    </section>
  )
}
