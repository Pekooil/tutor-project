import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import { StudioShell } from '@/components/studio/StudioShell'
import { loadNavUser } from '@/components/dashboard/premium/user-info'

// The post-login shell — the Notebook Studio's global chrome (a 64px left icon
// rail + a 60px top bar), wrapping every signed-in route so the whole app shares
// one frame. It replaces the floating pill nav; the pre-studio screens
// (account, billing, sessions, library, …) render inside it unchanged, on the
// warm page background they were designed against (`.cx-studio-legacy`).
//
// Each wrapped route stays a server-rendered, RLS-scoped, per-request-fresh read
// (ADR-047) — the shell itself is the only client component, because it owns the
// active rail item, the theme toggle, and the top-bar title.
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const navUser = await loadNavUser(supabase)

  return (
    <StudioShell initials={navUser.initials} name={navUser.name}>
      {children}
    </StudioShell>
  )
}
