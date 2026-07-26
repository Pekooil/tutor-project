import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { PRO_PRICE_PER_MONTH } from '@/lib/billing/plan'
import type { SessionQuota } from '@/lib/learning/activity-read'
import { T, ORDINAL, RULE, eyebrow, ghostButton, pill } from './tokens'
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

const sectionLabel: CSSProperties = { ...eyebrow, color: T.muted }

function card(): CSSProperties {
  return { background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: '20px 22px' }
}

export function SettingsPage({ eyebrowText, title, children }: { eyebrowText: string; title: string; children: ReactNode }) {
  return (
    <div style={{ padding: '8px 40px 56px' }}>
      <div style={{ maxWidth: MAX_W, margin: '0 auto' }}>
        <div style={{ ...sectionLabel, letterSpacing: '0.14em', fontWeight: 600 }}>{eyebrowText}</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 32, lineHeight: 1.18, fontWeight: 600, letterSpacing: '-0.015em' }}>
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
            fontWeight: 700,
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
  } | null
  /** From Stripe's return URL: 'success' | 'cancelled' | null. */
  checkout: string | null
}

function Notice({ tone, children }: { tone: 'green' | 'neutral'; children: ReactNode }) {
  return (
    <div
      style={{
        ...card(),
        marginTop: 20,
        padding: '14px 18px',
        borderLeft: `3px solid ${tone === 'green' ? T.a1 : T.borderStrong}`,
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

  return (
    <SettingsPage eyebrowText="Billing" title="Your plan">
      {data.checkout === 'success' && (
        <Notice tone="green">
          Thanks for subscribing. Your plan flips the moment Stripe confirms the payment — the card below always
          shows the real state.
        </Notice>
      )}
      {data.checkout === 'cancelled' && <Notice tone="neutral">Checkout cancelled — nothing changed.</Notice>}

      <section style={{ ...card(), marginTop: 22 }}>
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

      <section style={{ ...card(), marginTop: 14 }}>
        <CardHead title="Invite friends, earn free sessions" />
        <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.6, color: T.muted, maxWidth: 560 }}>
          Share your link — when {referral?.referralsPerReward ?? 3} friends sign up you get{' '}
          {referral?.rewardSessions ?? 10} free sessions.
          {referral && referral.referralCount > 0
            ? ` ${referral.referralCount} joined so far — ${referral.toNextReward} to go.`
            : ''}
        </p>
        <ReferralActions initialLink={referral?.link ?? null} />
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
      <section style={{ ...card(), marginTop: 22 }}>
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
      <section style={{ ...card(), marginTop: 14 }}>
        <CardHead title="Plan" />
        <Row first label="Current plan" value={data.isPro ? 'Calyxa Pro' : 'Calyxa Free'} />
        <Row
          label="Sessions left this month"
          value={data.isPro ? 'Unlimited' : `${data.quota.remaining} of ${data.quota.limit}`}
        />
        <div style={{ marginTop: 16 }}>
          <Link href="/billing" style={{ ...ghostButton, padding: '9px 16px', fontSize: 13 }}>
            {data.isPro ? 'Manage plan' : 'See plans'} →
          </Link>
        </div>
      </section>

      <section style={{ ...card(), marginTop: 14 }}>
        <CardHead title="Your data" />
        <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.6, color: T.muted, maxWidth: 560 }}>
          Everything Calyxa knows about your learning, in one file — sessions, mastery, misconceptions and the study
          material generated from them.
        </p>
        <a
          href="/api/account/export"
          download
          style={{ ...ghostButton, padding: '9px 16px', fontSize: 13, textDecoration: 'none' }}
        >
          Export as JSON
        </a>
      </section>

      <section style={{ ...card(), marginTop: 14 }}>
        <CardHead title="Session" />
        <LogoutButton />
      </section>

      <section
        style={{
          ...card(),
          marginTop: 14,
          borderLeft: `3px solid color-mix(in srgb, var(--color-danger) 55%, transparent)`,
        }}
      >
        <CardHead title="Delete account" />
        <DeleteAccountButton />
      </section>
    </SettingsPage>
  )
}
