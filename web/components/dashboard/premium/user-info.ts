import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Derives the nav/avatar display bits from the real signed-in user. The `users`
// table has no name column (email + tier + timestamps only), so the display
// name is derived from the email local-part, and the plan label from
// subscription_tier. Never throws — degrades to a neutral placeholder.

export type NavUser = {
  name: string
  initials: string
  planLabel: string
  email: string
}

function titleCase(part: string): string {
  return part
    .split(/[.\-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'C'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export async function loadNavUser(supabase: SupabaseClient): Promise<NavUser> {
  const fallback: NavUser = { name: 'Your account', initials: 'C', planLabel: 'Calyxa', email: '' }
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return fallback

    const { data: profile } = await supabase
      .from('users')
      .select('email, subscription_tier')
      .eq('id', user.id)
      .single()

    const email = profile?.email ?? user.email ?? ''
    const local = email.split('@')[0] ?? ''
    const name = local ? titleCase(local) : 'Your account'
    const planLabel = profile?.subscription_tier === 'pro' ? 'Calyxa Plus' : 'Calyxa Free'

    return { name, initials: initialsOf(name), planLabel, email }
  } catch {
    return fallback
  }
}
