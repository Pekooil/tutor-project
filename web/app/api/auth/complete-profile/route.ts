import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CONSENT_VERSION, meetsMinAge } from '@/lib/consent'

// Post-auth birth-year gate (Part 1, the birth-date gotcha). Every user reaches
// this within one session of their first sign-in — new email/password accounts
// and every Google account — because the unified entry form no longer collects
// birth year (postAuthDestination routes anyone with a null birth_year here).
//
// This is the AUTHORITATIVE age gate (mirrors /api/auth/signup's ADR-004 gate):
// an under-13 birth year DELETES the just-created account (cascading the profile
// row) and signs the user out, so no usable under-13 account ever persists —
// preserving the invariant even though, in the OAuth flow, account creation
// necessarily precedes age collection.
export async function POST(request: Request) {
  const { birthYear, consent } = await request.json()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  if (typeof birthYear !== 'number' || !meetsMinAge(birthYear)) {
    // Age gate: remove the account entirely (COPPA/ADR-004). deleteUser cascades
    // to the public.users row; sign out clears this request's cookie session.
    const admin = createAdminClient()
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) {
      console.error('complete-profile: under-13 account deletion failed', deleteError)
    }
    await supabase.auth.signOut()
    return NextResponse.json(
      { error: 'You must be 13 or older to use Calyxa.' },
      { status: 403 }
    )
  }

  // Consent is recorded here ONLY when it isn't already (i.e. Google users, who
  // never saw the entry-form checkbox). Email/password users had it recorded at
  // /api/auth/continue, so they aren't asked again.
  const { data: profile } = await supabase
    .from('users')
    .select('gdpr_consent_at')
    .eq('id', user.id)
    .maybeSingle()
  const needsConsent = !profile?.gdpr_consent_at

  if (needsConsent && consent !== true) {
    return NextResponse.json({ error: 'Consent is required to continue.' }, { status: 400 })
  }

  // RLS client under the user's own session — the users_update_own policy
  // (auth.uid() = id) covers exactly these profile columns (same set the signup
  // route writes).
  const update: Record<string, unknown> = { birth_year: birthYear, age_verified: true }
  if (needsConsent) {
    update.gdpr_consent_at = new Date().toISOString()
    update.gdpr_consent_version = CONSENT_VERSION
  }

  const { error } = await supabase.from('users').update(update).eq('id', user.id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
