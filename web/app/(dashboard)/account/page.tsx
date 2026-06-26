import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('email, subscription_tier, age_verified, gdpr_consent_version')
    .eq('id', user.id)
    .single()

  return (
    <main>
      <h1>Account</h1>
      {profile && (
        <dl>
          <dt>Email</dt>
          <dd>{profile.email}</dd>
          <dt>Tier</dt>
          <dd>{profile.subscription_tier}</dd>
          <dt>Age verified</dt>
          <dd>{profile.age_verified ? 'Yes' : 'No'}</dd>
          <dt>Consent version</dt>
          <dd>{profile.gdpr_consent_version}</dd>
        </dl>
      )}
      <LogoutButton />
    </main>
  )
}
