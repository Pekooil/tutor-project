import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { PRO_PRICE_PER_MONTH } from '@/lib/billing/plan'
import type { SessionQuota } from '@/lib/learning/activity-read'
import type { ReferredSignup } from '@/lib/referral/referral'
import { T, ORDINAL, RULE, RADIUS, eyebrow, ghostButton, pageEyebrow, pill } from './tokens'
import { BillingActions, DeleteAccountButton, LogoutButton, ReferralActions } from './settings-actions'

// The Account and Billing screens, rebuilt on studio tokens.
//
// Both were pre-studio screens built on `premium/theme.ts` — hardcoded LIGHT
// hexes over near-opaque white glass cards, which cannot render dark. The shell
// worked around that by pinning their content area to the light token set, so
// clicking the avatar from a dark studio dropped the student onto a white page.
// They are studio views now, so `isStudioView()` covers them and the pinning no
// longer applies to either.
//
// Both are server components; only the buttons are client (settings-actions).

const MAX_W = 1020

/** A settings card's own box metrics. The glass — fill, blur, edge, radius,
 *  sheen — comes from the `cx-card` class every call site carries. */
const card: CSSProperties = { padding: '20px 22px' }

/** "Jul 26, 2026". UTC, like every other date this screen renders, so the day
 *  never shifts under a reader in a different timezone. */
function joinedDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'recently'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function SettingsPage({ eyebrowText, title, children }: { eyebrowText: string; title: string; children: ReactNode }) {
  return (
    <div style={{ padding: '26px 40px 56px' }}>
      <div style={{ maxWidth: MAX_W, margin: '0 auto' }}>
        <div style={{ ...pageEyebrow, color: T.muted }}>{eyebrowText}</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 32, lineHeight: '38px', fontWeight: 600, letterSpacing: '-0.015em' }}>
          {title}
        </h1>
        {children}
      </div>
    </div>
  )
}

function CardHead({ title, badge }: { title: string; badge?: { text: string; tone: 'green' | 'amber' } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.005em' }}>{title}</h2>
      {badge && (
        <span
          style={{
            ...pill,
            ...(badge.tone === 'green' ? ORDINAL.green : ORDINAL.amber),
            marginLeft: 'auto',
            padding: '3px 9px',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
          }}
        >
          {badge.text}
        </span>
      )}
    </div>
  )
}

/** A label/value line. `first` drops the rule so a card does not open with one. */
function Row({ label, value, first }: { label: string; value: ReactNode; first?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '11px 0',
        borderTop: first ? 'none' : RULE,
      }}
    >
      <span style={{ fontSize: 13, color: T.muted }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

// ── Billing ──────────────────────────────────────────────────────────────────

export type BillingView = {
  isPro: boolean
  pastDue: boolean
  status: string | null
  /** "August 12", or null when there is no renewal on file. */
  renews: string | null
  quota: SessionQuota
  /** "August 12" — when the free allowance rolls over. */
  quotaResets: string | null
  referral: {
    link: string | null
    referralCount: number
    referralsPerReward: number
    rewardSessions: number
    toNextReward: number
    /** The spendable balance the accepted invites have already earned. */
    bonusSessions?: number
    /** Who accepted, newest first. Emails arrive already masked (server-side). */
    signups?: ReferredSignup[]
  } | null
  /** From Stripe's return URL: 'success' | 'cancelled' | null. */
  checkout: string | null
}

/** "2 more friends and you earn 10 free sessions", with the reward cycle drawn
 *  as one segment per friend.
 *
 *  The card used to end the sentence with "1 joined so far — 2 to go", which is
 *  the same arithmetic buried in a clause. A student's actual question is "how
 *  many more?", so that is the line set in ink at 15/600, and the segments make
 *  it answerable without reading at all. */
function ReferralProgress({
  count,
  per,
  reward,
  toNext,
}: {
  count: number
  per: number
  reward: number
  toNext: number
}) {
  // Progress within the CURRENT cycle, not lifetime: 4 accepted invites on a
  // 3-per-reward plan is one reward banked and one friend into the next.
  const filled = count % per
  const label = `${toNext} more ${toNext === 1 ? 'friend' : 'friends'} and you earn ${reward} free sessions`

  return (
    <div>
      <div
        role="img"
        aria-label={`${filled} of ${per} friends toward your next ${reward} free sessions.`}
        style={{ display: 'flex', gap: 5 }}
      >
        {Array.from({ length: per }, (_, i) => (
          <span
            key={i}
            className={i < filled ? 'cx-bar' : undefined}
            style={{
              flex: 1,
              height: 7,
              borderRadius: RADIUS.pill,
              background: i < filled ? T.greenDot : T.track,
            }}
          />
        ))}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 15, fontWeight: 600, letterSpacing: '-0.005em' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 12.5, color: T.muted }}>
        {count === 0
          ? 'No one has joined yet.'
          : `${count} ${count === 1 ? 'friend has' : 'friends have'} signed up with your link.`}
      </p>
    </div>
  )
}

