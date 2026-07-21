import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import { AmbientGlow } from '@/components/dashboard/premium/AmbientGlow'
import { PremiumNav } from '@/components/dashboard/premium/PremiumNav'
import { AskPill } from '@/components/dashboard/premium/AskPill'
import { loadNavUser } from '@/components/dashboard/premium/user-info'

// The post-login dashboard shell — rebuilt to the "Calyxa Dashboard Premium"
// design handoff. A fixed ambient-glow atmosphere, a floating pill nav (with the
// avatar/account menu), a centered 960px content column, and the floating "Ask
// Calyxa" pill. Everything is scoped under `.cx-app` so the marketing site is
// untouched. The per-screen views live in the routes this layout wraps; each
// stays a server-rendered, RLS-scoped, per-request-fresh read (ADR-047).
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const navUser = await loadNavUser(supabase)

  return (
    <div className="cx-app" style={{ position: 'relative', minHeight: '100vh' }}>
      <AmbientGlow />
      <PremiumNav name={navUser.name} initials={navUser.initials} planLabel={navUser.planLabel} />
      <main style={{ position: 'relative', maxWidth: 960, margin: '0 auto', padding: '104px 24px 88px' }}>
        {children}
      </main>
      <AskPill />
    </div>
  )
}
