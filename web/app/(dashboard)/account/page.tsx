import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadSessionQuota } from '@/lib/learning/activity-read'
import { loadNavUser } from '@/components/dashboard/premium/user-info'
import { AccountScreen } from '@/components/studio/SettingsScreen'

// The account page — identity, plan summary, data export, sign out, delete.
// RLS-scoped to the caller's own `users` row, server-rendered fresh.
//
// Rebuilt on studio tokens (2026-07-25). It was a pre-studio screen, so the rail
// avatar and the top-bar kebab both dropped the student from a dark studio onto
// a white page. Its second full subscription card — which carried its own copy
// of the price, drifted to a stale "$8 / month" — is now a summary that links to
// /billing, so there is exactly one place the price is stated.
export const dynamic = 'force-dynamic'

function monthYear(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [{ data: profile }, navUser, quota] = await Promise.all([
    supabase
      .from('users')
      .select('email, subscription_tier, birth_year, created_at')
      .eq('id', user.id)
      .single(),
    loadNavUser(supabase),
    loadSessionQuota(supabase),
  ])

  return (
    <AccountScreen
      data={{
        name: navUser.name,
        email: profile?.email ?? user.email ?? '—',
        birthYear: profile?.birth_year ?? null,
        memberSince: monthYear(profile?.created_at ?? null),
        isPro: profile?.subscription_tier === 'pro',
        quota,
      }}
    />
  )
}