/** Who accepted the invite. Addresses arrive masked from the server — the
 *  referrer gets to recognise the people they invited without the page handing
 *  out a full email for every account that ever used their link. */
function SignupList({ signups, per }: { signups: ReferredSignup[]; per: number }) {
  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: RULE }}>
      <div style={{ ...eyebrow, color: T.muted }}>Who&rsquo;s joined</div>

      {signups.length === 0 ? (
        <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.6, color: T.muted }}>
          No one has signed up with your link yet. Everyone who does shows up here.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {signups.map((s, i) => (
            <li
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 13px',
                background: T.row,
                border: `1px solid ${T.frame}`,
                borderRadius: RADIUS.box,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  borderRadius: '50%',
                  background: T.mintTile,
                  color: T.accentInk,
                  fontSize: 12,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textTransform: 'uppercase',
                }}
              >
                {s.maskedEmail.charAt(0)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 13.5,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.maskedEmail}
                </span>
                <span style={{ display: 'block', fontSize: 11.5, color: T.muted, marginTop: 2 }}>
                  Joined {joinedDay(s.joinedAt)}
                </span>
              </span>
              {/* The invite that completed a reward is the one worth calling out —
                  it is why the balance went up. The list is NEWEST-first, so the
                  chronological position is counted from the other end. */}
              {(signups.length - i) % per === 0 && (
                <span
                  style={{ ...pill, ...ORDINAL.green, padding: '3px 9px', fontSize: 11, fontWeight: 600, flexShrink: 0 }}
                >
                  Reward earned
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'green' | 'neutral'; children: ReactNode }) {
  return (
    <div
      className="cx-card-soft"
      style={{
        ...card,
        marginTop: 20,
        padding: '14px 18px',
        borderLeft: `3px solid ${tone === 'green' ? T.accentInk : T.borderStrong}`,
        fontSize: 13.5,
        lineHeight: 1.55,
        color: tone === 'green' ? T.ink : T.muted,
      }}
    >
      {children}
    </div>
  )
}

export function BillingScreen({ data }: { data: BillingView }) {
  const { isPro, pastDue, quota, referral } = data

  const per = referral?.referralsPerReward ?? 3
  const reward = referral?.rewardSessions ?? 10
  const joined = referral?.referralCount ?? 0
  // `toNextReward` is server-computed and already handles the wrap at a full
  // cycle (3 of 3 joined → 3 to go on a fresh one), so it is never 0.
  const toNext = referral?.toNextReward ?? per
  const earned = referral?.bonusSessions ?? 0

  return (
    <SettingsPage eyebrowText="Billing" title="Your plan">
      {data.checkout === 'success' && (
        <Notice tone="green">
          Thanks for subscribing. Your plan flips the moment Stripe confirms the payment — the card below always
          shows the real state.
        </Notice>
      )}
      {data.checkout === 'cancelled' && <Notice tone="neutral">Checkout cancelled — nothing changed.</Notice>}

      <section className="cx-card cx-rise" style={{ ...card, marginTop: 22 }}>
        <CardHead
          title="Current plan"
          badge={isPro ? { text: pastDue ? 'Past due' : 'Active', tone: pastDue ? 'amber' : 'green' } : undefined}
        />

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.015em' }}>
            {isPro ? 'Calyxa Pro' : 'Calyxa Free'}
          </span>
          <span style={{ fontSize: 14, color: T.muted, fontWeight: 500 }}>
            {isPro ? PRO_PRICE_PER_MONTH : '$0 / month'}
          </span>
        </div>

        <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.6, color: T.muted, maxWidth: 560 }}>
          {isPro
            ? pastDue
              ? 'Your last payment failed. Pro stays active through a short grace period while Stripe retries — update your card in the portal to keep it.'
              : `Unlimited sessions and everything Calyxa learns about you, working for you.${data.renews ? ` Renews ${data.renews}.` : ''}`
            : `Free includes ${quota.limit} tutoring sessions a month. Pro lifts the cap for ${PRO_PRICE_PER_MONTH}.`}
        </p>

        <div style={{ marginTop: 16, paddingTop: 4 }}>
          <Row
            first
            label="Sessions left this month"
            value={isPro ? 'Unlimited' : `${quota.remaining} of ${quota.limit}`}
          />
          {!isPro && data.quotaResets && <Row label="Allowance resets" value={data.quotaResets} />}
          {isPro && data.status && <Row label="Subscription status" value={data.status} />}
        </div>

        <div style={{ marginTop: 18 }}>
          <BillingActions isPro={isPro} upgradeLabel={`Upgrade to Pro — ${PRO_PRICE_PER_MONTH}`} />
        </div>

        {!isPro && (
          <p style={{ margin: '12px 0 0', fontSize: 12, color: T.muted }}>
            Secure checkout by Stripe. Cancel anytime.
          </p>
        )}
      </section>

      {/* `id` so the rail's gift button can deep-link straight to the invite
          card rather than dropping the student at the top of the plan page. */}
      <section id="invite" className="cx-card" style={{ ...card, marginTop: 14, scrollMarginTop: 20 }}>
        <CardHead
          title="Invite friends, earn free sessions"
          badge={earned > 0 ? { text: `${earned} sessions earned`, tone: 'green' } : undefined}
        />
        <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.6, color: T.muted, maxWidth: 560 }}>
          Share your link — when {per} friends sign up you get {reward} free sessions.
        </p>

        <ReferralProgress count={joined} per={per} reward={reward} toNext={toNext} />

        <div style={{ marginTop: 16 }}>
          <ReferralActions initialLink={referral?.link ?? null} />
        </div>

        <SignupList signups={referral?.signups ?? []} per={per} />
      </section>
    </SettingsPage>
  )
}

