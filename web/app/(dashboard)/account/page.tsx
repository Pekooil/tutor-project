import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadNavUser } from '@/components/dashboard/premium/user-info'
import { Logomark } from '@/components/dashboard/premium/primitives'
import { C, glassCard, glassCardSoft, sheen, entrance } from '@/components/dashboard/premium/theme'
import { AccountActions } from './account-actions'
import { BillingActions } from '../billing/billing-actions'

// Account view — the design's Profile / Subscription / Export / Delete layout,
// wired to the real `users` row (email, tier, renewal, member-since) with the
// real export + delete + logout actions preserved. Server-rendered fresh.
export const dynamic = 'force-dynamic'

function monthYear(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function longDay(iso: string | null): string {
  if (!iso) return null as unknown as string
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

const rowStyle = { position: 'relative' as const, display: 'flex', justifyContent: 'space-between', gap: 16 }
const label = { fontSize: 13, color: C.muted }
const value = { fontSize: 13.5, fontWeight: 500 }

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [{ data: profile }, navUser] = await Promise.all([
    supabase
      .from('users')
      .select('email, subscription_tier, subscription_renews_at, birth_year, created_at')
      .eq('id', user.id)
      .single(),
    loadNavUser(supabase),
  ])

  const isPro = profile?.subscription_tier === 'pro'
  const renews = longDay(profile?.subscription_renews_at ?? null)

  return (
    <section data-screen-label="Account">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>Account</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>Your details, plan, and data</h1>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, alignItems: 'start' }}>
        {/* Profile */}
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.08) }}>
          <span style={sheen} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 11 }}>
            <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 11, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="5.4" r="2.5" /><path d="M3.4 13 C4 10.6 5.8 9.5 8 9.5 C10.2 9.5 12 10.6 12.6 13" /></svg>
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>Profile</span>
          </div>
          <div style={{ position: 'relative', height: 1, background: C.hair }} />
          <div style={{ ...rowStyle, padding: '11px 2px 10px' }}><span style={label}>Name</span><span style={value}>{navUser.name}</span></div>
          <div style={{ ...rowStyle, padding: '10px 2px', borderTop: '1px solid rgba(28,28,26,.06)' }}><span style={label}>Email</span><span style={value}>{profile?.email ?? user.email}</span></div>
          {profile?.birth_year && (
            <div style={{ ...rowStyle, padding: '10px 2px', borderTop: '1px solid rgba(28,28,26,.06)' }}><span style={label}>Birth year</span><span style={value}>{profile.birth_year}</span></div>
          )}
          <div style={{ ...rowStyle, padding: '10px 2px 2px', borderTop: '1px solid rgba(28,28,26,.06)' }}><span style={label}>Member since</span><span style={value}>{monthYear(profile?.created_at ?? null)}</span></div>
        </div>

        {/* Subscription */}
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.14) }}>
          <span style={sheen} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 11 }}>
            <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 11, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Logomark size={21} id="cxgAcct" />
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>Subscription</span>
            {isPro && (
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', borderRadius: 99, padding: '3px 9px', background: C.greenBg, color: C.greenInk }}>Active</span>
            )}
          </div>
          <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 12 }} />
          <p style={{ position: 'relative', margin: '0 0 2px', fontSize: 18, fontWeight: 600 }}>{isPro ? 'Calyxa Plus' : 'Calyxa Free'}</p>
          <p style={{ position: 'relative', margin: '0 0 16px', fontSize: 13, color: C.muted }}>
            {isPro ? `${renews ? `Renews ${renews} · ` : ''}$8 / month` : 'You’re on the free plan.'}
          </p>
          <BillingActions isPro={isPro} upgradeLabel="Upgrade to Plus" />
          {!isPro && (
            <p style={{ position: 'relative', margin: '10px 0 0', fontSize: 12, color: C.faint }}>
              Unlimited sessions and full learning insights. Secure checkout by Stripe · cancel anytime.
            </p>
          )}
        </div>
      </div>

      {/* Export */}
      <div style={{ ...glassCardSoft, padding: '15px 19px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, ...entrance(0.2) }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Export my data</span>
          <span style={{ fontSize: 13, color: C.muted }}>Everything Calyxa knows about your learning, in one file.</span>
        </span>
        <a href="/api/account/export" download className="cx-hover-faint" style={{ border: 'none', background: 'rgba(28,28,26,.06)', borderRadius: 99, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, color: C.ink, cursor: 'pointer', textDecoration: 'none' }}>
          Export as JSON
        </a>
      </div>

      {/* Delete + Logout */}
      <AccountActions />
    </section>
  )
}