// ── Account ──────────────────────────────────────────────────────────────────

export type AccountView = {
  name: string
  email: string
  birthYear: number | null
  /** "July 2026". */
  memberSince: string
  isPro: boolean
  quota: SessionQuota
}

export function AccountScreen({ data }: { data: AccountView }) {
  return (
    <SettingsPage eyebrowText="Account" title="Your details and data">
      <section className="cx-card cx-rise" style={{ ...card, marginTop: 22 }}>
        <CardHead title="Profile" />
        <Row first label="Name" value={data.name} />
        <Row label="Email" value={data.email} />
        {data.birthYear !== null && <Row label="Birth year" value={data.birthYear} />}
        <Row label="Member since" value={data.memberSince} />
      </section>

      {/* Plan is SUMMARISED here and owned by /billing. It used to be a second
          full subscription card with its own upgrade button and its own copy of
          the price — which is how the price drifted to a stale "$8 / month" on
          this page while the rest of the product said $10. */}
      <section className="cx-card" style={{ ...card, marginTop: 14 }}>
        <CardHead title="Plan" />
        <Row first label="Current plan" value={data.isPro ? 'Calyxa Pro' : 'Calyxa Free'} />
        <Row
          label="Sessions left this month"
          value={data.isPro ? 'Unlimited' : `${data.quota.remaining} of ${data.quota.limit}`}
        />
        <div style={{ marginTop: 16 }}>
          <Link href="/billing" style={{ ...ghostButton, borderRadius: RADIUS.pill, padding: '9px 17px', fontSize: 13 }}>
            {data.isPro ? 'Manage plan' : 'See plans'} →
          </Link>
        </div>
      </section>

      <section className="cx-card" style={{ ...card, marginTop: 14 }}>
        <CardHead title="Your data" />
        <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.6, color: T.muted, maxWidth: 560 }}>
          Everything Calyxa knows about your learning, in one file — sessions, mastery, misconceptions and the study
          material generated from them.
        </p>
        <a
          href="/api/account/export"
          download
          style={{ ...ghostButton, borderRadius: RADIUS.pill, padding: '9px 17px', fontSize: 13, textDecoration: 'none' }}
        >
          Export as JSON
        </a>
      </section>

      <section className="cx-card" style={{ ...card, marginTop: 14 }}>
        <CardHead title="Session" />
        <LogoutButton />
      </section>

      <section
        className="cx-card"
        style={{
          ...card,
          marginTop: 14,
          borderLeft: `3px solid ${T.danger}`,
        }}
      >
        <CardHead title="Delete account" />
        <DeleteAccountButton />
      </section>
    </SettingsPage>
  )
}
